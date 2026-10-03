/**
 * Единая точка доступа к источникам.
 * SoundCloud: TS-клиент веб-API (`soundcloud.ts`), YouTube Music: команды Rust-ядра.
 */
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import * as sc from './soundcloud';
import { bestMatch, searchQuery } from './match';
import type {
  YtEngine,
  AppConfig,
  AppInfo,
  Artist,
  ArtistPage,
  Charts,
  Genre,
  GenrePage,
  Lyrics,
  Page,
  Playlist,
  PlaylistDetails,
  Provider,
  ResolvedStream,
  SearchResults,
  Shelf,
  SourceProvider,
  Track,
  YtdlpStatus,
  AudioCacheInfo,
} from './types';
import { isSourceProvider } from './types';

function unsupported(provider: Provider): never {
  throw new Error(`Источник «${provider}» больше не поддерживается: трек будет найден заново в SoundCloud или YouTube Music`);
}

const emptyResults = (): SearchResults => ({
  tracks: [],
  artists: [],
  albums: [],
  playlists: [],
  tracksNext: null,
  corrected: null,
});

/**
 * Состояние YouTube на время сессии. `preferYtdlp` включается, когда поток RustyPipe
 * оборвался (YouTube требует PO-токен): дальше звук берём сразу через yt-dlp.
 */
export const ytSession = { preferYtdlp: false };
let ytdlpTask: Promise<YtdlpStatus> | null = null;
let denoTask: Promise<YtdlpStatus> | null = null;

