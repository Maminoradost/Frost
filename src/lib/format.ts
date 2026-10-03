import { lang, plural as pluralForm, tr } from './i18n';
import type { Track } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatCount(n: number | null | undefined): string {
  if (n == null) return '';
  const short = (v: number, big: boolean) => v.toFixed(big ? 0 : 1).replace('.0', '');
  if (lang === 'en') {
    if (n >= 1_000_000) return `${short(n / 1_000_000, n >= 10_000_000)}M`;
    if (n >= 1_000) return `${short(n / 1_000, n >= 10_000)}K`;
    return String(n);
  }
  if (n >= 1_000_000) return `${short(n / 1_000_000, n >= 10_000_000)} млн`;
  if (n >= 1_000) return `${short(n / 1_000, n >= 10_000)} тыс.`;
  return String(n);
}

/** Склонение по числу (с английским переводом, если он есть в словаре). */
export const plural = pluralForm;

export const tracksLabel = (n: number) => `${n} ${plural(n, 'трек', 'трека', 'треков')}`;

/** «1 ч 5 мин» / «1 h 5 min». */
export function durationLabel(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? tr('{0} ч {1} мин', h, m) : tr('{0} мин', m);
}

export function totalDuration(tracks: Track[]): string {
  return durationLabel(tracks.reduce((acc, t) => acc + (t.duration || 0), 0));
}

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return tr('Доброй ночи');
  if (h < 12) return tr('Доброе утро');
  if (h < 18) return tr('Добрый день');
  return tr('Добрый вечер');
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function shuffled<T>(list: T[]): T[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function timeAgo(ts: number): string {
  const diff = Math.max(0, Date.now() - ts) / 1000;
  if (diff < 60) return tr('только что');
  if (diff < 3600) return tr('{0} мин назад', Math.floor(diff / 60));
  if (diff < 86400) return tr('{0} ч назад', Math.floor(diff / 3600));
  const d = Math.floor(diff / 86400);
  return tr('{0} {1} назад', d, plural(d, 'день', 'дня', 'дней'));
}
