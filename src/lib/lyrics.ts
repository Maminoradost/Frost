/**
 * Поиск текста песни сразу по нескольким источникам.
 *
 * 1. Ядро (как раньше): LRCLIB по метаданным трека, для YouTube ещё и YouTube Music.
 * 2. Для треков SoundCloud сначала ищется тот же трек в YouTube Music: его название и
 *    исполнитель точные, а текст YouTube Music берётся по найденному треку.
 * 3. Поиск LRCLIB и NetEase по всем вариантам «исполнитель + название» (см. lyricsMatch.ts),
 *    каждый результат оценивается по названию, исполнителю и длительности.
 * 4. Замедленные и ускоренные версии (slowed, sped up, nightcore): метки времени
 *    растягиваются под длительность трека.
 * 5. Genius (обычный текст), если синхронизированного не нашлось.
 *
 * В панели текста можно переключаться между вариантами, искать вручную, сдвигать
 * метки и синхронизировать обычный текст (автоматически по звуку или вручную).
 */
import { invoke } from '@tauri-apps/api/core';
import { api } from './api';
import { geniusLyrics } from './genius';
import {
  cleanTitle,
  type LyricsQuery,
  retimeLrc,
  scoreCandidate,
  stripCredits,
  trackInfo,
  type TrackInfo,
  yrcToLrc,
} from './lyricsMatch';
import type { Lyrics, Track } from './types';

export { cleanTitle };

export type LyricsKind = 'lrclib' | 'youtube' | 'netease' | 'genius' | 'auto' | 'manual';

export interface LyricsOption extends Lyrics {
  /** Уникальный ключ варианта (источник + запись). */
  key: string;
  kind: LyricsKind;
  /** Насколько найденное похоже на трек, 0..1. */
  score: number;
  /** Растяжение меток под slowed / sped up (1: без растяжения). */
  tempo: number;
  /** Что именно нашлось: «Исполнитель — Название». */
  matched?: string;
}

export interface LyricsResult {
  options: LyricsOption[];
  instrumental: boolean;
  info: TrackInfo;
  /** Тот же трек в YouTube Music (для треков SoundCloud), если нашёлся. */
  ytm: Track | null;
}

/** Варианты запроса (оставлено для совместимости). */
export function lyricsCandidates(track: Pick<Track, 'artist' | 'title'>): LyricsQuery[] {
  return trackInfo(track).queries;
}

interface FetchResponse {
  status: number;
  url: string;
  body: string;
}

async function netGet(url: string): Promise<FetchResponse | null> {
  try {
    return await invoke<FetchResponse>('net_fetch', { url, accept: null });
  } catch {
    return null;
  }
}

