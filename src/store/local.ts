/**
 * Музыка с компьютера: обход папок (Rust), чтение тегов (lib/tags), уменьшенные обложки
 * в кэше приложения. Повторное сканирование читает только новые и изменённые файлы.
 * Медиатека хранится в IndexedDB: localStorage на десятки тысяч треков не хватит.
 */
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';
import { idbGet, idbSet } from '../lib/idb';
import { md5 } from '../lib/md5';
import { readTags, tagsFromFileName, type AudioTags } from '../lib/tags';
import type { Track } from '../lib/types';
import { isTauri } from '../lib/window';
import { usePlayer } from './player';
import { useSettings } from './settings';
import { toast } from './ui';

/** Ответ команды `local_scan`. */
interface LocalFile {
  path: string;
  size: number;
  modified: number;
  cover: string | null;
}

export interface LocalEntry {
  path: string;
  size: number;
  modified: number;
  title: string;
  artist: string;
  album: string | null;
  albumArtist: string | null;
  trackNo: number | null;
  disc: number | null;
  year: number | null;
  genre: string | null;
  duration: number;
  /** Уменьшенная обложка в кэше приложения. */
  cover: string | null;
}

export interface LocalAlbum {
  key: string;
  title: string;
  artist: string;
  year: number | null;
  artwork: string | null;
  tracks: Track[];
}

export interface LocalArtist {
  name: string;
  tracks: Track[];
  albums: number;
  artwork: string | null;
}

interface LocalState {
  entries: LocalEntry[];
  tracks: Track[];
  albums: LocalAlbum[];
  artists: LocalArtist[];
  loaded: boolean;
  scanning: { done: number; total: number } | null;
  lastScan: number;
  scan: (opts?: { quiet?: boolean }) => Promise<void>;
  addFolder: () => Promise<void>;
  removeFolder: (path: string) => void;
  fixDuration: (path: string, seconds: number) => void;
}

const KEY = 'local:library';
const PARALLEL = 4;
const COVER_SIZE = 320;
const UNKNOWN_ARTIST = 'Неизвестный артист';

const collator = new Intl.Collator('ru', { sensitivity: 'base', numeric: true });

export const albumKey = (e: Pick<LocalEntry, 'album' | 'albumArtist' | 'artist' | 'path'>) =>
  e.album ? `${(e.albumArtist || e.artist).toLowerCase()}|${e.album.toLowerCase()}` : `file|${e.path.toLowerCase()}`;

export function entryToTrack(e: LocalEntry): Track {
  const art = e.cover && isTauri ? convertFileSrc(e.cover) : null;
  return {
    id: e.path,
    provider: 'local',
    title: e.title,
    artist: e.artist,
    artistId: null,
    album: e.album,
    albumId: e.album ? albumKey(e) : null,
    artwork: art,
    artworkSmall: art,
    duration: e.duration,
    permalink: null,
    genre: e.genre,
    plays: null,
    likes: null,
    streamable: true,
    previewOnly: false,
  };
}

/** Порядок «артист → альбом → диск → номер», как в обычных плеерах. */
export function sortEntries(list: LocalEntry[]): LocalEntry[] {
  return [...list].sort(
    (a, b) =>
      collator.compare(a.albumArtist || a.artist, b.albumArtist || b.artist) ||
      collator.compare(a.album ?? '', b.album ?? '') ||
      (a.disc ?? 1) - (b.disc ?? 1) ||
      (a.trackNo ?? 9999) - (b.trackNo ?? 9999) ||
      collator.compare(a.title, b.title),
  );
}

