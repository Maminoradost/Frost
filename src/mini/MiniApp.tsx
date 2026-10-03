/**
 * Мини-плеер: отдельное маленькое окно поверх остальных. Звук остаётся в главном окне,
 * сюда приходит только состояние (событие frost://mini-state), отсюда уходят команды.
 */
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Heart, Maximize2, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { extractAccent } from '../lib/color';
import { onMiniState, sendMiniCommand, type MiniState } from '../lib/desktop';
import { applyLookAttributes } from '../lib/look';
import { systemTheme } from '../hooks/useSystemTheme';
import { applyScheme, schemeFromSeed, type ContrastLevel, type SchemeStyle } from '../lib/material';

interface Look {
  theme: 'dark' | 'light';
  seed: string;
  dynamic: boolean;
  style: SchemeStyle;
  contrast: ContrastLevel;
  corner: string;
  textScale: string;
  motion: string;
  compact: boolean;
}

const STYLES: SchemeStyle[] = ['tonalSpot', 'vibrant', 'expressive', 'fidelity', 'content', 'rainbow', 'fruitSalad', 'neutral', 'monochrome'];
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);

/** Настройки читаем напрямую: хранилище настроек в этом окне не создаём, чтобы ничего не перезаписать. */
function readLook(): Look {
  let s: Partial<Record<string, unknown>> = {};
  try {
    const raw = JSON.parse(localStorage.getItem('frost.settings') ?? '{}') as { state?: Partial<Record<string, unknown>> };
    s = raw.state ?? {};
  } catch {
    /* повреждённые настройки: берём значения по умолчанию */
  }
  const theme = s.theme === 'light' ? 'light' : s.theme === 'system' ? systemTheme() : 'dark';
  return {
    theme,
    seed: typeof s.seedColor === 'string' ? s.seedColor : '#6750a4',
    dynamic: s.dynamicAccent !== false,
    style: pick(s.materialStyle, STYLES, 'tonalSpot'),
    contrast: pick(s.contrastLevel, ['standard', 'medium', 'high'] as const, 'standard'),
    corner: pick(s.cornerRadius, ['small', 'medium', 'large'] as const, 'medium'),
    textScale: pick(s.textScale, ['small', 'default', 'large', 'xlarge'] as const, 'default'),
    motion: pick(s.motionStyle, ['standard', 'spring', 'minimal'] as const, 'standard'),
    compact: s.compactMode === true,
  };
}

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const EMPTY: MiniState = {
  title: null,
  artist: null,
  artwork: null,
  isPlaying: false,
  position: 0,
  duration: 0,
  liked: false,
  loading: false,
};

export function MiniApp() {
  const [state, setState] = useState<MiniState>(EMPTY);
  const [now, setNow] = useState(() => performance.now());
  const receivedAt = useRef(performance.now());

  useEffect(() => {
    const unlisten = onMiniState((s) => {
      receivedAt.current = performance.now();
      setState(s);
    });
    sendMiniCommand('hello');
    const timer = window.setInterval(() => setNow(performance.now()), 250);
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        sendMiniCommand('toggle');
      } else if (e.key === 'Escape') void getCurrentWindow().close();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      void unlisten.then((off) => off());
      window.clearInterval(timer);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Настройки оформления меняются в главном окне: подхватываем сразу (событие storage) и следим за темой Windows.
  const [lookTick, setLookTick] = useState(0);
  useEffect(() => {
    const bump = () => setLookTick((n) => n + 1);
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'frost.settings') bump();
    };
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    window.addEventListener('storage', onStorage);
    media.addEventListener('change', bump);
    return () => {
      window.removeEventListener('storage', onStorage);
      media.removeEventListener('change', bump);
    };
  }, []);

  // Цвета Material You: из обложки или выбранного оттенка, как в главном окне
  useEffect(() => {
    const look = readLook();
    applyLookAttributes(document.documentElement, look);
    const apply = (seed: string) => applyScheme(schemeFromSeed(seed, look.theme === 'dark', look.style, look.contrast));
    if (!look.dynamic || !state.artwork) apply(look.seed);
    else void extractAccent(state.artwork, look.theme).then(apply, () => apply(look.seed));
  }, [state.artwork, lookTick]);

  const elapsed = state.isPlaying ? (now - receivedAt.current) / 1000 : 0;
  const position = Math.min(state.duration || Infinity, state.position + elapsed);
  const ratio = state.duration > 0 ? Math.min(1, position / state.duration) : 0;

  const seek = (e: MouseEvent<HTMLDivElement>) => {
    if (!state.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const at = ((e.clientX - rect.left) / rect.width) * state.duration;
    sendMiniCommand({ seek: Math.max(0, Math.min(state.duration, at)) });
  };

  return (
    <div className="mini" data-tauri-drag-region>
      <div className="mini__art" data-tauri-drag-region>
        {state.artwork ? <img src={state.artwork} alt="" draggable={false} /> : <span className="mini__art-empty" />}
      </div>
      <div className="mini__body" data-tauri-drag-region>
        <div className="mini__top" data-tauri-drag-region>
          <div className="mini__meta" data-tauri-drag-region>
            <div className="mini__title" data-tauri-drag-region title={state.title ?? ''}>
              {state.title ?? 'Ничего не играет'}
            </div>
            <div className="mini__artist" data-tauri-drag-region>
              {state.artist ?? 'Запустите трек в Frost'}
            </div>
          </div>
          <div className="mini__win">
            <button className="icon-btn icon-btn--xs" title="Открыть Frost" aria-label="Открыть Frost" onClick={() => sendMiniCommand('expand')}>
              <Maximize2 size={14} />
            </button>
            <button className="icon-btn icon-btn--xs" title="Закрыть мини-плеер" aria-label="Закрыть мини-плеер" onClick={() => void getCurrentWindow().close()}>
              <X size={15} />
            </button>
          </div>
        </div>
        <div className="mini__controls">
          <button
            className={`icon-btn icon-btn--xs${state.liked ? ' is-on' : ''}`}
            title={state.liked ? 'Убрать из избранного' : 'В избранное'}
            aria-label={state.liked ? 'Убрать из избранного' : 'В избранное'}
            aria-pressed={state.liked}
            onClick={() => sendMiniCommand('like')}
            disabled={!state.title}
          >
            <Heart size={16} fill={state.liked ? 'currentColor' : 'none'} />
          </button>
          <button className="icon-btn" title="Предыдущий" aria-label="Предыдущий трек" onClick={() => sendMiniCommand('prev')}>
            <SkipBack size={18} fill="currentColor" />
          </button>
          <button
            className="mini__play"
            title={state.isPlaying ? 'Пауза' : 'Играть'}
            aria-label={state.isPlaying ? 'Пауза' : 'Играть'}
            onClick={() => sendMiniCommand('toggle')}
          >
            {state.isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
          </button>
          <button className="icon-btn" title="Следующий" aria-label="Следующий трек" onClick={() => sendMiniCommand('next')}>
            <SkipForward size={18} fill="currentColor" />
          </button>
          <span className="mini__time">
            {fmt(position)} / {fmt(state.duration)}
          </span>
        </div>
        <div
          className={`mini__bar${state.loading ? ' is-loading' : ''}`}
          onClick={seek}
          role="slider"
          aria-label="Позиция трека"
          aria-valuemin={0}
          aria-valuemax={Math.round(state.duration)}
          aria-valuenow={Math.round(position)}
        >
          <span style={{ width: `${ratio * 100}%` }} />
        </div>
      </div>
    </div>
  );
}