function json<T>(r: FetchResponse | null): T | null {
  if (!r || r.status < 200 || r.status >= 300) return null;
  try {
    return JSON.parse(r.body) as T;
  } catch {
    return null;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

const hasStamps = (s: string | null | undefined): s is string => !!s && /\[\d{1,3}:\d{1,2}[.:]?\d*\]\s*\S/.test(s);

// ---------------------------------------------------------------------------
// LRCLIB
// ---------------------------------------------------------------------------

interface LrclibRecord {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string | null;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

async function lrclib(info: TrackInfo, duration: number): Promise<LyricsOption[]> {
  const urls = new Set<string>();
  for (const q of info.queries.slice(0, 3)) {
    const p = new URLSearchParams({ track_name: q.title });
    if (q.artist) p.set('artist_name', q.artist);
    urls.add(`https://lrclib.net/api/search?${p.toString()}`);
  }
  const first = info.queries[0];
  if (first) urls.add(`https://lrclib.net/api/search?q=${encodeURIComponent(`${first.artist} ${first.title}`.trim())}`);
  const lists = await Promise.all([...urls].map((u) => netGet(u).then((r) => json<LrclibRecord[]>(r) ?? [])));
  const seen = new Set<number>();
  const out: LyricsOption[] = [];
  for (const rec of lists.flat()) {
    if (!rec || seen.has(rec.id)) continue;
    seen.add(rec.id);
    if (!rec.syncedLyrics && !rec.plainLyrics && !rec.instrumental) continue;
    const { score, tempo } = scoreCandidate(info, duration, {
      artist: rec.artistName,
      title: rec.trackName,
      duration: rec.duration,
    });
    out.push({
      key: `lrclib:${rec.id}`,
      kind: 'lrclib',
      source: 'LRCLIB',
      synced: rec.syncedLyrics || null,
      plain: rec.plainLyrics || null,
      instrumental: rec.instrumental,
      score,
      tempo,
      matched: `${rec.artistName} — ${rec.trackName}`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// NetEase Cloud Music
// ---------------------------------------------------------------------------

interface NeteaseSong {
  id: number;
  name: string;
  artists?: { name: string }[];
  ar?: { name: string }[];
  duration?: number;
  dt?: number;
}

async function netease(info: TrackInfo, duration: number): Promise<LyricsOption[]> {
  const terms = [...new Set(info.queries.slice(0, 2).map((q) => `${q.artist} ${q.title}`.trim()))];
  const songs = new Map<number, NeteaseSong>();
  await Promise.all(
    terms.map(async (term) => {
      const r = json<{ result?: { songs?: NeteaseSong[] } }>(
        await netGet(`https://music.163.com/api/search/pc?s=${encodeURIComponent(term)}&type=1&limit=10&offset=0`),
      );
      for (const s of r?.result?.songs ?? []) songs.set(s.id, s);
    }),
  );
  const ranked = [...songs.values()]
    .map((s) => {
      const artist = (s.artists ?? s.ar ?? []).map((a) => a.name).join(', ');
      const m = scoreCandidate(info, duration, { artist, title: s.name, duration: (s.duration ?? s.dt ?? 0) / 1000 });
      return { s, artist, ...m };
    })
    .filter((x) => x.score >= 0.62)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
  const out: LyricsOption[] = [];
  for (const x of ranked) {
    // Обычный LRC и (если есть) пословный YRC для караоке — параллельно.
    const [rawLrc, rawYrc] = await Promise.all([
      netGet(`https://music.163.com/api/song/lyric?id=${x.s.id}&lv=1&kv=1&tv=-1`),
      netGet(`https://music.163.com/api/song/lyric/v1?id=${x.s.id}&lv=0&kv=0&tv=0&rv=0&yv=0&ytv=0&yrv=0`).catch(() => null),
    ]);
    const r = json<{ lrc?: { lyric?: string } }>(rawLrc);
    const y = rawYrc ? json<{ yrc?: { lyric?: string } }>(rawYrc) : null;
    const words = y?.yrc?.lyric ? yrcToLrc(y.yrc.lyric) : null;
    const lrc = words ?? (r?.lrc?.lyric ? stripCredits(r.lrc.lyric) : '');
    if (/纯音乐/.test(lrc)) {
      out.push({ key: `netease:${x.s.id}`, kind: 'netease', source: 'NetEase', synced: null, plain: null, instrumental: true, score: x.score, tempo: 1 });
      continue;
    }
    if (!hasStamps(lrc)) continue;
    out.push({
      key: `netease:${x.s.id}`,
      kind: 'netease',
      source: 'NetEase',
      synced: lrc,
      plain: null,
      instrumental: false,
      score: x.score,
      tempo: x.tempo,
      matched: `${x.artist} — ${x.s.name}`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// YouTube Music: тот же трек для SoundCloud
// ---------------------------------------------------------------------------

async function ytmLookup(info: TrackInfo, duration: number): Promise<{ track: Track; score: number; tempo: number } | null> {
  const queries = info.queries.slice(0, 2);
  let best: { track: Track; score: number; tempo: number } | null = null;
  for (const q of queries) {
    const page = await api.searchTracks('youtube', `${q.artist} ${q.title}`.trim()).catch(() => null);
    for (const t of page?.items.slice(0, 8) ?? []) {
      const m = scoreCandidate(info, duration, { artist: t.artist, title: t.title, duration: t.duration });
      if (!best || m.score > best.score) best = { track: t, ...m };
    }
    if (best && best.score >= 0.86) break;
  }
  return best && best.score >= 0.72 ? best : null;
}

function fromCore(l: Lyrics | null, score: number, tempo: number, matched?: string): LyricsOption | null {
  if (!l || (!l.synced && !l.plain && !l.instrumental)) return null;
  const kind: LyricsKind = l.source === 'YouTube Music' ? 'youtube' : 'lrclib';
  return {
    ...l,
    key: `core:${kind}:${matched ?? ''}`,
    kind,
    score,
    tempo,
    matched,
  };
}

// ---------------------------------------------------------------------------
// Сборка
// ---------------------------------------------------------------------------

function rank(o: LyricsOption): number {
  return o.score + (o.synced ? 0.18 : 0) - (o.instrumental ? 0.3 : 0);
}

function fingerprint(o: LyricsOption): string {
  const text = (o.synced ?? o.plain ?? '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  return `${o.synced ? 's' : 'p'}:${text.slice(0, 160)}`;
}

export interface FindOptions {
  /** Ручной запрос из панели текста: ищется в первую очередь. */
  query?: LyricsQuery;
}

export async function findLyrics(track: Track, opts: FindOptions = {}): Promise<LyricsResult> {
  const info = trackInfo(track);
  if (opts.query && opts.query.title.trim()) {
    info.queries = [{ artist: opts.query.artist.trim(), title: opts.query.title.trim() }, ...info.queries];
  }
  const duration = track.duration;
  const isYoutube = track.provider === 'youtube';

  const core = withTimeout(
    api.lyrics(track).then((l) => fromCore(l, isYoutube ? 0.98 : 0.8, 1)),
    12000,
    null,
  );
  const ytm = isYoutube ? Promise.resolve(null) : withTimeout(ytmLookup(info, duration), 9000, null);
  const ytmLyrics = ytm.then(async (found) => {
    if (!found) return null;
    const l = await withTimeout(api.lyrics(found.track), 12000, null);
    return fromCore(l, Math.min(0.97, found.score), found.tempo, `${found.track.artist} — ${found.track.title}`);
  });
  // С точными данными YouTube Music ищем и в LRCLIB/NetEase.
  const exact = ytm.then((found) => {
    if (!found) return info;
    const q = { artist: found.track.artist, title: cleanTitle(found.track.title) };
    return { ...info, queries: [q, ...info.queries] };
  });
  const lrclibAll = exact.then((i) => withTimeout(lrclib(i, duration), 12000, [] as LyricsOption[]));
  const neteaseAll = exact.then((i) => withTimeout(netease(i, duration), 12000, [] as LyricsOption[]));

  const [c, y, l, n, found] = await Promise.all([core, ytmLyrics, lrclibAll, neteaseAll, ytm]);
  let options: LyricsOption[] = [c, y, ...l, ...n].filter((o): o is LyricsOption => !!o);

  // Растяжение меток под замедленную или ускоренную версию.
  options = options.map((o) => (o.synced && o.tempo !== 1 ? { ...o, synced: retimeLrc(o.synced, o.tempo) } : o));
  // Слабые совпадения отбрасываем: чужой текст хуже, чем никакого.
  options = options.filter((o) => o.score >= 0.55 || o.key.startsWith('core:'));
  options.sort((a, b) => rank(b) - rank(a));

  const seen = new Set<string>();
  options = options.filter((o) => {
    if (o.instrumental && !o.synced && !o.plain) return false;
    const f = fingerprint(o);
    if (seen.has(f)) return false;
    seen.add(f);
    return true;
  });

  const instrumental =
    info.instrumental ||
    (!options.length && [c, ...l, ...n].some((o) => o?.instrumental && o.score >= 0.75));

  if (!instrumental && !options.some((o) => o.synced && o.score >= 0.75)) {
    const queries = found ? [{ artist: found.track.artist, title: cleanTitle(found.track.title) }, ...info.queries] : info.queries;
    const g = await withTimeout(geniusLyrics(queries), 12000, null);
    if (g && !options.some((o) => fingerprint(o) === `p:${g.text.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 160)}`)) {
      options.push({
        key: `genius:${g.url}`,
        kind: 'genius',
        source: 'Genius',
        synced: null,
        plain: g.text,
        instrumental: false,
        url: g.url,
        score: 0.7,
        tempo: 1,
        matched: `${g.artist} — ${g.title}`,
      });
    }
  }
  return { options, instrumental, info, ytm: found?.track ?? null };
}
