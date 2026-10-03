/**
 * Скробблинг: ListenBrainz (токен из профиля) и Last.fm (вход через сайт Last.fm).
 * Правило общее: трек длиннее 30 секунд засчитывается, когда прослушана половина
 * или 4 минуты. Неотправленное из-за сети копится и уходит позже.
 */
import { invoke } from '@tauri-apps/api/core';
import { tr } from './i18n';
import { LASTFM_API_KEY, LASTFM_API_SECRET } from './links';
import { md5 } from './md5';
import type { Track } from './types';
import { APP_VERSION } from './version';

export interface ScrobbleTrack {
  artist: string;
  title: string;
  album?: string | null;
  /** Секунды. */
  duration?: number;
  url?: string | null;
}

export function toScrobble(track: Track): ScrobbleTrack {
  return {
    artist: track.artist.replace(/\s+-\s+Topic$/i, '').trim(),
    title: track.title.trim(),
    album: track.album,
    duration: track.duration || undefined,
    url: track.permalink,
  };
}

/** Когда засчитывать прослушивание (секунды) или null, если трек слишком короткий. */
export function scrobbleThreshold(duration: number): number | null {
  if (!duration || duration < 30) return duration > 0 ? null : 240;
  return Math.min(240, duration / 2);
}

interface NetResponse {
  status: number;
  body: string;
}

function send(url: string, body: string, opts: { contentType?: string; authorization?: string; method?: 'GET' | 'POST' } = {}) {
  return invoke<NetResponse>('net_post', {
    url,
    body,
    contentType: opts.contentType ?? null,
    authorization: opts.authorization ?? null,
    method: opts.method ?? null,
  });
}

