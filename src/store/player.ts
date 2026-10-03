import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { engine } from '../audio/engine';
import { bindMediaActions, setPlaybackState, setPositionState, updateMediaMetadata } from '../audio/mediaSession';
import { api, errorText, ytSession } from '../lib/api';
import { providerMeta } from '../lib/providers';
import { shuffled } from '../lib/format';
import type { RepeatMode, ResolvedStream, SourceProvider, Track } from '../lib/types';
import { trackKey } from '../lib/types';
import { useLibrary } from './library';
import { enabledSources, useSettings } from './settings';
import { updateYtdlpIfNeeded } from '../lib/updates';
import { consumeStopAtTrackEnd, useSleep } from './sleep';
import { toast } from './ui';

interface PlayerState {
  current: Track | null;
  /** Контекст (плейлист, выдача поиска…) в порядке воспроизведения (перемешан при shuffle). */
  queue: Track[];
  /** Контекст в исходном порядке: нужен, чтобы выключить shuffle. */
  original: Track[];
  /** Позиция текущего/последнего трека контекста в `queue`. */
  index: number;
  /** Пользовательская очередь («Играть следующим», «Добавить в очередь»). */
  upNext: Track[];
  source: string | null;

  isPlaying: boolean;
  isLoading: boolean;
  isPreview: boolean;
  /** Трек из другого источника, которым подменили текущий (умная подмена). */
  via: Track | null;
  loaded: boolean;
  duration: number;
  shuffle: boolean;
  repeat: RepeatMode;
  volume: number;
  muted: boolean;
  /** Растёт с каждым новым запуском трека (и повтором): по нему считаются прослушивания. */
  playId: number;

