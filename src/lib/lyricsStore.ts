/** Настройки текста для конкретного трека: выбранный вариант, сдвиг, своя синхронизация. */
import type { LyricsQuery } from './lyricsMatch';

export interface LyricsOverride {
  /** Ключ выбранного варианта. */
  pick?: string;
  /** Сдвиг меток, секунды (+ позже, − раньше). */
  offset?: number;
  /** Своя синхронизация (LRC): автоматическая или ручная. */
  synced?: string;
  syncedBy?: 'auto' | 'manual';
  /** Ручной запрос поиска. */
  query?: LyricsQuery;
}

const PREFIX = 'frost.lyrics.v1.';

export function loadOverride(trackKey: string): LyricsOverride {
  try {
    const raw = localStorage.getItem(PREFIX + trackKey);
    return raw ? (JSON.parse(raw) as LyricsOverride) : {};
  } catch {
    return {};
  }
}

export function saveOverride(trackKey: string, patch: Partial<LyricsOverride> | null): LyricsOverride {
  const next: LyricsOverride = patch === null ? {} : { ...loadOverride(trackKey), ...patch };
  for (const k of Object.keys(next) as (keyof LyricsOverride)[]) if (next[k] === undefined) delete next[k];
  try {
    if (Object.keys(next).length) localStorage.setItem(PREFIX + trackKey, JSON.stringify(next));
    else localStorage.removeItem(PREFIX + trackKey);
  } catch {
    /* хранилище переполнено: настройка просто не запомнится */
  }
  return next;
}

/** Сколько треков с ручными настройками текста. */
export function countOverrides(): number {
  try {
    let n = 0;
    for (let i = 0; i < localStorage.length; i += 1) if (localStorage.key(i)?.startsWith(PREFIX)) n += 1;
    return n;
  } catch {
    return 0;
  }
}

/** Сбросить настройки текста для всех треков. */
export function clearAllOverrides(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    /* нет доступа к хранилищу */
  }
}
