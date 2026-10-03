import { create } from 'zustand';

/** Таймер сна: остановить музыку через N минут или в конце текущего трека. */
export type SleepMode = { kind: 'time'; endsAt: number; minutes: number } | { kind: 'track' } | null;

interface SleepState {
  mode: SleepMode;
  setMinutes: (minutes: number) => void;
  setEndOfTrack: () => void;
  cancel: () => void;
}

export const useSleep = create<SleepState>()((set) => ({
  mode: null,
  setMinutes: (minutes) => set({ mode: { kind: 'time', endsAt: Date.now() + minutes * 60_000, minutes } }),
  setEndOfTrack: () => set({ mode: { kind: 'track' } }),
  cancel: () => set({ mode: null }),
}));

/** Вызывается плеером в конце трека: true, если нужно остановиться (и сбрасывает таймер). */
export function consumeStopAtTrackEnd(): boolean {
  if (useSleep.getState().mode?.kind !== 'track') return false;
  useSleep.setState({ mode: null });
  return true;
}

/** Сколько осталось, по-человечески: «23 мин», «45 с». */
export function sleepLeft(mode: SleepMode, now = Date.now()): string {
  if (!mode) return '';
  if (mode.kind === 'track') return 'до конца трека';
  const sec = Math.max(0, Math.round((mode.endsAt - now) / 1000));
  return sec >= 60 ? `${Math.ceil(sec / 60)} мин` : `${sec} с`;
}
