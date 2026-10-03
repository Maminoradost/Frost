import { useEffect, useState } from 'react';
import { engine } from '../audio/engine';

/**
 * Текущая позиция воспроизведения через requestAnimationFrame.
 * Не храним позицию в сторе, чтобы не перерисовывать всё приложение 30 раз в секунду.
 */
export function usePlaybackTime(active = true, fps = 30): number {
  const [time, setTime] = useState(() => engine.currentTime);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = 0;
    const frame = 1000 / fps;
    const loop = (now: number) => {
      if (now - last >= frame) {
        last = now;
        setTime(engine.currentTime);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active, fps]);
  return time;
}
