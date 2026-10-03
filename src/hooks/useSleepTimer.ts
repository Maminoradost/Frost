import { useEffect } from 'react';
import { engine } from '../audio/engine';
import { usePlayer } from '../store/player';
import { useSleep } from '../store/sleep';
import { toast } from '../store/ui';

const FADE_MS = 12_000;

/** Следит за таймером сна: за 12 секунд плавно убирает громкость и ставит паузу. */
export function useSleepTimer() {
  const mode = useSleep((s) => s.mode);
  useEffect(() => {
    if (mode?.kind !== 'time') return;
    let faded = false;
    const restore = () => {
      const { volume, muted } = usePlayer.getState();
      engine.setVolume(volume, muted);
    };
    const tick = () => {
      const left = mode.endsAt - Date.now();
      const { volume, muted, isPlaying } = usePlayer.getState();
      if (left <= 0) {
        window.clearInterval(timer);
        useSleep.getState().cancel();
        if (isPlaying) usePlayer.getState().pause();
        window.setTimeout(restore, 400);
        toast('Таймер сна: музыка остановлена. Спокойной ночи!');
        return;
      }
      if (left < FADE_MS && isPlaying) {
        faded = true;
        engine.setVolume(volume * (left / FADE_MS), muted);
      }
    };
    const timer = window.setInterval(tick, 250);
    return () => {
      window.clearInterval(timer);
      if (faded) restore();
    };
  }, [mode]);
}
