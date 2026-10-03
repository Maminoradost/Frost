/**
 * SoundCloud без ключей: тот же публичный веб-API (api-v2), которым пользуется soundcloud.com.
 *
 * - `client_id` веб-клиента извлекается автоматически из JS-бандлов сайта (как в yt-dlp),
 *   кэшируется на 12 часов и обновляется сам при 401/403;
 * - запросы выполняет Rust-ядро (`net_fetch`): системный прокси/VPN, без CORS;
 * - аудио идёт через локальный прокси `frost://` (`register_stream`), это нужно WebAudio.
 */
import { invoke } from '@tauri-apps/api/core';
import type { Artist, ArtistPage, Page, Playlist, PlaylistDetails, ResolvedStream, SearchResults, Shelf, Track } from './types';

const API = 'https://api-v2.soundcloud.com';
const SITE = 'https://soundcloud.com';
const ID_KEY = 'frost.sc.clientId';
const ID_TTL = 12 * 60 * 60 * 1000;
const PAGE = 30;

// ---------- транспорт ----------

interface FetchResponse {
  status: number;
  url: string;
  body: string;
}

export class SoundCloudError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function statusText(status: number): string {
  if (status === 404) return 'SoundCloud: не найдено';
  if (status === 429) return 'SoundCloud: слишком много запросов, попробуйте через минуту';
  if (status === 401 || status === 403) return 'SoundCloud отклонил запрос. Возможно, сервис недоступен из вашей сети: включите VPN или прокси (Настройки → Сеть)';
  if (status >= 500) return 'SoundCloud временно недоступен';
  return `SoundCloud вернул ошибку (HTTP ${status})`;
}

async function fetchRaw(url: string, accept?: string): Promise<FetchResponse> {
  return invoke<FetchResponse>('net_fetch', { url, accept: accept ?? null });
}

// ---------- client_id ----------

/** Ищет client_id в HTML или JS (форматы `client_id:"…"`, `client_id=…`, `"clientId":"…"`). */
export function findClientId(text: string): string | null {
  const patterns = [
    /client_id\s*[:=]\s*["']([0-9a-zA-Z]{32})["']/,
    /["']clientId["']\s*:\s*["']([0-9a-zA-Z]{32})["']/,
    /[?&]client_id=([0-9a-zA-Z]{32})(?![0-9a-zA-Z])/,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) return m[1];
  }
  return null;
}

/** Скрипты-бандлы сайта (`https://a-v2.sndcdn.com/assets/*.js`) в порядке появления. */
export function scriptUrls(html: string): string[] {
  const out: string[] = [];
  const re = /<script\b[^>]*\bsrc=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let src = m[1];
    if (src.startsWith('//')) src = `https:${src}`;
    if (/^https:\/\/[a-z0-9.-]*sndcdn\.com\/.+\.js/i.test(src)) out.push(src);
  }
  return out;
}

let idPromise: Promise<string> | null = null;
let memId: string | null = null;

function readCachedId(): string | null {
  if (memId) return memId;
  try {
    const raw = localStorage.getItem(ID_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: string; at?: number };
    if (parsed.id && parsed.at && Date.now() - parsed.at < ID_TTL) {
      memId = parsed.id;
      return parsed.id;
    }
  } catch {
    /* повреждённый кэш: получим заново */
  }
  return null;
}

function storeId(id: string) {
  memId = id;
  try {
    localStorage.setItem(ID_KEY, JSON.stringify({ id, at: Date.now() }));
  } catch {
    /* localStorage недоступен: живём с кэшем в памяти */
  }
}

function invalidateId() {
  memId = null;
  idPromise = null;
  try {
    localStorage.removeItem(ID_KEY);
  } catch {
    /* ignore */
  }
}

