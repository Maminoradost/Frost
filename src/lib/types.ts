/** Источники, которые умеет искать и играть Frost v0.2. */
export type SourceProvider = 'soundcloud' | 'youtube';
/** Провайдер трека. `audius`/`jamendo` остались в медиатеке от v0.1: такие треки
 *  Frost находит заново в SoundCloud/YouTube Music по названию («умная подмена»). */
export type Provider = SourceProvider | 'audius' | 'jamendo' | 'local';

export interface Track {
  id: string;
  provider: Provider;
  title: string;
  artist: string;
  artistId: string | null;
  album: string | null;
  albumId?: string | null;
  artwork: string | null;
  artworkSmall: string | null;
  /** Секунды. */
  duration: number;
  permalink: string | null;
  genre: string | null;
  plays: number | null;
  likes: number | null;
  streamable: boolean;
  /** Доступен только 30-секундный фрагмент (SoundCloud Go+). */
  previewOnly: boolean;
}

export interface Artist {
  id: string;
  provider: Provider;
  name: string;
  handle: string | null;
  avatar: string | null;
  cover: string | null;
  followers: number | null;
  trackCount: number | null;
  bio: string | null;
  permalink: string | null;
  verified: boolean;
}

export type PlaylistKind = 'playlist' | 'album' | 'single' | 'ep' | string;

export interface Playlist {
  id: string;
  provider: Provider;
  title: string;
  owner: string | null;
  ownerId?: string | null;
  artwork: string | null;
  trackCount: number | null;
  description: string | null;
  permalink: string | null;
  kind?: PlaylistKind;
  year?: number | null;
}

export interface Page<T> {
  items: T[];
  next: string | null;
}

export interface PlaylistDetails {
  playlist: Playlist;
  tracks: Track[];
}

export interface SearchResults {
  tracks: Track[];
  artists: Artist[];
  albums: Playlist[];
  playlists: Playlist[];
  tracksNext: string | null;
  corrected: string | null;
}

export interface ArtistPage {
  artist: Artist;
  topTracks: Track[];
  albums: Playlist[];
  singles: Playlist[];
  playlists: Playlist[];
  similar: Artist[];
  tracksNext: string | null;
}

export interface Charts {
  country: string | null;
  countries: string[];
  top: Track[];
  trending: Track[];
  artists: Artist[];
  playlists: Playlist[];
}

export interface Genre {
  id: string;
  provider: Provider;
  name: string;
  color: string | null;
  isMood: boolean;
}

export interface GenreSection {
  title: string;
  playlists: Playlist[];
}

export interface GenrePage {
  id: string;
  provider: Provider;
  title: string;
  sections: GenreSection[];
  tracks: Track[];
}

/** Подборка на главной (SoundCloud «mixed selections»). */
export interface Shelf {
  id: string;
  title: string;
  playlists: Playlist[];
}

export interface ResolvedStream {
  url: string;
  kind: 'progressive' | 'hls';
  preview: boolean;
}

export interface Lyrics {
  synced: string | null;
  plain: string | null;
  instrumental: boolean;
  source: string;
  /** Страница текста (Genius), если есть. */
  url?: string | null;
}

export type NetMode = 'system' | 'custom' | 'direct';
export type YtEngine = 'auto' | 'rustypipe' | 'ytdlp';

/** Настройки ядра (config.json в Rust). Никаких ключей API. */
export interface AppConfig {
  netMode: NetMode;
  proxyUrl: string;
  soundcloud: boolean;
  youtube: boolean;
  ytEngine: YtEngine;
  ytdlpPath: string;
  region: string;
  language: string;
  /** Хранить скачанные треки YouTube на диске. */
  audioCache: boolean;
  /** Предел кэша, МБ. */
  audioCacheMb: number;
}

export const DEFAULT_CONFIG: AppConfig = {
  netMode: 'system',
  proxyUrl: '',
  soundcloud: true,
  youtube: true,
  ytEngine: 'auto',
  ytdlpPath: '',
  region: 'RU',
  language: 'ru',
  audioCache: true,
  audioCacheMb: 2048,
};

export interface YtdlpStatus {
  installed: boolean;
  path: string | null;
  version: string | null;
  deno: boolean;
  managed: boolean;
  rustypipe: boolean;
  /** Установлен rustypipe-botguard (PO-токены для RustyPipe). */
  botguard: boolean;
}

export interface AudioCacheInfo {
  files: number;
  bytes: number;
  limitMb: number;
  enabled: boolean;
  path: string | null;
}

export interface AppInfo {
  version: string;
  rustypipe: boolean;
}

export interface LocalPlaylist {
  id: string;
  name: string;
  description: string;
  tracks: Track[];
  createdAt: number;
  updatedAt: number;
}

export interface HistoryEntry {
  track: Track;
  playedAt: number;
}

export type RepeatMode = 'off' | 'all' | 'one';
/** glass: размытие за окном (не пропадает без фокуса), acrylic: DWM-акрил, mica/tabbed: Mica / Mica Alt. */
export type BackdropEffect = 'glass' | 'acrylic' | 'mica' | 'tabbed' | 'none';
export type ThemeMode = 'dark' | 'light' | 'system';
export type SearchSource = 'all' | SourceProvider;

export const trackKey = (t: Pick<Track, 'provider' | 'id'>): string => `${t.provider}:${t.id}`;

export const isSourceProvider = (p: Provider | string): p is SourceProvider =>
  p === 'soundcloud' || p === 'youtube';

export function uniqueTracks(list: Track[]): Track[] {
  const seen = new Set<string>();
  const out: Track[] = [];
  for (const t of list) {
    const key = trackKey(t);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}