export class ScrobbleError extends Error {
  constructor(
    message: string,
    /** Повторять бессмысленно: неверный токен, сессия отозвана. */
    readonly fatal: boolean,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// ListenBrainz
// ---------------------------------------------------------------------------

const LB = 'https://api.listenbrainz.org/1';

export function listenbrainzPayload(kind: 'playing_now' | 'single', t: ScrobbleTrack, listenedAt?: number) {
  const additional: Record<string, string | number> = {
    media_player: 'Frost',
    submission_client: 'Frost',
    submission_client_version: APP_VERSION,
  };
  if (t.duration) additional.duration_ms = Math.round(t.duration * 1000);
  if (t.url) additional.origin_url = t.url;
  const track_metadata: Record<string, unknown> = {
    artist_name: t.artist,
    track_name: t.title,
    additional_info: additional,
  };
  if (t.album) track_metadata.release_name = t.album;
  const item = kind === 'single' ? { listened_at: listenedAt ?? Math.floor(Date.now() / 1000), track_metadata } : { track_metadata };
  return { listen_type: kind, payload: [item] };
}

/** Проверяет токен и возвращает имя пользователя. */
export async function listenbrainzValidate(token: string): Promise<string> {
  const res = await send(`${LB}/validate-token`, '', { method: 'GET', authorization: `Token ${token.trim()}` });
  const data = JSON.parse(res.body || '{}') as { valid?: boolean; user_name?: string };
  if (res.status !== 200 || !data.valid || !data.user_name) throw new ScrobbleError(tr('Токен не подошёл'), true);
  return data.user_name;
}

export async function listenbrainzSubmit(token: string, kind: 'playing_now' | 'single', t: ScrobbleTrack, listenedAt?: number) {
  const res = await send(`${LB}/submit-listens`, JSON.stringify(listenbrainzPayload(kind, t, listenedAt)), {
    authorization: `Token ${token.trim()}`,
  });
  if (res.status === 401) throw new ScrobbleError(tr('ListenBrainz: токен больше не действует'), true);
  if (res.status >= 400) throw new ScrobbleError(`ListenBrainz: HTTP ${res.status}`, res.status === 400);
}

// ---------------------------------------------------------------------------
// Last.fm
// ---------------------------------------------------------------------------

const LASTFM = 'https://ws.audioscrobbler.com/2.0/';

export const lastfmAvailable = () => Boolean(LASTFM_API_KEY && LASTFM_API_SECRET);

/** Подпись api_sig: параметры по алфавиту «имязначение», затем секрет, MD5. */
export function lastfmSign(params: Record<string, string>, secret: string): string {
  const keys = Object.keys(params)
    .filter((k) => k !== 'format' && k !== 'callback')
    .sort();
  return md5(keys.map((k) => k + params[k]).join('') + secret);
}

export function lastfmBody(params: Record<string, string>, key = LASTFM_API_KEY, secret = LASTFM_API_SECRET): string {
  const all = { ...params, api_key: key };
  const body = new URLSearchParams({ ...all, api_sig: lastfmSign(all, secret), format: 'json' });
  return body.toString();
}

async function lastfmCall<T>(params: Record<string, string>): Promise<T> {
  if (!lastfmAvailable()) throw new ScrobbleError(tr('Last.fm не настроен в этой сборке'), true);
  const res = await send(LASTFM, lastfmBody(params), { contentType: 'application/x-www-form-urlencoded' });
  let data: { error?: number; message?: string } & Record<string, unknown> = {};
  try {
    data = JSON.parse(res.body || '{}');
  } catch {
    /* не JSON: ниже по статусу */
  }
  if (data.error) {
    // 9 — сессия недействительна, 4/10/26 — ключ или доступ, 14 — токен ещё не подтверждён
    const fatal = [4, 9, 10, 26].includes(data.error);
    throw new ScrobbleError(`Last.fm: ${data.message ?? data.error}`, fatal);
  }
  if (res.status >= 400) throw new ScrobbleError(`Last.fm: HTTP ${res.status}`, false);
  return data as T;
}

export async function lastfmGetToken(): Promise<string> {
  const data = await lastfmCall<{ token?: string }>({ method: 'auth.getToken' });
  if (!data.token) throw new ScrobbleError(tr('Last.fm не выдал токен'), false);
  return data.token;
}

export const lastfmAuthUrl = (token: string) =>
  `https://www.last.fm/api/auth/?api_key=${encodeURIComponent(LASTFM_API_KEY)}&token=${encodeURIComponent(token)}`;

export async function lastfmGetSession(token: string): Promise<{ name: string; key: string }> {
  const data = await lastfmCall<{ session?: { name: string; key: string } }>({ method: 'auth.getSession', token });
  if (!data.session?.key) throw new ScrobbleError(tr('Вход в Last.fm не подтверждён'), false);
  return data.session;
}

function trackParams(t: ScrobbleTrack): Record<string, string> {
  const p: Record<string, string> = { artist: t.artist, track: t.title };
  if (t.album) p.album = t.album;
  if (t.duration) p.duration = String(Math.round(t.duration));
  return p;
}

export async function lastfmNowPlaying(sk: string, t: ScrobbleTrack) {
  await lastfmCall({ method: 'track.updateNowPlaying', sk, ...trackParams(t) });
}

export async function lastfmScrobble(sk: string, t: ScrobbleTrack, timestamp: number) {
  await lastfmCall({ method: 'track.scrobble', sk, timestamp: String(timestamp), ...trackParams(t) });
}

// ---------------------------------------------------------------------------
// Очередь неотправленного
// ---------------------------------------------------------------------------

export interface PendingScrobble {
  service: 'listenbrainz' | 'lastfm';
  track: ScrobbleTrack;
  /** Unix-время начала прослушивания, секунды. */
  at: number;
}

const QUEUE_KEY = 'frost.scrobble-queue';

export function loadQueue(): PendingScrobble[] {
  try {
    const list = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as PendingScrobble[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveQueue(list: PendingScrobble[]) {
  try {
    // Last.fm принимает скробблы не старше двух недель
    const fresh = list.filter((p) => Date.now() / 1000 - p.at < 13 * 24 * 3600).slice(-300);
    if (fresh.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(fresh));
    else localStorage.removeItem(QUEUE_KEY);
  } catch {
    /* нет места: не страшно */
  }
}
