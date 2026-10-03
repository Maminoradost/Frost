export interface LrcWord {
  /** Начало слова, с. */
  time: number;
  /** Конец слова, с. */
  end: number;
  /** Текст слова вместе с пробелом после него. */
  text: string;
}

export interface LrcLine {
  time: number;
  text: string;
  /** Пословная разметка (Enhanced LRC `<mm:ss.xx>слово` или NetEase YRC). */
  words?: LrcWord[];
}

const STAMP = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
const WORD = /<(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)>/g;
const secs = (m: string, s: string) => parseInt(m, 10) * 60 + parseFloat(s.replace(':', '.'));

/** Текст строки с пословными метками → чистый текст и слова со временем. */
function parseWords(content: string): { text: string; words?: LrcWord[] } {
  const marks: { time: number; from: number; to: number }[] = [];
  WORD.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WORD.exec(content)) !== null) marks.push({ time: secs(m[1], m[2]), from: m.index, to: WORD.lastIndex });
  if (!marks.length) return { text: content.trim() };
  const lead = content.slice(0, marks[0].from);
  const words: LrcWord[] = [];
  for (let i = 0; i < marks.length; i += 1) {
    const text = content.slice(marks[i].to, i + 1 < marks.length ? marks[i + 1].from : content.length);
    const end = i + 1 < marks.length ? marks[i + 1].time : NaN;
    if (text.trim()) words.push({ time: marks[i].time, end, text: (i === 0 ? lead : '') + text });
    else if (words.length && Number.isNaN(words[words.length - 1].end)) words[words.length - 1].end = marks[i].time;
  }
  const text = (words.length ? words.map((w) => w.text).join('') : lead + content.replace(WORD, '')).replace(/\s+/g, ' ').trim();
  return words.length ? { text, words } : { text };
}

/** Разбор LRC: несколько меток на строку `[00:12.00][01:30.00]текст`, пословные метки `<00:12.40>`. */
export function parseLrc(text: string): LrcLine[] {
  const lines: LrcLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const stamps: number[] = [];
    let end = 0;
    STAMP.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = STAMP.exec(raw)) !== null) {
      if (m.index !== end) break;
      stamps.push(secs(m[1], m[2]));
      end = STAMP.lastIndex;
    }
    if (!stamps.length) continue;
    const parsed = parseWords(raw.slice(end));
    for (const time of stamps) {
      // Пословные метки относятся к первой метке строки; для повторов (припев) сдвигаем их.
      const shift = time - stamps[0];
      const words = parsed.words?.map((w) => ({ time: w.time + shift, end: w.end + shift, text: w.text }));
      lines.push(words ? { time, text: parsed.text, words } : { time, text: parsed.text });
    }
  }
  lines.sort((a, b) => a.time - b.time);
  // Последнее слово без конечной метки длится до следующей строки (но не дольше 1.2 с).
  for (let i = 0; i < lines.length; i += 1) {
    const words = lines[i].words;
    if (!words) continue;
    const next = lines[i + 1]?.time ?? Infinity;
    for (const w of words) if (Number.isNaN(w.end)) w.end = Math.min(next, w.time + 1.2);
  }
  return lines;
}

/** Индекс активной строки (двоичный поиск). */
export function activeLineIndex(lines: LrcLine[], time: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  const t = time + 0.25;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/** Грубое число слогов: группы гласных (латиница, кириллица) и иероглифы/слоги каны и хангыля. */
export function syllables(text: string): number {
  const cjk = text.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/gu)?.length ?? 0;
  const vowels = text.toLowerCase().match(/[aeiouyàáâäæèéêëìíîïòóôöœùúûüяёеуыаоэиюіїє]+/gu)?.length ?? 0;
  return Math.max(1, cjk + vowels);
}

/**
 * Сколько строки уже спето (0…1) для караоке-заливки.
 * С пословной разметкой — по словам, иначе по оценке длительности пения (≈0.26 с на слог).
 */
export function lineProgress(line: LrcLine, next: LrcLine | undefined, time: number): number {
  if (time <= line.time) return 0;
  if (line.words?.length) {
    const total = line.words.reduce((n, w) => n + w.text.length, 0) || 1;
    let done = 0;
    for (const w of line.words) {
      if (time >= w.end) done += w.text.length;
      else if (time > w.time) done += w.text.length * ((time - w.time) / Math.max(0.05, w.end - w.time));
      else break;
    }
    return Math.min(1, done / total);
  }
  const gap = next ? next.time - line.time : 6;
  const sung = Math.min(Math.max(0.8, syllables(line.text) * 0.26), Math.max(0.4, gap - 0.15));
  return Math.min(1, (time - line.time) / sung);
}

/** Доля пропетого внутри слова (0…1). */
export function wordProgress(word: LrcWord, time: number): number {
  if (time <= word.time) return 0;
  if (time >= word.end) return 1;
  return (time - word.time) / Math.max(0.05, word.end - word.time);
}

/** Слова строки с оценочным временем (для караоке без пословной разметки). */
export function estimateWords(line: LrcLine, next: LrcLine | undefined): LrcWord[] {
  const tokens = line.text.match(/\S+\s*/g) ?? [];
  if (!tokens.length) return [];
  const gap = next ? next.time - line.time : 6;
  const sung = Math.min(Math.max(0.8, syllables(line.text) * 0.26), Math.max(0.4, gap - 0.15));
  const weights = tokens.map((t) => syllables(t));
  const total = weights.reduce((a, b) => a + b, 0);
  let t = line.time;
  return tokens.map((text, i) => {
    const d = (sung * weights[i]) / total;
    const word = { time: t, end: t + d, text };
    t += d;
    return word;
  });
}

const SECTION = /^(\[[^\]]*\]|\(?(припев|куплет|бридж|вступление|концовка|chorus|verse|bridge|intro|outro|hook|pre-chorus)\b[^)]*\)?:?)$/i;

/** Строки для синхронизации: без пустых и без пометок разделов вида «[Припев]». */
export function syncableLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !SECTION.test(l));
}

/** LRC из строк и моментов их начала (ручная синхронизация). */
export function timedLrc(lines: string[], times: number[]): string {
  const stamp = (t: number) => {
    const cs = Math.max(0, Math.round(t * 100));
    const m = Math.floor(cs / 6000);
    const s = Math.floor((cs % 6000) / 100);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
  };
  return lines
    .slice(0, times.length)
    .map((l, i) => `[${stamp(times[i])}]${l}`)
    .join('\n');
}
