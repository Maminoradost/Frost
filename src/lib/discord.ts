/**
 * Статус «Слушает» в Discord через локальный IPC (Rust-команды `discord_set`/`discord_clear`).
 * Здесь только сборка активности: чистая функция, проверяется тестами.
 */
import type { Track } from './types';

/** Discord требует от 2 до 128 символов в строках активности. */
export function clip(text: string, max = 128): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length > max) return `${t.slice(0, max - 1)}…`;
  return t.length < 2 ? `${t}  `.slice(0, 2) : t;
}

const isHttps = (url: string | null | undefined): url is string => !!url && /^https:\/\//i.test(url) && url.length <= 256;

export function discordActivity(track: Track, startedAt: number, duration: number): Record<string, unknown> {
  const art = [track.artwork, track.artworkSmall].find(isHttps) ?? null;
  const artist = track.artist.replace(/\s+-\s+Topic$/i, '');
  const activity: Record<string, unknown> = {
    type: 2,
    details: clip(track.title || 'Без названия'),
    state: clip(artist || 'Неизвестный артист'),
    timestamps:
      duration > 0
        ? { start: Math.round(startedAt), end: Math.round(startedAt + duration * 1000) }
        : { start: Math.round(startedAt) },
    instance: false,
  };
  if (art) activity.assets = { large_image: art, large_text: clip(track.album || 'Frost') };
  if (isHttps(track.permalink)) activity.buttons = [{ label: 'Слушать', url: track.permalink }];
  return activity;
}