export const api = {
  // ---------- поиск ----------
  searchAll: (provider: SourceProvider, query: string): Promise<SearchResults> =>
    provider === 'soundcloud' ? sc.searchAll(query) : invoke<SearchResults>('yt_search', { query }),

  searchTracks: async (provider: SourceProvider, query: string, cursor: string | null = null): Promise<Page<Track>> => {
    if (provider === 'soundcloud') return sc.searchTracks(query, cursor);
    if (cursor) return { items: [], next: null };
    return { items: await invoke<Track[]>('yt_search_tracks', { query }), next: null };
  },

  searchArtists: async (provider: SourceProvider, query: string, cursor: string | null = null): Promise<Page<Artist>> => {
    if (provider === 'soundcloud') return sc.searchUsers(query, cursor);
    if (cursor) return { items: [], next: null };
    return { items: (await invoke<SearchResults>('yt_search', { query })).artists, next: null };
  },

  searchPlaylists: async (provider: SourceProvider, query: string, cursor: string | null = null): Promise<Page<Playlist>> => {
    if (provider === 'soundcloud') return sc.searchPlaylists(query, cursor);
    if (cursor) return { items: [], next: null };
    const res = await invoke<SearchResults>('yt_search', { query });
    return { items: [...res.albums, ...res.playlists], next: null };
  },

  suggestions: (query: string): Promise<string[]> => sc.suggestions(query),

  // ---------- страницы ----------
  artistPage: (provider: Provider, id: string): Promise<ArtistPage> => {
    if (provider === 'soundcloud') return sc.artistPage(id);
    if (provider === 'youtube') return invoke<ArtistPage>('yt_artist', { id });
    return unsupported(provider);
  },

  artistTracks: async (provider: Provider, id: string, cursor: string | null = null): Promise<Page<Track>> => {
    if (provider === 'soundcloud') return sc.artistTracks(id, cursor);
    if (provider === 'youtube') {
      if (cursor) return { items: [], next: null };
      return { items: (await invoke<ArtistPage>('yt_artist', { id })).topTracks, next: null };
    }
    return unsupported(provider);
  },

  playlist: (provider: Provider, id: string): Promise<PlaylistDetails> => {
    if (provider === 'soundcloud') return sc.playlist(id);
    if (provider === 'youtube') return invoke<PlaylistDetails>('yt_playlist', { id });
    return unsupported(provider);
  },

  related: async (provider: Provider, id: string, seed?: Track): Promise<Track[]> => {
    if (provider === 'soundcloud') return sc.related(id);
    if (provider === 'youtube') return invoke<Track[]>('yt_radio', { id });
    // Трек из старой медиатеки: радио по исполнителю.
    if (seed?.artist) return (await sc.searchTracks(seed.artist)).items;
    return [];
  },

  // ---------- главная ----------
  charts: (country: string | null): Promise<Charts> => invoke<Charts>('yt_charts', { country }),
  newReleases: (): Promise<Playlist[]> => invoke<Playlist[]>('yt_new_releases'),
  genres: (): Promise<Genre[]> => invoke<Genre[]>('yt_genres'),
  genrePage: (provider: Provider, id: string): Promise<GenrePage> => {
    if (provider === 'youtube') return invoke<GenrePage>('yt_genre', { id });
    const meta = sc.SC_GENRES.find((g) => g.id === id);
    return sc.chartTracks(id).then((tracks) => ({
      id,
      provider: 'soundcloud' as const,
      title: meta?.name ?? id,
      sections: [],
      tracks,
    }));
  },
  scCharts: (genre = 'all-music', kind: 'top' | 'trending' = 'top'): Promise<Track[]> => sc.chartTracks(genre, kind),
  scShelves: (): Promise<Shelf[]> => sc.shelves(),

  // ---------- воспроизведение ----------
  /** `engine` — принудительный движок YouTube (повторная попытка из плеера). */
  resolveStream: (provider: Provider, id: string, opts?: { engine?: YtEngine }): Promise<ResolvedStream> => {
    if (provider === 'soundcloud') return sc.resolveStream(id);
    if (provider === 'youtube') {
      // Ядро само помнит, какой способ сработал в этом сеансе (ytaudio.rs): движок
      // передаём, только если его выбрали явно (восстановление после ошибки).
      const engine = opts?.engine;
      return invoke<ResolvedStream>('yt_stream', { id, engine: engine ?? null });
    }
    return unsupported(provider);
  },

  /**
   * Гарантирует, что yt-dlp установлен (один запрос на всю сессию, даже если его
   * одновременно просят фоновая установка и плеер).
   */
  ensureYtdlp: (): Promise<YtdlpStatus> => {
    if (!ytdlpTask) {
      ytdlpTask = (async () => {
        const status = await invoke<YtdlpStatus>('ytdlp_status');
        return status.installed ? status : invoke<YtdlpStatus>('ytdlp_install');
      })().catch((e: unknown) => {
        ytdlpTask = null;
        throw e;
      });
    }
    return ytdlpTask;
  },

  /** То же для Deno (JS-движок, которым yt-dlp проходит проверки YouTube). */
  ensureDeno: (): Promise<YtdlpStatus> => {
    if (!denoTask) {
      denoTask = (async () => {
        const status = await invoke<YtdlpStatus>('ytdlp_status');
        return status.deno ? status : invoke<YtdlpStatus>('deno_install');
      })().catch((e: unknown) => {
        denoTask = null;
        throw e;
      });
    }
    return denoTask;
  },

  /** Ищет тот же трек в другом источнике (для превью, недоступных и старых треков). */
  findAlternative: async (track: Track, provider: SourceProvider): Promise<Track | null> => {
    try {
      const query = searchQuery(track);
      const page = await api.searchTracks(provider, query);
      return bestMatch(track, page.items);
    } catch {
      return null;
    }
  },

  /**
   * Поток с «умной подменой»: если трек обрезан (Go+ превью), недоступен или из старого
   * источника, играем тот же трек из другого источника. `via` — чем подменили.
   */
  resolvePlayable: async (
    track: Track,
    options: { smart: boolean; order: SourceProvider[] },
  ): Promise<{ stream: ResolvedStream; via: Track | null }> => {
    // Файлы с компьютера играют напрямую через протокол asset
    if (track.provider === 'local') {
      return { stream: { url: convertFileSrc(track.id), kind: 'progressive', preview: false }, via: null };
    }
    let firstError: unknown = null;
    let preview: ResolvedStream | null = null;
    if (isSourceProvider(track.provider) && options.order.includes(track.provider)) {
      try {
        const stream = await api.resolveStream(track.provider, track.id);
        if (!stream.preview || !options.smart) return { stream, via: null };
        preview = stream;
      } catch (e) {
        firstError = e;
      }
    }
    if (options.smart) {
      for (const provider of options.order) {
        if (provider === track.provider) continue;
        const alt = await api.findAlternative(track, provider);
        if (!alt) continue;
        try {
          const stream = await api.resolveStream(alt.provider, alt.id);
          if (!stream.preview) return { stream, via: alt };
        } catch {
          /* пробуем следующий источник */
        }
      }
    }
    if (preview) return { stream: preview, via: null };
    if (firstError) throw firstError;
    throw new Error('Трек недоступен ни в одном из включённых источников');
  },

  lyrics: (track: Track): Promise<Lyrics | null> =>
    invoke<Lyrics | null>('get_lyrics', {
      provider: isSourceProvider(track.provider) ? track.provider : 'soundcloud',
      id: track.id,
      artist: track.artist,
      title: track.title,
      duration: track.duration,
    }),

  // ---------- ссылки ----------
  resolveUrl: async (link: string): Promise<{ track?: Track; artist?: Artist; playlist?: Playlist } | null> => {
    const url = link.trim();
    if (/^https?:\/\/(www\.|m\.|on\.)?soundcloud\.com\//i.test(url)) return sc.resolveUrl(url);
    const yt = /(?:youtube\.com\/watch\?[^#]*v=|youtu\.be\/|music\.youtube\.com\/watch\?[^#]*v=)([\w-]{11})/i.exec(url);
    if (yt) return { track: await invoke<Track>('yt_track', { id: yt[1] }) };
    const list = /[?&]list=([\w-]+)/i.exec(url);
    if (list && /youtube\.com/i.test(url)) {
      const details = await invoke<PlaylistDetails>('yt_playlist', { id: list[1] });
      return { playlist: details.playlist };
    }
    const channel = /music\.youtube\.com\/(?:channel|browse)\/([\w-]+)/i.exec(url);
    if (channel) {
      if (channel[1].startsWith('MPREb')) {
        const details = await invoke<PlaylistDetails>('yt_playlist', { id: channel[1] });
        return { playlist: details.playlist };
      }
      const page = await invoke<ArtistPage>('yt_artist', { id: channel[1] });
      return { artist: page.artist };
    }
    return null;
  },

  // ---------- ядро ----------
  getConfig: () => invoke<AppConfig>('get_config'),
  setConfig: (config: AppConfig) => invoke<void>('set_config', { config }),
  appInfo: () => invoke<AppInfo>('app_info'),
  ytdlpStatus: () => invoke<YtdlpStatus>('ytdlp_status'),
  ytdlpInstall: () => invoke<YtdlpStatus>('ytdlp_install'),
  ytdlpUpdate: () => invoke<YtdlpStatus>('ytdlp_update'),
  denoInstall: () => invoke<YtdlpStatus>('deno_install'),
  botguardInstall: () => invoke<YtdlpStatus>('botguard_install'),
  botguardRemove: () => invoke<YtdlpStatus>('botguard_remove'),
  /** Заранее скачать трек YouTube (следующий в очереди). Ошибки не важны. */
  ytPrefetch: (id: string) => invoke<void>('yt_prefetch', { id }).catch(() => undefined),
  ytCacheInfo: () => invoke<AudioCacheInfo>('yt_cache_info'),
  ytCacheClear: () => invoke<AudioCacheInfo>('yt_cache_clear'),
  /** Проверка способов получить звук YouTube: текстовый отчёт. */
  ytDiagnose: (id?: string) => invoke<string>('yt_diagnose', { id: id ?? null }),

  /** Проверка источника: короткий поиск. */
  testSource: async (provider: SourceProvider): Promise<number> => {
    const started = performance.now();
    const res = await api.searchTracks(provider, 'Michael Jackson Billie Jean');
    if (!res.items.length) throw new Error('Источник ответил, но ничего не нашёл');
    return Math.round(performance.now() - started);
  },

  emptyResults,
};

/** Текст ошибки для тоста/карточки: без HTML и простыней. */
export function errorText(e: unknown): string {
  let text: string;
  if (typeof e === 'string') text = e;
  else if (e instanceof Error) text = e.message;
  else {
    try {
      text = JSON.stringify(e);
    } catch {
      text = String(e);
    }
  }
  if (/<\s*(!doctype|html|head|body)\b/i.test(text)) {
    return 'Сервис вернул страницу вместо данных: вероятно, он недоступен из вашей сети';
  }
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}