function derive(entries: LocalEntry[]) {
  const sorted = sortEntries(entries);
  const tracks = sorted.map(entryToTrack);
  const albums = new Map<string, LocalAlbum>();
  const artists = new Map<string, LocalArtist & { albumKeys: Set<string> }>();
  sorted.forEach((e, i) => {
    const t = tracks[i];
    if (e.album) {
      const key = albumKey(e);
      let a = albums.get(key);
      if (!a) {
        a = { key, title: e.album, artist: e.albumArtist || e.artist, year: e.year, artwork: t.artwork, tracks: [] };
        albums.set(key, a);
      }
      a.tracks.push(t);
      a.artwork ??= t.artwork;
      a.year ??= e.year;
    }
    const name = e.albumArtist || e.artist;
    const ak = name.toLowerCase();
    let ar = artists.get(ak);
    if (!ar) {
      ar = { name, tracks: [], albums: 0, artwork: t.artwork, albumKeys: new Set() };
      artists.set(ak, ar);
    }
    ar.tracks.push(t);
    ar.artwork ??= t.artwork;
    if (e.album) ar.albumKeys.add(albumKey(e));
  });
  return {
    entries: sorted,
    tracks,
    albums: [...albums.values()].sort((a, b) => collator.compare(a.artist, b.artist) || (a.year ?? 0) - (b.year ?? 0) || collator.compare(a.title, b.title)),
    artists: [...artists.values()]
      .map(({ albumKeys, ...a }) => ({ ...a, albums: albumKeys.size }))
      .sort((a, b) => collator.compare(a.name, b.name)),
  };
}