  playList: (tracks: Track[], startIndex?: number, source?: string | null) => void;
  playShuffled: (tracks: Track[], source?: string | null) => void;
  playTrack: (track: Track, source?: string | null) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  next: (auto?: boolean) => Promise<void>;
  prev: () => void;
  seek: (time: number) => void;
  seekBy: (delta: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  addToQueue: (track: Track) => void;
  playNext: (track: Track) => void;
  removeFromUpNext: (index: number) => void;
  moveUpNext: (from: number, to: number) => void;
  clearUpNext: () => void;
  jumpToQueue: (index: number) => void;
  jumpToUpNext: (index: number) => void;
  startRadio: (seed: Track) => Promise<void>;
}

let loadSeq = 0;
/** Сколько шагов восстановления уже потрачено на текущий трек (см. `recover`). */
const recovery = { key: '', stage: 0 };
let errorStreak = 0;

/** Заранее найденный поток следующего трека (для плавного перехода и короткой паузы между треками). */
interface Prepared {
  key: string;
  /** loadSeq трека, после которого он должен играть. */
  seq: number;
  at: number;
  stream: ResolvedStream;
  via: Track | null;
}
let prepared: Prepared | null = null;
let prepareTried = { key: '', seq: -1 };
let fadeStartedFor = -1;

interface LoadOptions {
  pre?: Prepared;
  /** Длительность плавного перехода, секунды. */
  fade?: number;
}

async function loadTrack(track: Track, autoplay: boolean, opts: LoadOptions = {}) {
  recovery.key = '';
  const seq = ++loadSeq;
  prepared = null;
  usePlayer.setState({
    current: track,
    isLoading: !opts.fade,
    loaded: false,
    isPreview: track.previewOnly,
    via: null,
    duration: track.duration || 0,
    playId: usePlayer.getState().playId + 1,
  });
  updateMediaMetadata(track);
  try {
    const { stream, via } =
      opts.pre ??
      (await api.resolvePlayable(track, {
        smart: useSettings.getState().smartFallback,
        order: enabledSources(),
      }));
    if (seq !== loadSeq) return;
    if (opts.fade) await engine.crossfadeTo(stream, opts.fade);
    else await engine.load(stream, autoplay);
    if (seq !== loadSeq) return;
    usePlayer.setState({ loaded: true, isPreview: stream.preview, via, isLoading: autoplay });
    if (autoplay) useLibrary.getState().addHistory(track);
  } catch (e) {
    if (seq !== loadSeq) return;
    usePlayer.setState({ isLoading: false, isPlaying: false });
    handleError(errorText(e));
  }
}

/** После ошибки пробуем следующий трек, но не больше трёх раз подряд. */
/**
 * Восстановление после обрыва потока, прежде чем сдаться и перейти к следующему треку.
 * 1. YouTube: тот же трек через yt-dlp с той же секунды. Потоки RustyPipe без PO-токена
 *    YouTube обрывает через секунду-две; при второй неудаче ставим Deno и пробуем снова.
 * 2. Умная подмена: тот же трек из другого источника.
 * Возвращает true, если воспроизведение удалось спасти (или пользователь уже включил другое).
 */
async function recover(): Promise<boolean> {
  const { current: track, via } = usePlayer.getState();
  if (!track) return false;
  const key = trackKey(track);
  if (recovery.key !== key) {
    recovery.key = key;
    recovery.stage = 0;
  }
  const seq = loadSeq;
  const stale = () => seq !== loadSeq;
  const at = engine.currentTime || 0;
  const playing = via ?? track;

  if (playing.provider === 'youtube' && recovery.stage < 2) {
    const firstTry = recovery.stage === 0;
    recovery.stage = firstTry ? 1 : 2;
    try {
      usePlayer.setState({ isLoading: true });
      await api.ensureYtdlp();
      if (!firstTry) {
        // Частая причина: YouTube поменял плеер, а yt-dlp устарел. Обновляем (раз за сеанс).
        await updateYtdlpIfNeeded('failure');
        await api.ensureDeno();
      }
      if (stale()) return true;
      const stream = await api.resolveStream('youtube', playing.id, { engine: 'ytdlp' });
      if (stale()) return true;
      ytSession.preferYtdlp = true;
      await engine.load(stream, true, at);
      if (stale()) return true;
      usePlayer.setState({ loaded: true, isPreview: stream.preview, isLoading: false });
      return true;
    } catch (e) {
      console.warn('YouTube: восстановление через yt-dlp не удалось', e);
      if (stale()) return true;
      if (firstTry) return recover();
    }
  }

  if (recovery.stage < 3 && useSettings.getState().smartFallback) {
    recovery.stage = 3;
    for (const provider of enabledSources()) {
      if (provider === playing.provider) continue;
      const alt = await api.findAlternative(track, provider);
      if (stale()) return true;
      if (!alt) continue;
      try {
        const stream = await api.resolveStream(alt.provider, alt.id);
        if (stale()) return true;
        if (stream.preview) continue;
        const sameLength = Math.abs(alt.duration - track.duration) <= 4;
        await engine.load(stream, true, sameLength ? at : 0);
        if (stale()) return true;
        usePlayer.setState({ via: alt, loaded: true, isPreview: false, isLoading: false });
        toast(`Поток оборвался: играем этот же трек из ${providerMeta(alt.provider).label}`);
        return true;
      } catch {
        /* пробуем следующий источник */
      }
    }
  }
  return false;
}

/** Следующий трек без побочных эффектов: для подготовки перехода. Радио сюда не входит. */
function peekNext(s: PlayerState): { track: Track; patch: Partial<PlayerState> } | null {
  if (s.repeat === 'one') return null;
  if (s.upNext.length) return { track: s.upNext[0], patch: { upNext: s.upNext.slice(1) } };
  const i = s.index + 1;
  if (i < s.queue.length) return { track: s.queue[i], patch: { index: i } };
  if (s.repeat === 'all' && s.queue.length && !s.shuffle) return { track: s.queue[0], patch: { index: 0 } };
  return null;
}

async function prepare(track: Track, seq: number) {
  const key = trackKey(track);
  prepareTried = { key, seq };
  try {
    const { stream, via } = await api.resolvePlayable(track, {
      smart: useSettings.getState().smartFallback,
      order: enabledSources(),
    });
    if (seq === loadSeq) prepared = { key, seq, at: Date.now(), stream, via };
  } catch {
    /* обычная загрузка попробует ещё раз, когда трек понадобится */
  }
}

/** Подготовленный поток, если он для этого трека и ещё свежий. */
function takePrepared(track: Track): Prepared | undefined {
  const p = prepared;
  prepared = null;
  if (p && p.key === trackKey(track) && p.seq === loadSeq && Date.now() - p.at < 90_000) return p;
  return undefined;
}

/** Секунд до конца, за которые начинаем искать поток следующего трека. */
const PREPARE_AHEAD = 15;
/** Для какого трека уже попросили ядро заранее скачать следующий трек YouTube. */
let prefetchedFor = -1;

function transitionTick() {
  const s = usePlayer.getState();
  if (!s.isPlaying || !s.loaded || s.isLoading || fadeStartedFor === loadSeq) return;
  const dur = engine.duration;
  const left = dur - engine.currentTime;
  if (!Number.isFinite(dur) || dur <= 0 || !Number.isFinite(left)) return;
  // Следующий трек YouTube качается целиком заранее: начнётся мгновенно и без сети.
  if (prefetchedFor !== loadSeq && engine.currentTime > 20) {
    prefetchedFor = loadSeq;
    const ahead = peekNext(s);
    if (ahead?.track.provider === 'youtube' && ahead.track.streamable) void api.ytPrefetch(ahead.track.id);
  }
  const fade = useSettings.getState().crossfade;
  if (left > fade + PREPARE_AHEAD) return;
  const pick = peekNext(s);
  if (!pick || !pick.track.streamable) return;
  const key = trackKey(pick.track);
  if (prepareTried.key !== key || prepareTried.seq !== loadSeq) void prepare(pick.track, loadSeq);
  // Плавный переход: не для коротких треков и не когда таймер сна ждёт конца трека
  if (fade <= 0 || dur < fade * 2 + 10 || useSleep.getState().mode?.kind === 'track') return;
  if (left > fade || !prepared || prepared.key !== key || prepared.seq !== loadSeq) return;
  fadeStartedFor = loadSeq;
  const pre = prepared;
  usePlayer.setState(pick.patch);
  void loadTrack(pick.track, true, { pre, fade: Math.max(1, Math.min(fade, left)) });
}

function handleError(message: string) {
  errorStreak += 1;
  toast(`Не удалось воспроизвести: ${message}`, 'error');
  if (errorStreak < 3) {
    window.setTimeout(() => void usePlayer.getState().next(false), 1200);
  } else {
    errorStreak = 0;
  }
}

/** Для трека с компьютера радио строится от того же трека в сети (YouTube Music или SoundCloud). */
async function radioSeed(seed: Track): Promise<Track | null> {
  if (seed.provider !== 'local') return seed;
  const config = useSettings.getState().config;
  const order: SourceProvider[] = config?.youtube === false ? ['soundcloud'] : ['youtube', 'soundcloud'];
  for (const provider of order) {
    const found = await api.findAlternative(seed, provider);
    if (found) return found;
  }
  // Не нашли сам трек: хотя бы похожее по артисту
  const page = await api.searchTracks(order[0], seed.artist).catch(() => null);
  return page?.items.find((t) => t.streamable) ?? null;
}

async function fetchRadio(seed: Track, exclude: Track[]): Promise<Track[]> {
  try {
    const base = await radioSeed(seed);
    if (!base) return [];
    const list = await api.related(base.provider, base.id, base);
    const seen = new Set(exclude.map(trackKey));
    seen.add(trackKey(seed));
    return shuffled(list.filter((t) => t.streamable && !seen.has(trackKey(t)))).slice(0, 25);
  } catch {
    return [];
  }
}

export const usePlayer = create<PlayerState>()(
  persist(
    (set, get) => ({
      current: null,
      queue: [],
      original: [],
      index: -1,
      upNext: [],
      source: null,
      isPlaying: false,
      isLoading: false,
      isPreview: false,
      via: null,
      loaded: false,
      duration: 0,
      shuffle: false,
      repeat: 'off',
      volume: 0.8,
      muted: false,
      playId: 0,

      playList: (tracks, startIndex = 0, source = null) => {
        const list = tracks.filter((t) => t.streamable);
        if (!list.length) {
          toast('В этом списке нет доступных треков', 'error');
          return;
        }
        const wanted = tracks[startIndex];
        const startKey = wanted && wanted.streamable ? trackKey(wanted) : trackKey(list[0]);
        const idx = Math.max(0, list.findIndex((t) => trackKey(t) === startKey));
        const { shuffle } = get();
        const queue = shuffle ? [list[idx], ...shuffled(list.filter((_, i) => i !== idx))] : list;
        const index = shuffle ? 0 : idx;
        errorStreak = 0;
        set({ original: list, queue, index, source });
        void loadTrack(queue[index], true);
      },

      playShuffled: (tracks, source = null) => {
        const list = tracks.filter((t) => t.streamable);
        if (!list.length) return;
        set({ shuffle: true });
        get().playList(list, Math.floor(Math.random() * list.length), source);
      },

      playTrack: (track, source = null) => get().playList([track], 0, source),

      play: () => {
        const s = get();
        if (!s.current || s.isLoading) return;
        if (!s.loaded) {
          void loadTrack(s.current, true);
          return;
        }
        void engine.play();
      },

      pause: () => engine.pause(),

      togglePlay: () => {
        if (engine.paused || !get().loaded) get().play();
        else engine.pause();
      },

      next: async (auto = false) => {
        const s = get();
        if (auto && s.repeat === 'one' && s.current) {
          engine.seek(0);
          void engine.play();
          set({ playId: s.playId + 1 });
          return;
        }
        if (s.upNext.length) {
          const [head, ...rest] = s.upNext;
          set({ upNext: rest });
          void loadTrack(head, true, { pre: takePrepared(head) });
          return;
        }
        const nextIndex = s.index + 1;
        if (nextIndex < s.queue.length) {
          set({ index: nextIndex });
          void loadTrack(s.queue[nextIndex], true, { pre: takePrepared(s.queue[nextIndex]) });
          return;
        }
        if (s.repeat === 'all' && s.queue.length) {
          const queue = s.shuffle ? shuffled(s.original) : s.queue;
          set({ queue, index: 0 });
          void loadTrack(queue[0], true);
          return;
        }
        if (useSettings.getState().autoplayRadio && s.current) {
          const added = await fetchRadio(s.current, s.queue);
          if (added.length) {
            const base = get();
            const start = base.queue.length;
            set({
              queue: [...base.queue, ...added],
              original: [...base.original, ...added],
              index: start,
              source: `Радио: ${s.current.title}`,
            });
            void loadTrack(added[0], true);
            return;
          }
        }
        if (auto) {
          set({ isPlaying: false });
          setPlaybackState(false);
        }
      },

      prev: () => {
        const s = get();
        if (engine.currentTime > 3) {
          engine.seek(0);
          return;
        }
        const ctxTrack = s.queue[s.index];
        const fromUpNext = !!s.current && !!ctxTrack && trackKey(ctxTrack) !== trackKey(s.current);
        const idx = fromUpNext ? s.index : s.index - 1;
        if (idx < 0 || !s.queue[idx]) {
          engine.seek(0);
          return;
        }
        set({ index: idx });
        void loadTrack(s.queue[idx], true);
      },

      seek: (time) => {
        engine.seek(time);
        setPositionState(time, engine.duration);
      },
      seekBy: (delta) => get().seek(engine.currentTime + delta),

      setVolume: (volume) => {
        const v = Math.min(1, Math.max(0, volume));
        const muted = v === 0 ? get().muted : false;
        set({ volume: v, muted });
        engine.setVolume(v, muted);
      },

      toggleMute: () => {
        const muted = !get().muted;
        set({ muted });
        engine.setVolume(get().volume, muted);
      },

      toggleShuffle: () => {
        const s = get();
        const shuffle = !s.shuffle;
        if (!s.original.length) {
          set({ shuffle });
          return;
        }
        const cur = s.queue[s.index];
        if (shuffle) {
          const rest = s.original.filter((t) => !cur || trackKey(t) !== trackKey(cur));
          set({ shuffle, queue: cur ? [cur, ...shuffled(rest)] : shuffled(rest), index: 0 });
        } else {
          const idx = cur ? s.original.findIndex((t) => trackKey(t) === trackKey(cur)) : 0;
          set({ shuffle, queue: s.original, index: Math.max(0, idx) });
        }
      },

      cycleRepeat: () => {
        const order: RepeatMode[] = ['off', 'all', 'one'];
        const repeat = order[(order.indexOf(get().repeat) + 1) % order.length];
        set({ repeat });
      },

      addToQueue: (track) => {
        if (!get().current) {
          get().playTrack(track);
          return;
        }
        set({ upNext: [...get().upNext, track] });
        toast('Добавлено в очередь');
      },

      playNext: (track) => {
        if (!get().current) {
          get().playTrack(track);
          return;
        }
        set({ upNext: [track, ...get().upNext] });
        toast('Сыграет следующим');
      },

      removeFromUpNext: (index) => set({ upNext: get().upNext.filter((_, i) => i !== index) }),
      moveUpNext: (from, to) => {
        const list = get().upNext.slice();
        if (from === to || from < 0 || from >= list.length) return;
        const [item] = list.splice(from, 1);
        list.splice(Math.max(0, Math.min(list.length, to)), 0, item);
        set({ upNext: list });
      },
      clearUpNext: () => set({ upNext: [] }),

      jumpToQueue: (index) => {
        const track = get().queue[index];
        if (!track) return;
        set({ index });
        void loadTrack(track, true);
      },

      jumpToUpNext: (index) => {
        const { upNext } = get();
        const track = upNext[index];
        if (!track) return;
        set({ upNext: upNext.filter((_, i) => i !== index) });
        void loadTrack(track, true);
      },

      startRadio: async (seed) => {
        toast(`Запускаем радио «${seed.title}»…`);
        const related = await fetchRadio(seed, []);
        get().playList([seed, ...related], 0, `Радио: ${seed.title}`);
      },
    }),
    {
      name: 'frost.player',
      version: 1,
      partialize: (s) => ({
        current: s.current,
        queue: s.queue.slice(0, 500),
        original: s.original.slice(0, 500),
        index: s.index,
        upNext: s.upNext.slice(0, 200),
        source: s.source,
        shuffle: s.shuffle,
        repeat: s.repeat,
        volume: s.volume,
        muted: s.muted,
      }),
    },
  ),
);

// ─── Связь движка со стором ───
engine.events = {
  onPlaying: () => {
    errorStreak = 0;
    usePlayer.setState({ isPlaying: true, isLoading: false });
    setPlaybackState(true);
  },
  onPause: () => {
    usePlayer.setState({ isPlaying: false });
    setPlaybackState(false);
  },
  onWaiting: () => usePlayer.setState({ isLoading: true }),
  onDuration: (duration) => {
    if (duration > 0) usePlayer.setState({ duration });
    setPositionState(engine.currentTime, duration);
  },
  onEnded: () => {
    // Таймер сна «до конца трека»: останавливаемся вместо перехода к следующему
    if (consumeStopAtTrackEnd()) {
      usePlayer.setState({ isPlaying: false });
      return;
    }
    void usePlayer.getState().next(true);
  },
  onError: (message) => {
    const seq = loadSeq;
    void recover().then((saved) => {
      if (saved || seq !== loadSeq) return;
      usePlayer.setState({ isPlaying: false, isLoading: false });
      handleError(message);
    });
  },
};

// Восстановленное состояние (localStorage гидратируется синхронно).
{
  const s = usePlayer.getState();
  engine.setVolume(s.volume, s.muted);
  usePlayer.setState({ isPlaying: false, isLoading: false, loaded: false, duration: s.current?.duration ?? 0 });
  updateMediaMetadata(s.current);
}

window.setInterval(transitionTick, 500);

bindMediaActions({
  play: () => usePlayer.getState().play(),
  pause: () => usePlayer.getState().pause(),
  next: () => void usePlayer.getState().next(),
  prev: () => usePlayer.getState().prev(),
  seekTo: (t) => usePlayer.getState().seek(t),
  seekBy: (d) => usePlayer.getState().seekBy(d),
});
