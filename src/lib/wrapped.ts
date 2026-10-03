/**
 * «Итоги»: статистика по журналу прослушиваний. Чистые функции без хранилищ,
 * поэтому всё проверяется тестами.
 */
import type { JournalEntry } from './journal';
import type { Track } from './types';

export type WrappedPeriod = 'month' | 'year' | 'last-year' | 'all';

export interface TopTrack {
  track: Track;
  plays: number;
  seconds: number;
}

export interface TopArtist {
  name: string;
  plays: number;
  seconds: number;
  /** Самый слушаемый трек артиста: для обложки и запуска. */
  track: Track;
}

export interface WrappedStats {
  seconds: number;
  plays: number;
  tracks: number;
  artists: number;
  /** Дней, когда что-то звучало. */
  days: number;
  /** Самая длинная серия дней подряд. */
  streak: number;
  topTracks: TopTrack[];
  topArtists: TopArtist[];
  /** Секунды по часам суток (0…23). */
  byHour: number[];
  /** Секунды по дням недели, с понедельника. */
  byWeekday: number[];
  /** Самый «музыкальный» день: дата (мс) и секунды. */
  bestDay: { at: number; seconds: number } | null;
  firstAt: number | null;
  /** Треки, впервые услышанные в этом периоде (если известно, что было до него). */
  discovered: number;
}

/** Начало и конец периода (мс Unix). */
export function periodRange(period: WrappedPeriod, now = new Date()): { from: number; to: number } {
  const y = now.getFullYear();
  switch (period) {
    case 'month':
      return { from: now.getTime() - 30 * 86400_000, to: now.getTime() };
    case 'year':
      return { from: new Date(y, 0, 1).getTime(), to: now.getTime() };
    case 'last-year':
      return { from: new Date(y - 1, 0, 1).getTime(), to: new Date(y, 0, 1).getTime() };
    default:
      return { from: 0, to: now.getTime() };
  }
}

/** Основной артист: без «feat.», соавторов и приписки « - Topic» от YouTube. */
export function primaryArtist(artist: string): string {
  const clean = artist.replace(/\s+-\s+Topic$/i, '').trim();
  const first = clean.split(/\s*(?:,|;|&|\/|\bfeat\.?\s|\bft\.?\s|\bfeaturing\s|\bx\s(?=[A-ZА-ЯЁ]))\s*/i)[0]?.trim();
  return first || clean || 'Неизвестный артист';
}

/** Засчитывается ли запуск как прослушивание. */
export function countsAsPlay(seconds: number, duration: number): boolean {
  const need = duration > 0 ? Math.min(30, duration * 0.5) : 30;
  return seconds >= need;
}

const dayKey = (at: number) => {
  const d = new Date(at);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

function longestStreak(days: number[]): number {
  if (!days.length) return 0;
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    run = sorted[i] - sorted[i - 1] === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

/** Порядковый номер дня по местному времени (для серий). */
const dayNumber = (at: number) => {
  const d = new Date(at);
  return Math.round(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86400_000);
};

export function computeWrapped(
  entries: JournalEntry[],
  tracks: Record<string, Track>,
  range: { from: number; to: number } = { from: 0, to: Infinity },
  top = 10,
): WrappedStats {
  const byHour = new Array<number>(24).fill(0);
  const byWeekday = new Array<number>(7).fill(0);
  const perTrack = new Map<string, { plays: number; seconds: number }>();
  const perArtist = new Map<string, { name: string; plays: number; seconds: number; best: Map<string, number> }>();
  const perDay = new Map<string, { at: number; seconds: number }>();
  const dayNums: number[] = [];
  const before = new Set<string>();
  let seconds = 0;
  let plays = 0;
  let firstAt: number | null = null;

  for (const [key, at, secs] of entries) {
    if (at < range.from) {
      before.add(key);
      continue;
    }
    if (at >= range.to || secs <= 0) continue;
    const track = tracks[key];
    if (!track) continue;
    seconds += secs;
    firstAt = firstAt === null ? at : Math.min(firstAt, at);
    const d = new Date(at);
    byHour[d.getHours()] += secs;
    byWeekday[(d.getDay() + 6) % 7] += secs;
    const dk = dayKey(at);
    const day = perDay.get(dk) ?? { at: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), seconds: 0 };
    day.seconds += secs;
    perDay.set(dk, day);
    dayNums.push(dayNumber(at));

    const played = countsAsPlay(secs, track.duration);
    if (played) plays++;
    const t = perTrack.get(key) ?? { plays: 0, seconds: 0 };
    t.seconds += secs;
    if (played) t.plays++;
    perTrack.set(key, t);

    const name = primaryArtist(track.artist);
    const ak = name.toLowerCase();
    const a = perArtist.get(ak) ?? { name, plays: 0, seconds: 0, best: new Map<string, number>() };
    a.seconds += secs;
    if (played) a.plays++;
    a.best.set(key, (a.best.get(key) ?? 0) + secs);
    perArtist.set(ak, a);
  }

  const topTracks = [...perTrack.entries()]
    .filter(([, v]) => v.plays > 0)
    .sort((x, y) => y[1].plays - x[1].plays || y[1].seconds - x[1].seconds)
    .slice(0, top)
    .map(([key, v]) => ({ track: tracks[key], plays: v.plays, seconds: v.seconds }));

  const topArtists = [...perArtist.values()]
    .filter((a) => a.seconds > 0)
    .sort((x, y) => y.seconds - x.seconds || y.plays - x.plays)
    .slice(0, top)
    .map((a) => {
      const bestKey = [...a.best.entries()].sort((x, y) => y[1] - x[1])[0][0];
      return { name: a.name, plays: a.plays, seconds: a.seconds, track: tracks[bestKey] };
    });

  let bestDay: WrappedStats['bestDay'] = null;
  for (const day of perDay.values()) if (!bestDay || day.seconds > bestDay.seconds) bestDay = day;

  const discovered = before.size ? [...perTrack.keys()].filter((k) => !before.has(k)).length : 0;

  return {
    seconds,
    plays,
    tracks: perTrack.size,
    artists: perArtist.size,
    days: perDay.size,
    streak: longestStreak(dayNums),
    topTracks,
    topArtists,
    byHour,
    byWeekday,
    bestDay,
    firstAt,
    discovered,
  };
}

/** «Слушатель-сова» и прочие подписи по часам. */
export function listenerType(byHour: number[]): { title: string; text: string } | null {
  const total = byHour.reduce((s, v) => s + v, 0);
  if (total < 600) return null;
  const sum = (from: number, to: number) => byHour.slice(from, to).reduce((s, v) => s + v, 0);
  const night = sum(0, 5) + byHour[23];
  const morning = sum(5, 12);
  const day = sum(12, 18);
  const evening = sum(18, 23);
  const max = Math.max(night, morning, day, evening);
  if (max === night) return { title: 'Ночная сова', text: 'Больше всего музыки звучит после полуночи' };
  if (max === morning) return { title: 'Жаворонок', text: 'Вы чаще слушаете музыку по утрам' };
  if (max === day) return { title: 'Дневной слушатель', text: 'Музыка сопровождает вас днём' };
  return { title: 'Вечерний слушатель', text: 'Главное время для музыки у вас вечер' };
}