/** Кусок файла через протокол asset (он отдаёт не больше ~1 МБ за запрос). */
async function readRange(url: string, start: number, length: number, size: number): Promise<Uint8Array> {
  const end = Math.min(size, start + length);
  const parts: Uint8Array[] = [];
  let pos = start;
  while (pos < end) {
    const res = await fetch(url, { headers: { Range: `bytes=${pos}-${end - 1}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let chunk = new Uint8Array(await res.arrayBuffer());
    if (res.status === 200) chunk = chunk.subarray(pos, end); // сервер проигнорировал Range
    if (!chunk.length) break;
    parts.push(chunk);
    pos += chunk.length;
  }
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(pos - start);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Уменьшает картинку до 320 пикселей и сохраняет в кэш приложения (один файл на альбом). */
async function saveCover(key: string, picture: AudioTags['picture'] | undefined, folderImage: string | null): Promise<string | null> {
  try {
    let blob: Blob | null = null;
    if (picture) blob = new Blob([picture.data.slice()], { type: picture.mime });
    else if (folderImage) {
      const res = await fetch(convertFileSrc(folderImage));
      if (res.ok) blob = await res.blob();
    }
    if (!blob) return null;
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, COVER_SIZE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    if (!out) return null;
    const bytes = Array.from(new Uint8Array(await out.arrayBuffer()));
    return await invoke<string>('local_cover_save', { key: md5(key), bytes });
  } catch (e) {
    console.warn('Обложка не сохранилась', e);
    return null;
  }
}

async function readEntry(f: LocalFile, covers: Map<string, Promise<string | null>>): Promise<LocalEntry> {
  let tags: AudioTags = {};
  try {
    const url = convertFileSrc(f.path);
    tags = await readTags((start, length) => readRange(url, start, length, f.size), f.size);
  } catch (e) {
    console.warn('Теги не прочитались', f.path, e);
  }
  const byName = tagsFromFileName(f.path);
  const entry: LocalEntry = {
    path: f.path,
    size: f.size,
    modified: f.modified,
    title: tags.title ?? byName.title,
    artist: tags.artist ?? tags.albumArtist ?? byName.artist ?? UNKNOWN_ARTIST,
    album: tags.album ?? null,
    albumArtist: tags.albumArtist ?? null,
    trackNo: tags.track ?? byName.track ?? null,
    disc: tags.disc ?? null,
    year: tags.year ?? null,
    genre: tags.genre ?? null,
    duration: Math.round(tags.duration ?? 0),
    cover: null,
  };
  const key = albumKey(entry);
  const known = covers.get(key);
  let cover = known ? await known : null;
  if (!cover && (tags.picture || f.cover)) {
    const pending = saveCover(key, tags.picture, tags.picture ? null : f.cover);
    covers.set(key, pending);
    cover = await pending;
  }
  entry.cover = cover;
  return entry;
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

let saveTimer = 0;
function persist(entries: LocalEntry[]) {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void idbSet(KEY, { v: 1, entries, lastScan: useLocal.getState().lastScan }).catch((e) => console.warn('Медиатека не сохранилась', e));
  }, 500);
}

export const useLocal = create<LocalState>()((set, get) => ({
  entries: [],
  tracks: [],
  albums: [],
  artists: [],
  loaded: false,
  scanning: null,
  lastScan: 0,

  scan: async ({ quiet = false } = {}) => {
    if (!isTauri || get().scanning) return;
    const folders = useSettings.getState().localFolders;
    if (!folders.length) {
      set({ ...derive([]), lastScan: Date.now() });
      persist([]);
      return;
    }
    set({ scanning: { done: 0, total: 0 } });
    try {
      const files = await invoke<LocalFile[]>('local_scan', { folders });
      const old = new Map(get().entries.map((e) => [e.path, e]));
      const keep: LocalEntry[] = [];
      const todo: LocalFile[] = [];
      for (const f of files) {
        const e = old.get(f.path);
        if (e && e.size === f.size && e.modified === f.modified) keep.push(e);
        else todo.push(f);
      }
      const covers = new Map<string, Promise<string | null>>();
      for (const e of keep) if (e.cover) covers.set(albumKey(e), Promise.resolve(e.cover));
      const fresh: LocalEntry[] = [];
      set({ scanning: { done: 0, total: todo.length } });
      if (keep.length !== old.size) set(derive(keep.concat(fresh)));
      await pool(todo, PARALLEL, async (f) => {
        fresh.push(await readEntry(f, covers));
        const done = fresh.length;
        if (done % 20 === 0 || done === todo.length) set({ scanning: { done, total: todo.length } });
        if (done % 400 === 0) set(derive(keep.concat(fresh)));
      });
      const all = keep.concat(fresh);
      set({ ...derive(all), lastScan: Date.now() });
      persist(all);
      if (!quiet) {
        toast(todo.length ? `Готово: ${all.length} треков, новых и изменённых ${todo.length}` : `Изменений нет, треков: ${all.length}`, 'success');
      }
    } catch (e) {
      toast(`Не удалось прочитать папки: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      set({ scanning: null });
    }
  },

  addFolder: async () => {
    if (!isTauri) return;
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({ directory: true, multiple: true, title: 'Папки с музыкой' }).catch(() => null);
    const list = (Array.isArray(picked) ? picked : picked ? [picked] : []).filter(Boolean) as string[];
    if (!list.length) return;
    const s = useSettings.getState();
    const folders = [...s.localFolders];
    for (const dir of list) if (!folders.some((f) => f.toLowerCase() === dir.toLowerCase())) folders.push(dir);
    s.update({ localFolders: folders });
    await get().scan();
  },

  removeFolder: (path) => {
    const s = useSettings.getState();
    s.update({ localFolders: s.localFolders.filter((f) => f !== path) });
    const prefix = path.replace(/[\\/]+$/, '').toLowerCase();
    const rest = get().entries.filter((e) => {
      const p = e.path.toLowerCase();
      return !(p.startsWith(`${prefix}\\`) || p.startsWith(`${prefix}/`));
    });
    set(derive(rest));
    persist(rest);
  },

  fixDuration: (path, seconds) => {
    const secs = Math.round(seconds);
    const list = get().entries;
    const i = list.findIndex((e) => e.path === path);
    if (i < 0 || Math.abs(list[i].duration - secs) <= 1) return;
    const next = [...list];
    next[i] = { ...list[i], duration: secs };
    set(derive(next));
    persist(next);
  },
}));

let started = false;

/** Загрузка сохранённой медиатеки и тихое обновление в фоне. */
export async function initLocalLibrary() {
  if (started) return;
  started = true;
  const saved = await idbGet<{ v: number; entries: LocalEntry[]; lastScan?: number }>(KEY).catch(() => undefined);
  const entries = Array.isArray(saved?.entries) ? saved.entries : [];
  useLocal.setState({ ...derive(entries), loaded: true, lastScan: saved?.lastScan ?? 0 });

  // Настоящая длительность уточняется при воспроизведении
  usePlayer.subscribe((s, prev) => {
    const t = s.current;
    if (t?.provider === 'local' && s.duration > 0 && (s.duration !== prev.duration || t !== prev.current)) {
      useLocal.getState().fixDuration(t.id, s.duration);
    }
  });

  const folders = useSettings.getState().localFolders;
  if (!isTauri || !folders.length) return;
  await invoke('local_allow', { folders }).catch(() => undefined);
  // Новые файлы подхватываются сами, через полминуты после запуска
  window.setTimeout(() => void useLocal.getState().scan({ quiet: true }), 30_000);
}
