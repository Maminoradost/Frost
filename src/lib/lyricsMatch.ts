/**
 * Сопоставление треков для поиска текста. Чистые функции (покрыты тестами).
 *
 * На SoundCloud трек часто залит лейблом или фан-каналом, исполнитель спрятан в названии
 * («Автор - Трек»), а к названию прилеплены пометки: (prod. X), [Free DL], slowed + reverb,
 * sped up, nightcore, эмодзи и хэштеги. Здесь из этого собираются варианты запроса и
 * оценивается похожесть найденного: по названию, исполнителю и длительности (с учётом
 * замедленных и ускоренных версий, у которых длительность честно другая).
 */

export interface LyricsQuery {
  artist: string;
  title: string;
}

export type VersionKind = 'slowed' | 'spedup' | null;

export interface TrackInfo {
  /** Варианты «исполнитель + название», лучшие первыми. */
  queries: LyricsQuery[];
  /** Замедленная или ускоренная версия: длительность текста будет другой. */
  version: VersionKind;
  /** Ремикс, кавер, инструментал: текст может не совпадать с оригиналом. */
  remix: boolean;
  instrumental: boolean;
}

const SLOWED = /\b(slowed|slow(?:ed)?\s*(?:\+|and|&)?\s*reverb|daycore|замедл[её]н\w*|slow\s*version)\b/iu;
const SPEDUP = /\b(sped\s*up|speed\s*up|spedup|nightcore|ускорен\w*|fast\s*version)\b/iu;
const REMIX = /\b(remix|ремикс|cover|кавер|bootleg|flip|edit|mashup|vip)\b/iu;
const INSTRUMENTAL = /\b(instrumental|инструментал|минус|karaoke|караоке|8d\s*audio)\b/iu;
/** Хвосты, которые к песне отношения не имеют. */
const NOISE =
  /\b(official\s*(music\s*)?(video|audio|visualizer|lyric\s*video)|lyrics?\s*video|lyrics?|music\s*video|audio|visualizer|hd|hq|4k|free\s*(dl|download)|out\s*now|premiere|клип|премьера|текст\s*песни|новинка|хит|\d{4}\s*(remaster(ed)?)?)\b/giu;

/** Нормализация для сравнения: регистр, ё, диакритика, пунктуация, эмодзи. */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/ё/g, 'е')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', і: 'i', ї: 'yi', є: 'ye', ґ: 'g',
};

/** Латиница из кириллицы: «Скриптонит» и «Skriptonit» должны совпасть. */
export function translit(s: string): string {
  return norm(s)
    .split('')
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('')
    .replace(/kh/g, 'h')
    .replace(/(.)\1+/g, '$1');
}

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>();
  const t = ` ${s} `;
  for (let i = 0; i < t.length - 1; i += 1) {
    const g = t.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  let common = 0;
  let total = 0;
  for (const [g, n] of A) {
    common += Math.min(n, B.get(g) ?? 0);
    total += n;
  }
  for (const n of B.values()) total += n;
  return total ? (2 * common) / total : 0;
}

/** Похожесть строк 0..1 (с учётом транслитерации и вхождения одной в другую). */
export function similarity(a: string, b: string): number {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = translit(a);
  const tb = translit(b);
  if (ta === tb) return 0.97;
  let best = Math.max(dice(na, nb), dice(ta, tb));
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (short.length >= 3 && (` ${long} `).includes(` ${short} `)) {
    best = Math.max(best, 0.82 + 0.15 * (short.length / long.length));
  }
  return Math.min(1, best);
}

/** Похожесть исполнителей: «A feat. B», «A & B», «A, B» сравниваются по каждому. */
export function artistSimilarity(a: string, b: string): number {
  const split = (s: string) =>
    s
      .split(/\s*(?:,|&|\+|\bx\b|\bfeat\.?|\bft\.?|\bfeaturing|\bи\b|\band\b|\/|;)\s*/iu)
      .map((p) => p.trim())
      .filter(Boolean);
  const pa = split(a);
  const pb = split(b);
  let best = similarity(a, b);
  for (const x of pa) for (const y of pb) best = Math.max(best, similarity(x, y) * 0.96);
  return best;
}

function stripBrackets(s: string): string {
  let out = s;
  for (let i = 0; i < 3; i += 1) out = out.replace(/\([^()]*\)|\[[^[\]]*\]|\{[^{}]*\}|【[^】]*】/g, ' ');
  return out;
}

