import { useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import { clamp } from '../lib/format';

interface SliderProps {
  value: number;
  max: number;
  label: string;
  onCommit: (value: number) => void;
  /** Значение во время перетаскивания (null, когда перетаскивание закончилось). */
  onPreview?: (value: number | null) => void;
  buffered?: number;
  step?: number;
  wheelStep?: number;
  className?: string;
}

/** Минималистичный слайдер в стиле Fluent: тонкая дорожка, ползунок растёт при наведении. */
export function Slider({ value, max, label, onCommit, onPreview, buffered, step, wheelStep, className = '' }: SliderProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const safeMax = max > 0 ? max : 1;

  const fromX = (clientX: number) => {
    const el = ref.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1) * safeMax;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const v = fromX(e.clientX);
    setDrag(v);
    onPreview?.(v);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag === null) return;
    const v = fromX(e.clientX);
    setDrag(v);
    onPreview?.(v);
  };
  const finish = (e: PointerEvent<HTMLDivElement>) => {
    if (drag === null) return;
    const v = fromX(e.clientX);
    setDrag(null);
    onPreview?.(null);
    onCommit(v);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const s = step ?? safeMax / 20;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = value + s;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = value - s;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = safeMax;
    if (next !== null) {
      e.preventDefault();
      e.stopPropagation();
      onCommit(clamp(next, 0, safeMax));
    }
  };
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (!wheelStep) return;
    onCommit(clamp(value + (e.deltaY < 0 ? wheelStep : -wheelStep), 0, safeMax));
  };

  const shown = drag ?? value;
  const pct = clamp(shown / safeMax, 0, 1) * 100;
  const bufferedPct = buffered != null ? clamp(buffered / safeMax, 0, 1) * 100 : 0;

  return (
    <div
      ref={ref}
      className={`slider ${drag !== null ? 'is-dragging' : ''} ${className}`}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={shown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onKeyDown={onKeyDown}
      onWheel={onWheel}
    >
      <div className="slider__rail">
        {buffered != null && <div className="slider__buffered" style={{ width: `${bufferedPct}%` }} />}
        <div className="slider__fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="slider__thumb" style={{ left: `${pct}%` }} />
    </div>
  );
}
