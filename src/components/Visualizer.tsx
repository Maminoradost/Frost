import { useEffect, useRef } from 'react';
import { engine } from '../audio/engine';
import { withAlpha } from '../lib/color';
import { useUi } from '../store/ui';

/** Спектр на canvas: логарифмические полосы 40 Гц – 16 кГц, плавное затухание. */
export function Visualizer({ bars = 72, className = '' }: { bars?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const accent = useUi((s) => s.accent);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let data = new Uint8Array(new ArrayBuffer(engine.binCount));
    const levels = new Float32Array(bars);
    let raf = 0;
    let dpr = window.devicePixelRatio || 1;

    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (data.length !== engine.binCount) data = new Uint8Array(new ArrayBuffer(engine.binCount));
      const has = engine.getFrequencyData(data);
      const w = canvas.width;
      const h = canvas.height;
      const nyquist = engine.sampleRate / 2;
      const bins = data.length;

      for (let i = 0; i < bars; i++) {
        const f0 = 40 * Math.pow(16000 / 40, i / bars);
        const f1 = 40 * Math.pow(16000 / 40, (i + 1) / bars);
        const b0 = Math.min(bins - 1, Math.floor((f0 / nyquist) * bins));
        const b1 = Math.min(bins, Math.max(b0 + 1, Math.ceil((f1 / nyquist) * bins)));
        let peak = 0;
        for (let b = b0; b < b1; b++) peak = Math.max(peak, data[b]);
        const target = has && !engine.paused ? peak / 255 : 0;
        levels[i] += (target - levels[i]) * (target > levels[i] ? 0.45 : 0.08);
      }

      ctx.clearRect(0, 0, w, h);
      const gap = 3 * dpr;
      const bw = Math.max(1, (w - gap * (bars - 1)) / bars);
      const gradient = ctx.createLinearGradient(0, h, 0, 0);
      gradient.addColorStop(0, withAlpha(accent, 0.08));
      gradient.addColorStop(1, withAlpha(accent, 0.75));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      for (let i = 0; i < bars; i++) {
        const bh = Math.max(2 * dpr, Math.pow(levels[i], 1.6) * h);
        ctx.roundRect(i * (bw + gap), h - bh, bw, bh, Math.min(bw / 2, 4 * dpr));
      }
      ctx.fill();
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [bars, accent]);

  return <canvas ref={ref} className={`visualizer ${className}`} aria-hidden />;
}
