/**
 * Журнал прослушиваний для «Итогов»: что, когда и сколько секунд реально звучало.
 * Лежит только на этом компьютере, в IndexedDB: записи помесячно (`journal:2026-10`),
 * карточки треков отдельно (`journal:tracks`), чтобы год прослушиваний занимал пару мегабайт.
 */
import { idbDel, idbGet, idbKeys, idbSet } from './idb';
import type { Track } from './types';
import { trackKey } from './types';

/** [ключ трека, начало прослушивания (мс Unix), сколько секунд прозвучало] */
export type JournalEntry = [key: string, at: number, seconds: number];

export interface JournalData {
  entries: JournalEntry[];
  tracks: Record<string, Track>;
}

const TRACKS = 'journal:tracks';
const MONTH_RE = /^journal:\d{4}-\d{2}$/;

export function monthKey(at: number): string {
  const d = new Date(at);
  return `journal:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Карточка трека без счётчиков, которые быстро устаревают. */
export function compactTrack(t: Track): Track {
  return { ...t, plays: null, likes: null };
}

let tracks: Record<string, Track> | null = null;
const months = new Map<string, JournalEntry[]>();
const dirty = new Set<string>();
let tracksDirty = false;
let timer = 0;

async function loadTracks(): Promise<Record<string, Track>> {
  if (!tracks) {
    const saved = await idbGet<Record<string, Track>>(TRACKS).catch(() => undefined);
    tracks ??= saved ?? {};
  }
  return tracks;
}

async function loadMonth(key: string): Promise<JournalEntry[]> {
  let list = months.get(key);
  if (!list) {
    const saved = await idbGet<JournalEntry[]>(key).catch(() => undefined);
    list = months.get(key) ?? (Array.isArray(saved) ? saved : []);
    months.set(key, list);
  }
  return list;
}

function scheduleSave() {
  if (timer) return;
  timer = window.setTimeout(() => void flushJournal(), 4000);
}

/** Сохраняет накопленное (зовём и при закрытии окна). */
export async function flushJournal(): Promise<void> {
  window.clearTimeout(timer);
  timer = 0;
  const keys = [...dirty];
  dirty.clear();
  try {
    for (const key of keys) await idbSet(key, months.get(key) ?? []);
    if (tracksDirty && tracks) {
      tracksDirty = false;
      await idbSet(TRACKS, tracks);
    }
  } catch (e) {
    console.warn('Журнал прослушиваний не сохранился', e);
  }
}

/**
 * Записывает прослушивание. Один запуск трека — одна запись: повторный вызов с тем же
 * временем начала только обновляет число секунд.
 */
export async function recordListen(track: Track, at: number, seconds: number): Promise<void> {
  const key = trackKey(track);
  const month = monthKey(at);
  const [known, list] = await Promise.all([loadTracks(), loadMonth(month)]);
  if (!known[key]) {
    known[key] = compactTrack(track);
    tracksDirty = true;
  }
  const secs = Math.round(seconds);
  let found = false;
  for (let i = list.length - 1; i >= Math.max(0, list.length - 8); i--) {
    if (list[i][1] === at && list[i][0] === key) {
      list[i][2] = secs;
      found = true;
      break;
    }
  }
  if (!found) list.push([key, at, secs]);
  dirty.add(month);
  scheduleSave();
}

/** Записи начиная с `from` (мс Unix) и карточки треков. */
export async function loadJournal(from = 0): Promise<JournalData> {
  const keys = new Set((await idbKeys().catch(() => [] as string[])).filter((k) => MONTH_RE.test(k)));
  for (const k of months.keys()) keys.add(k);
  const fromKey = from > 0 ? monthKey(from) : '';
  const wanted = [...keys].filter((k) => k >= fromKey).sort();
  const lists = await Promise.all(wanted.map(loadMonth));
  const entries = lists.flat().filter((e) => e[1] >= from);
  return { entries, tracks: await loadTracks() };
}

export async function journalSize(): Promise<number> {
  const { entries } = await loadJournal();
  return entries.length;
}

export async function clearJournal(): Promise<void> {
  window.clearTimeout(timer);
  timer = 0;
  const keys = (await idbKeys().catch(() => [] as string[])).filter((k) => k.startsWith('journal:'));
  await Promise.all(keys.map((k) => idbDel(k).catch(() => undefined)));
  months.clear();
  dirty.clear();
  tracks = {};
  tracksDirty = false;
}

/** Для резервной копии. */
export async function exportJournal(): Promise<JournalData> {
  await flushJournal();
  return loadJournal();
}

/** Восстановление из резервной копии: записи объединяются с уже имеющимися. */
export async function importJournal(data: Partial<JournalData> | null | undefined): Promise<number> {
  if (!data || !Array.isArray(data.entries)) return 0;
  const known = await loadTracks();
  for (const [key, track] of Object.entries(data.tracks ?? {})) {
    if (!known[key] && track && typeof track.title === 'string') known[key] = track;
  }
  tracksDirty = true;
  let added = 0;
  for (const e of data.entries) {
    if (!Array.isArray(e) || typeof e[0] !== 'string' || typeof e[1] !== 'number' || typeof e[2] !== 'number') continue;
    const month = monthKey(e[1]);
    const list = await loadMonth(month);
    if (list.some((x) => x[1] === e[1] && x[0] === e[0])) continue;
    list.push([e[0], e[1], e[2]]);
    dirty.add(month);
    added++;
  }
  for (const key of dirty) months.get(key)?.sort((a, b) => a[1] - b[1]);
  await flushJournal();
  return added;
}
