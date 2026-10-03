import { useSyncExternalStore } from 'react';
import type { ThemeMode } from '../lib/types';

const QUERY = '(prefers-color-scheme: dark)';

function subscribe(onChange: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const media = window.matchMedia(QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

const snapshot = () => (typeof window !== 'undefined' && window.matchMedia?.(QUERY).matches ? 'dark' : 'light');

/** Тема Windows прямо сейчас (обновляется, когда пользователь переключает её в системе). */
export function systemTheme(): 'dark' | 'light' {
  return snapshot();
}

/** Фактическая тема: для «Как в Windows» следит за системной. */
export function useEffectiveTheme(theme: ThemeMode): 'dark' | 'light' {
  const system = useSyncExternalStore(subscribe, snapshot, () => 'dark' as const);
  return theme === 'system' ? system : theme;
}
