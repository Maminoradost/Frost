/**
 * Поиск треков для импорта: сначала музыка с компьютера (по пути из M3U или по тегам),
 * потом источники в порядке из настроек. По три запроса одновременно.
 */
import { api } from './api';
import type { ImportItem } from './importer';
import { bestMatch } from './match';
import type { SourceProvider, Track } from './types';
import { useLocal } from '../store/local';
import { enabledSources } from '../store/settings';

export interface ImportResult {
  tracks: Track[];
  missing: ImportItem[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

function asWant(item: ImportItem): Track {
  return {
    id: '',
    provider: 'local',
    title: item.title,
    artist: item.artist,
    artistId: null,
    album: null,
    artwork: null,
    artworkSmall: null,
    duration: item.duration ?? 0,
    permalink: null,
    genre: null,
    plays: null,
    likes: null,
    streamable: true,
    previewOnly: false,
  };
}

function findLocal(item: ImportItem, byPath: Map<string, Track>, local: Track[]): Track | null {
  if (item.path) {
    const name = item.path.toLowerCase().replace(/\//g, '\\');
    const hit = byPath.get(name) ?? [...byPath.entries()].find(([p]) => p.endsWith(`\\${name.split('\\').pop()}`))?.[1];
    if (hit) return hit;
  }
  if (!local.length) return null;
  const t = norm(item.title);
  const a = norm(item.artist);
  return local.find((l) => norm(l.title) === t && (!a || norm(l.artist).includes(a) || a.includes(norm(l.artist)))) ?? null;
}

export async function matchImport(
  items: ImportItem[],
  onProgress: (done: number, total: number) => void,
  signal?: { cancelled: boolean },
): Promise<ImportResult> {
  const local = useLocal.getState().tracks;
  const byPath = new Map(local.map((t) => [t.id.toLowerCase(), t]));
  const order: SourceProvider[] = enabledSources();
  const found: (Track | null)[] = new Array(items.length).fill(null);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length && !signal?.cancelled) {
      const i = next++;
      const item = items[i];
      let hit = findLocal(item, byPath, local);
      for (const provider of order) {
        if (hit || signal?.cancelled) break;
        const query = item.artist ? `${item.artist} ${item.title}` : item.title;
        const page = await api.searchTracks(provider, query).catch(() => null);
        if (page) hit = bestMatch(asWant(item), page.items, item.artist ? 0.55 : 0.45);
      }
      found[i] = hit;
      onProgress(++done, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, items.length) }, worker));
  const tracks: Track[] = [];
  const missing: ImportItem[] = [];
  const seen = new Set<string>();
  found.forEach((t, i) => {
    if (!t) missing.push(items[i]);
    else if (!seen.has(`${t.provider}:${t.id}`)) {
      seen.add(`${t.provider}:${t.id}`);
      tracks.push(t);
    }
  });
  return { tracks, missing };
}

/** Ссылка на плейлист или альбом YouTube Music / SoundCloud → треки. */
export async function importFromUrl(link: string): Promise<{ title: string; tracks: Track[] } | null> {
  const res = await api.resolveUrl(link);
  if (res?.playlist) {
    const details = await api.playlist(res.playlist.provider, res.playlist.id);
    return { title: details.playlist.title, tracks: details.tracks.filter((t) => t.streamable) };
  }
  if (res?.track) return { title: res.track.title, tracks: [res.track] };
  return null;
}