async function discoverClientId(): Promise<string> {
  const pages = [`${SITE}/`, `${SITE}/discover`];
  let lastError: unknown = null;
  for (const pageUrl of pages) {
    try {
      const page = await fetchRaw(pageUrl, 'text/html,application/xhtml+xml');
      if (page.status >= 400) throw new SoundCloudError(page.status, statusText(page.status));
      const inline = findClientId(page.body);
      if (inline) return inline;
      const scripts = scriptUrls(page.body).reverse();
      for (const src of scripts) {
        const js = await fetchRaw(src, '*/*');
        if (js.status !== 200) continue;
        const id = findClientId(js.body);
        if (id) return id;
      }
    } catch (e) {
      lastError = e;
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error('Не удалось подключиться к SoundCloud: ключ веб-клиента не найден');
}

export async function clientId(): Promise<string> {
  const cached = readCachedId();
  if (cached) return cached;
  if (!idPromise) {
    idPromise = discoverClientId()
      .then((id) => {
        storeId(id);
        return id;
      })
      .catch((e) => {
        idPromise = null;
        throw e;
      });
  }
  return idPromise;
}

type Params = Record<string, string | number | boolean | null | undefined>;

/** GET к api-v2 с client_id; при 401/403 ключ получаем заново и повторяем один раз. */
async function call<T>(pathOrUrl: string, params: Params = {}): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const id = await clientId();
    const url = new URL(pathOrUrl.startsWith('http') ? pathOrUrl : `${API}${pathOrUrl}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    url.searchParams.set('client_id', id);
    if (!url.searchParams.has('app_locale')) url.searchParams.set('app_locale', 'ru');
    const res = await fetchRaw(url.toString());
    if ((res.status === 401 || res.status === 403) && attempt === 0) {
      invalidateId();
      continue;
    }
    if (res.status >= 400) throw new SoundCloudError(res.status, statusText(res.status));
    try {
      return JSON.parse(res.body) as T;
    } catch {
      throw new Error('SoundCloud вернул неожиданный ответ');
    }
  }
  throw new SoundCloudError(403, statusText(403));
}

// ---------- сырые типы api-v2 ----------

interface RawUser {
  id: number;
  username?: string;
  full_name?: string;
  permalink?: string;
  permalink_url?: string;
  avatar_url?: string | null;
  followers_count?: number;
  track_count?: number;
  description?: string | null;
  verified?: boolean;
  visuals?: { visuals?: { visual_url?: string }[] } | null;
}

interface RawTranscoding {
  url: string;
  preset?: string;
  snipped?: boolean;
  quality?: string;
  format?: { protocol?: string; mime_type?: string };
}

interface RawTrack {
  id: number;
  kind?: string;
  title?: string;
  artwork_url?: string | null;
  duration?: number;
  full_duration?: number;
  genre?: string | null;
  permalink_url?: string;
  playback_count?: number | null;
  likes_count?: number | null;
  streamable?: boolean;
  policy?: string;
  track_authorization?: string;
  media?: { transcodings?: RawTranscoding[] };
  user?: RawUser;
  publisher_metadata?: { artist?: string | null; album_title?: string | null } | null;
}

interface RawPlaylist {
  id: number | string;
  urn?: string;
  kind?: string;
  title?: string;
  short_title?: string;
  artwork_url?: string | null;
  calculated_artwork_url?: string | null;
  user?: RawUser;
  track_count?: number;
  description?: string | null;
  permalink_url?: string;
  is_album?: boolean;
  set_type?: string | null;
  release_date?: string | null;
  published_at?: string | null;
  tracks?: RawTrack[];
}

interface Collection<T> {
  collection?: T[];
  next_href?: string | null;
}

// ---------- маппинг ----------

/** `…-large.jpg` → нужный размер (t500x500, t300x300, large=100px). */
export function artworkSize(url: string | null | undefined, size: 't500x500' | 't300x300' | 'large' | 'original'): string | null {
  if (!url) return null;
  return url.replace(/-(large|t\d+x\d+|crop|original|badge|small|tiny|mini)\.(jpg|jpeg|png)/i, `-${size}.$2`);
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed ? trimmed : null;
}

function usableTranscoding(t: RawTranscoding): boolean {
  const protocol = t.format?.protocol ?? '';
  return !!t.url && !/encrypted/i.test(protocol) && !(t.preset ?? '').startsWith('abr');
}

export function mapTrack(raw: RawTrack): Track | null {
  if (!raw || raw.id == null || !raw.title) return null;
  const list = raw.media?.transcodings ?? [];
  const full = list.some((t) => usableTranscoding(t) && !t.snipped);
  const policy = (raw.policy ?? '').toUpperCase();
  const art = raw.artwork_url || raw.user?.avatar_url || null;
  const artist = nonEmpty(raw.publisher_metadata?.artist) ?? nonEmpty(raw.user?.username) ?? '';
  return {
    id: String(raw.id),
    provider: 'soundcloud',
    title: raw.title,
    artist,
    artistId: raw.user?.id != null ? String(raw.user.id) : null,
    album: nonEmpty(raw.publisher_metadata?.album_title),
    albumId: null,
    artwork: artworkSize(art, 't500x500'),
    artworkSmall: artworkSize(art, 't300x300'),
    duration: Math.round((raw.full_duration || raw.duration || 0) / 1000),
    permalink: raw.permalink_url ?? null,
    genre: nonEmpty(raw.genre),
    plays: raw.playback_count ?? null,
    likes: raw.likes_count ?? null,
    streamable: policy !== 'BLOCK' && raw.streamable !== false && list.length > 0,
    previewOnly: policy === 'SNIP' || (list.length > 0 && !full),
  };
}

export function mapUser(raw: RawUser): Artist | null {
  if (!raw || raw.id == null) return null;
  return {
    id: String(raw.id),
    provider: 'soundcloud',
    name: raw.username || raw.full_name || 'Без имени',
    handle: raw.permalink ?? null,
    avatar: artworkSize(raw.avatar_url, 't500x500'),
    cover: raw.visuals?.visuals?.[0]?.visual_url ?? null,
    followers: raw.followers_count ?? null,
    trackCount: raw.track_count ?? null,
    bio: nonEmpty(raw.description),
    permalink: raw.permalink_url ?? null,
    verified: !!raw.verified,
  };
}

export function mapPlaylist(raw: RawPlaylist): Playlist | null {
  if (!raw || raw.id == null) return null;
  const id = raw.urn && raw.urn.includes('system-playlists') ? raw.urn : String(raw.id);
  const art = raw.artwork_url || raw.calculated_artwork_url || raw.tracks?.find((t) => t.artwork_url)?.artwork_url || raw.user?.avatar_url || null;
  const setType = (raw.set_type ?? '').toLowerCase();
  const kind = raw.is_album ? (setType === 'ep' || setType === 'single' ? setType : 'album') : 'playlist';
  const date = raw.release_date || raw.published_at || '';
  const year = /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null;
  return {
    id,
    provider: 'soundcloud',
    title: raw.title || raw.short_title || 'Плейлист',
    owner: raw.user?.username ?? null,
    ownerId: raw.user?.id != null ? String(raw.user.id) : null,
    artwork: artworkSize(art, 't500x500'),
    trackCount: raw.track_count ?? raw.tracks?.length ?? null,
    description: nonEmpty(raw.description),
    permalink: raw.permalink_url ?? null,
    kind,
    year,
  };
}

function mapTracks(list: RawTrack[] | undefined): Track[] {
  return (list ?? []).map(mapTrack).filter((t): t is Track => t !== null);
}

function page<T, R>(data: Collection<R>, map: (raw: R) => T | null): Page<T> {
  return {
    items: (data.collection ?? []).map(map).filter((x): x is T => x !== null),
    next: data.next_href ?? null,
  };
}

/** Курсор — это `next_href` api-v2; принимаем только его. */
function cursorUrl(cursor: string | null): string | null {
  return cursor && cursor.startsWith(API) ? cursor : null;
}

// ---------- поиск ----------

export async function searchTracks(query: string, cursor: string | null = null): Promise<Page<Track>> {
  const next = cursorUrl(cursor);
  const data = next
    ? await call<Collection<RawTrack>>(next)
    : await call<Collection<RawTrack>>('/search/tracks', { q: query, limit: PAGE, offset: 0, linked_partitioning: 1 });
  return page(data, mapTrack);
}

export async function searchUsers(query: string, cursor: string | null = null): Promise<Page<Artist>> {
  const next = cursorUrl(cursor);
  const data = next
    ? await call<Collection<RawUser>>(next)
    : await call<Collection<RawUser>>('/search/users', { q: query, limit: 20, offset: 0, linked_partitioning: 1 });
  return page(data, mapUser);
}

export async function searchPlaylists(query: string, cursor: string | null = null): Promise<Page<Playlist>> {
  const next = cursorUrl(cursor);
  const data = next
    ? await call<Collection<RawPlaylist>>(next)
    : await call<Collection<RawPlaylist>>('/search/playlists_without_albums', { q: query, limit: 20, offset: 0, linked_partitioning: 1 });
  return page(data, mapPlaylist);
}

export async function searchAlbums(query: string): Promise<Page<Playlist>> {
  const data = await call<Collection<RawPlaylist>>('/search/albums', { q: query, limit: 20, offset: 0, linked_partitioning: 1 });
  return page(data, mapPlaylist);
}

export async function searchAll(query: string): Promise<SearchResults> {
  const [tracks, users, playlists, albums] = await Promise.allSettled([
    searchTracks(query),
    searchUsers(query),
    searchPlaylists(query),
    searchAlbums(query),
  ]);
  if (tracks.status === 'rejected' && users.status === 'rejected') throw tracks.reason;
  return {
    tracks: tracks.status === 'fulfilled' ? tracks.value.items : [],
    tracksNext: tracks.status === 'fulfilled' ? tracks.value.next : null,
    artists: users.status === 'fulfilled' ? users.value.items : [],
    playlists: playlists.status === 'fulfilled' ? playlists.value.items : [],
    albums: albums.status === 'fulfilled' ? albums.value.items : [],
    corrected: null,
  };
}

export async function suggestions(query: string): Promise<string[]> {
  const data = await call<Collection<{ output?: string; query?: string }>>('/search/queries', { q: query, limit: 8 });
  return (data.collection ?? []).map((s) => s.output || s.query || '').filter(Boolean);
}

// ---------- треки, артисты, плейлисты ----------

/** Догружает «заглушки» треков (только id) пачками по 50 и сохраняет порядок. */
async function hydrate(list: RawTrack[] | undefined): Promise<Track[]> {
  const raw = list ?? [];
  const full = new Map<string, Track>();
  const missing: string[] = [];
  for (const t of raw) {
    const mapped = mapTrack(t);
    if (mapped) full.set(mapped.id, mapped);
    else if (t && t.id != null) missing.push(String(t.id));
  }
  for (let i = 0; i < missing.length; i += 50) {
    const ids = missing.slice(i, i + 50).join(',');
    try {
      const batch = await call<RawTrack[]>('/tracks', { ids });
      for (const t of batch) {
        const mapped = mapTrack(t);
        if (mapped) full.set(mapped.id, mapped);
      }
    } catch {
      /* часть треков может быть недоступна в регионе */
    }
  }
  return raw.map((t) => full.get(String(t?.id))).filter((t): t is Track => !!t);
}

export async function track(id: string): Promise<Track> {
  const raw = await call<RawTrack>(`/tracks/${encodeURIComponent(id)}`);
  const mapped = mapTrack(raw);
  if (!mapped) throw new Error('SoundCloud: трек не найден');
  return mapped;
}

export async function related(id: string): Promise<Track[]> {
  const data = await call<Collection<RawTrack>>(`/tracks/${encodeURIComponent(id)}/related`, { limit: 30 });
  return mapTracks(data.collection);
}

export async function user(id: string): Promise<Artist> {
  const raw = await call<RawUser>(`/users/${encodeURIComponent(id)}`);
  const mapped = mapUser(raw);
  if (!mapped) throw new Error('SoundCloud: артист не найден');
  return mapped;
}

export async function artistTracks(id: string, cursor: string | null = null): Promise<Page<Track>> {
  const next = cursorUrl(cursor);
  const data = next
    ? await call<Collection<RawTrack>>(next)
    : await call<Collection<RawTrack>>(`/users/${encodeURIComponent(id)}/tracks`, { limit: PAGE, linked_partitioning: 1 });
  return page(data, mapTrack);
}

export async function artistPage(id: string): Promise<ArtistPage> {
  const enc = encodeURIComponent(id);
  const [artist, top, albums, playlists, tracks, similar] = await Promise.allSettled([
    user(id),
    call<Collection<RawTrack>>(`/users/${enc}/toptracks`, { limit: 10, linked_partitioning: 1 }),
    call<Collection<RawPlaylist>>(`/users/${enc}/albums`, { limit: 20, linked_partitioning: 1 }),
    call<Collection<RawPlaylist>>(`/users/${enc}/playlists_without_albums`, { limit: 20, linked_partitioning: 1 }),
    artistTracks(id),
    call<Collection<RawUser>>(`/users/${enc}/relatedartists`, { limit: 12, linked_partitioning: 1 }),
  ]);
  if (artist.status === 'rejected') throw artist.reason;
  const topTracks = top.status === 'fulfilled' ? mapTracks(top.value.collection) : [];
  const allTracks = tracks.status === 'fulfilled' ? tracks.value : { items: [], next: null };
  const albumList = albums.status === 'fulfilled' ? page(albums.value, mapPlaylist).items : [];
  return {
    artist: artist.value,
    topTracks: topTracks.length ? topTracks : allTracks.items.slice(0, 10),
    albums: albumList.filter((a) => a.kind !== 'single'),
    singles: albumList.filter((a) => a.kind === 'single'),
    playlists: playlists.status === 'fulfilled' ? page(playlists.value, mapPlaylist).items : [],
    similar: similar.status === 'fulfilled' ? page(similar.value, mapUser).items : [],
    tracksNext: allTracks.next,
  };
}

export async function playlist(id: string): Promise<PlaylistDetails> {
  const isSystem = id.startsWith('soundcloud:system-playlists:');
  const raw = isSystem
    ? await call<RawPlaylist>(`/system-playlists/${encodeURIComponent(id)}`)
    : await call<RawPlaylist>(`/playlists/${encodeURIComponent(id)}`, { representation: 'full' });
  const mapped = mapPlaylist({ ...raw, urn: isSystem ? id : raw.urn });
  if (!mapped) throw new Error('SoundCloud: плейлист не найден');
  const tracks = await hydrate(raw.tracks);
  return { playlist: { ...mapped, trackCount: mapped.trackCount ?? tracks.length }, tracks };
}

// ---------- главная: чарты, жанры, подборки ----------

export interface ScGenre {
  id: string;
  name: string;
  query: string;
  color: string;
}

/** Жанры чартов SoundCloud (ключи `soundcloud:genres:*`). Цвет: только лёгкий оттенок плитки. */
export const SC_GENRES: ScGenre[] = [
  { id: 'hiphoprap', name: 'Хип-хоп и рэп', query: 'hip hop', color: '#f28b50' },
  { id: 'pop', name: 'Поп', query: 'pop', color: '#f06292' },
  { id: 'electronic', name: 'Электроника', query: 'electronic', color: '#7c8cff' },
  { id: 'danceedm', name: 'Dance & EDM', query: 'edm', color: '#4fc3f7' },
  { id: 'house', name: 'Хаус', query: 'house', color: '#26c6da' },
  { id: 'techno', name: 'Техно', query: 'techno', color: '#90a4ae' },
  { id: 'rbsoul', name: 'R&B и соул', query: 'rnb', color: '#ba68c8' },
  { id: 'rock', name: 'Рок', query: 'rock', color: '#ef5350' },
  { id: 'alternativerock', name: 'Альтернатива', query: 'alternative', color: '#ff8a65' },
  { id: 'indie', name: 'Инди', query: 'indie', color: '#aed581' },
  { id: 'drumbass', name: 'Драм-н-бейс', query: 'drum and bass', color: '#4db6ac' },
  { id: 'trap', name: 'Трэп', query: 'trap', color: '#ffb74d' },
  { id: 'ambient', name: 'Эмбиент', query: 'ambient', color: '#81d4fa' },
  { id: 'jazzblues', name: 'Джаз и блюз', query: 'jazz', color: '#ffd54f' },
  { id: 'classical', name: 'Классика', query: 'classical', color: '#b0bec5' },
  { id: 'metal', name: 'Метал', query: 'metal', color: '#9e9e9e' },
];

/** Топ SoundCloud по жанру. Порядок попыток: чарты → системный плейлист → поиск по жанру. */
export async function chartTracks(genre = 'all-music', kind: 'top' | 'trending' = 'top'): Promise<Track[]> {
  try {
    const data = await call<Collection<{ track?: RawTrack }>>('/charts', {
      kind,
      genre: `soundcloud:genres:${genre}`,
      limit: 50,
      linked_partitioning: 1,
    });
    const tracks = await hydrate((data.collection ?? []).map((c) => c.track).filter((t): t is RawTrack => !!t));
    if (tracks.length) return tracks;
  } catch {
    /* следующий способ */
  }
  try {
    const urn = `soundcloud:system-playlists:charts-${kind}:${genre}`;
    const details = await playlist(urn);
    if (details.tracks.length) return details.tracks;
  } catch {
    /* следующий способ */
  }
  const meta = SC_GENRES.find((g) => g.id === genre);
  const query = meta?.query ?? (genre === 'all-music' ? 'top hits' : genre);
  const data = await call<Collection<RawTrack>>('/search/tracks', {
    q: query,
    'filter.genre_or_tag': meta?.query ?? undefined,
    limit: 50,
    linked_partitioning: 1,
  });
  return mapTracks(data.collection).sort((a, b) => (b.plays ?? 0) - (a.plays ?? 0));
}

/** Подборки SoundCloud с главной страницы сайта. */
export async function shelves(): Promise<Shelf[]> {
  interface Selection {
    id?: string;
    urn?: string;
    title?: string;
    items?: { collection?: RawPlaylist[] };
  }
  const data = await call<Collection<Selection>>('/mixed-selections', { limit: 10, linked_partitioning: 1 });
  return (data.collection ?? [])
    .map((s, i) => ({
      id: s.urn || s.id || `sel-${i}`,
      title: s.title || 'Подборка',
      playlists: (s.items?.collection ?? []).map(mapPlaylist).filter((p): p is Playlist => p !== null),
    }))
    .filter((s) => s.playlists.length > 0);
}

/** Разбор ссылки soundcloud.com/… (вставили в поиск). */
export async function resolveUrl(link: string): Promise<{ track?: Track; artist?: Artist; playlist?: Playlist } | null> {
  const raw = await call<RawTrack & RawUser & RawPlaylist & { kind?: string }>('/resolve', { url: link });
  if (raw.kind === 'track') {
    const t = mapTrack(raw);
    return t ? { track: t } : null;
  }
  if (raw.kind === 'user') {
    const a = mapUser(raw);
    return a ? { artist: a } : null;
  }
  if (raw.kind === 'playlist' || raw.kind === 'system-playlist') {
    const p = mapPlaylist(raw);
    return p ? { playlist: p } : null;
  }
  return null;
}

// ---------- поток ----------

/** Чем выше, тем лучше: progressive AAC → HLS AAC → progressive MP3 → HLS MP3 → Opus. */
export function transcodingScore(t: RawTranscoding): number {
  const mime = (t.format?.mime_type ?? '').toLowerCase();
  const progressive = (t.format?.protocol ?? '') === 'progressive';
  let score = 0;
  if (/mp4a|aac|audio\/mp4/.test(mime)) score += 30;
  else if (/mpeg/.test(mime)) score += 20;
  else if (/opus|ogg/.test(mime)) score += 8;
  if (progressive) score += 5;
  if (t.quality === 'hq') score += 2;
  if (t.snipped) score -= 100;
  return score;
}

export function rankTranscodings(list: RawTranscoding[]): RawTranscoding[] {
  return list
    .filter(usableTranscoding)
    .map((t) => ({ t, s: transcodingScore(t) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.t);
}

const PREVIEW_URL = /\/(preview|playlist)\/0\/30\//;

export async function resolveStream(id: string): Promise<ResolvedStream> {
  const raw = await call<RawTrack>(`/tracks/${encodeURIComponent(id)}`);
  if ((raw.policy ?? '').toUpperCase() === 'BLOCK') throw new Error('Трек недоступен в вашем регионе');
  const candidates = rankTranscodings(raw.media?.transcodings ?? []);
  if (!candidates.length) throw new Error('SoundCloud не отдаёт этот трек для прослушивания');
  let lastError: unknown = null;
  for (const t of candidates) {
    try {
      const params: Params = raw.track_authorization ? { track_authorization: raw.track_authorization } : {};
      const res = await call<{ url?: string }>(t.url, params);
      if (!res.url) continue;
      const url = await invoke<string>('register_stream', { url: res.url });
      return {
        url,
        kind: t.format?.protocol === 'hls' ? 'hls' : 'progressive',
        preview: !!t.snipped || PREVIEW_URL.test(res.url) || (raw.policy ?? '').toUpperCase() === 'SNIP',
      };
    } catch (e) {
      lastError = e;
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error('SoundCloud не вернул ссылку на аудио');
}