/** Название без пометок: скобки, feat./prod., хэштеги, эмодзи, «official audio». */
export function cleanTitle(title: string): string {
  return stripBrackets(title)
    .replace(/\|.*$/, ' ')
    .replace(/#[\p{L}\p{N}_]+/gu, ' ')
    .replace(/(?<![\p{L}\p{N}])(feat|ft|featuring|prod|produced\s+by|при\s+уч\.?)\.?\s.*?(?=\s[-–—]\s|$)/iu, ' ')
    .replace(NOISE, ' ')
    .replace(SLOWED, ' ')
    .replace(SPEDUP, ' ')
    .replace(/\b(reverb|bass\s*boosted)\b/giu, ' ')
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, ' ')
    .replace(/["«»“”„*~]/g, ' ')
    .replace(/\s+[-–—+]\s*$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Исполнитель без хвостов SoundCloud: «Official», «Music», «Records», «VEVO», « - Topic». */
export function cleanArtist(artist: string): string {
  return stripBrackets(artist)
    .replace(/\s*-\s*topic$/i, '')
    .replace(/\b(official|music|records|vevo|channel|tv)\b/giu, ' ')
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Разбор трека: варианты запроса и признаки версии. */
export function trackInfo(track: { artist: string; title: string }): TrackInfo {
  const raw = `${track.title} ${track.artist}`;
  const version: VersionKind = SLOWED.test(raw) ? 'slowed' : SPEDUP.test(raw) ? 'spedup' : null;
  const remix = REMIX.test(track.title);
  const instrumental = INSTRUMENTAL.test(track.title);
  const queries: LyricsQuery[] = [];
  const title = cleanTitle(track.title);
  const uploader = cleanArtist(track.artist);
  const dash = /\s[-–—]\s|\s[-–—]|[-–—]\s/.exec(title);
  if (dash) {
    const artist = title.slice(0, dash.index).trim();
    const name = title.slice(dash.index + dash[0].length).trim();
    if (artist && name) {
      queries.push({ artist, title: name });
      // «Трек - Автор» тоже встречается.
      queries.push({ artist: name, title: artist });
    }
  }
  if (title) queries.push({ artist: uploader, title });
  // feat. в названии часто значит, что автор загрузки не главный исполнитель.
  const feat = /(?:feat|ft)\.?\s+([^()[\]]+)/iu.exec(track.title);
  if (feat && title) queries.push({ artist: feat[1].trim(), title });
  if (title && !dash) queries.push({ artist: '', title });
  const seen = new Set<string>();
  return {
    version,
    remix,
    instrumental,
    queries: queries.filter((q) => {
      const key = `${norm(q.artist)}\u0000${norm(q.title)}`;
      if (!norm(q.title) || seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  };
}

export interface Candidate {
  artist: string;
  title: string;
  /** Секунды (0, если неизвестно). */
  duration: number;
}

/**
 * Оценка найденного трека 0..1. `tempo`: во сколько раз наш трек длиннее найденного
 * (для slowed > 1, для sped up < 1), если длительности согласуются с версией.
 */
export function scoreCandidate(
  info: TrackInfo,
  duration: number,
  c: Candidate,
): { score: number; tempo: number } {
  let text = 0;
  for (const q of info.queries) {
    const t = similarity(q.title, c.title);
    const a = q.artist ? artistSimilarity(q.artist, c.artist) : 0.5;
    // Название важнее: исполнитель на SoundCloud часто записан неверно.
    text = Math.max(text, t * 0.68 + a * 0.32);
  }
  let tempo = 1;
  let dur = 0.6;
  if (duration > 0 && c.duration > 0) {
    const ratio = duration / c.duration;
    const diff = Math.abs(duration - c.duration);
    if (diff <= 3) dur = 1;
    else if (diff <= 8) dur = 0.85;
    else if (info.version === 'slowed' && ratio > 1.03 && ratio < 1.6) {
      dur = 0.85;
      tempo = ratio;
    } else if (info.version === 'spedup' && ratio < 0.97 && ratio > 0.6) {
      dur = 0.85;
      tempo = ratio;
    } else if (diff <= 20) dur = 0.45;
    else dur = 0.1;
  }
  return { score: text * 0.78 + dur * 0.22, tempo };
}

/** Сдвигает и растягивает метки LRC: время × `tempo` + `offset` (секунды). */
export function retimeLrc(lrc: string, tempo: number, offset = 0): string {
  if (tempo === 1 && offset === 0) return lrc;
  return lrc.replace(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]|<(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)>/g, (m, m1, s1, m2, s2) => {
    const mm = m1 ?? m2;
    const ss = s1 ?? s2;
    const t = Math.max(0, (parseInt(mm, 10) * 60 + parseFloat(String(ss).replace(':', '.'))) * tempo + offset);
    const stamp = formatStamp(t);
    return m.startsWith('[') ? `[${stamp}]` : `<${stamp}>`;
  });
}

export function formatStamp(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}

/** Служебные строки китайских источников (автор слов, музыки и т.п.). */
export function stripCredits(lrc: string): string {
  return lrc
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\[[^\]]*\])+\s*(作词|作曲|编曲|制作人|混音|母带|和声|录音|监制|出品|词|曲)\s*[:：]/u.test(line))
    .join('\n');
}

/**
 * NetEase YRC (пословные тексты) → Enhanced LRC.
 * Строка YRC: `[начало_мс,длительность_мс](слово_мс,длит_мс,0)слово(…)…`.
 */
export function yrcToLrc(yrc: string): string | null {
  const out: string[] = [];
  for (const raw of yrc.split(/\r?\n/)) {
    const head = raw.match(/^\[(\d+),(\d+)\]/);
    if (!head) continue;
    const lineStart = parseInt(head[1], 10) / 1000;
    const lineEnd = lineStart + parseInt(head[2], 10) / 1000;
    const words = [...raw.slice(head[0].length).matchAll(/\((\d+),(\d+),\d+\)([^(]*)/g)];
    if (!words.length) continue;
    let line = `[${formatStamp(lineStart)}]`;
    let end = lineStart;
    for (const w of words) {
      const t = parseInt(w[1], 10) / 1000;
      end = Math.max(end, t + parseInt(w[2], 10) / 1000);
      line += `<${formatStamp(t)}>${w[3]}`;
    }
    out.push(`${line}<${formatStamp(Math.min(lineEnd, end) || end)}>`);
  }
  return out.length >= 3 ? out.join('\n') : null;
}
