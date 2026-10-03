/**
 * «Умная подмена»: поиск того же трека в другом источнике.
 * Нужна, когда SoundCloud отдаёт только 30-секундное превью (Go+), трек недоступен
 * в регионе или остался в медиатеке от старого источника (Audius/Jamendo).
 */
import type { Track } from './types';

// `\b` в JS понимает только латиницу, поэтому границы слов задаём через Unicode-классы:
// иначе «кавер», «ремикс» или «клип» никогда не находились бы.
const B = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';
const NOISE = new RegExp(
  `${B}(official music video|official video|official audio|lyric video|lyrics?|visuali[sz]er|video|audio|hd|hq|4k|remaster(?:ed)?(?: \\d{4})?|clip|клип|премьера|mv)${E}`,
  'giu',
);
const VERSION_WORDS = new RegExp(
  `${B}(cover|karaoke|nightcore|sped ?up|slowed|reverb|8d|instrumental|remix|bass ?boosted|кавер|минус|ремикс|караоке|speed ?up)${E}`,
  'iu',
);
/** «feat. Кто-то» до конца, скобки или « - Название». */
const FEAT = /(?<![\p{L}\p{N}])(feat|ft|featuring|prod)\.?\s+.*?(?=\s[-–—]\s|[([]|$)/iu;

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[([{][^)\]}]*[)\]}]/g, (m) => (VERSION_WORDS.test(m) ? m : ' '))
    .replace(FEAT, ' ')
    .replace(NOISE, ' ')
    .replace(/[«»"'`’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(text: string): string[] {
  return normalize(text).split(' ').filter(Boolean);
}

/** Коэффициент Дайса по словам (0…1). */
export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const pool = new Map<string, number>();
  for (const t of tb) pool.set(t, (pool.get(t) ?? 0) + 1);
  let common = 0;
  for (const t of ta) {
    const n = pool.get(t) ?? 0;
    if (n > 0) {
      common += 1;
      pool.set(t, n - 1);
    }
  }
  return (2 * common) / (ta.length + tb.length);
}

function durationScore(a: number, b: number): number {
  if (!(a > 0) || !(b > 0)) return 0.5;
  const d = Math.abs(a - b);
  if (d <= 3) return 1;
  if (d <= 8) return 0.8;
  if (d <= 20) return 0.4;
  return 0;
}

/** Похожесть кандидата на искомый трек (0…1). */
export function matchScore(want: Pick<Track, 'title' | 'artist' | 'duration'>, cand: Pick<Track, 'title' | 'artist' | 'duration'>): number {
  const structured =
    similarity(want.title, cand.title) * 0.55 + (want.artist ? Math.max(similarity(want.artist, cand.artist), similarity(want.artist, cand.title) * 0.8) : 0.5) * 0.45;
  // На SoundCloud часто «Артист - Название» в заголовке и загрузчик вместо артиста.
  const combined = similarity(`${want.artist} ${want.title}`, `${cand.artist} ${cand.title}`);
  let score = Math.max(structured, combined) * 0.8 + durationScore(want.duration, cand.duration) * 0.2;
  if (VERSION_WORDS.test(cand.title) && !VERSION_WORDS.test(want.title)) score -= 0.3;
  return Math.max(0, Math.min(1, score));
}

export function bestMatch(want: Track, candidates: Track[], threshold = 0.6): Track | null {
  let best: Track | null = null;
  let bestScore = threshold;
  for (const cand of candidates) {
    if (!cand.streamable || cand.previewOnly) continue;
    if (cand.provider === want.provider && cand.id === want.id) continue;
    const score = matchScore(want, cand);
    if (score > bestScore) {
      best = cand;
      bestScore = score;
    }
  }
  return best;
}

export function searchQuery(track: Pick<Track, 'title' | 'artist'>): string {
  const title = normalize(track.title);
  const artist = normalize(track.artist);
  if (!artist || title.includes(artist)) return title;
  return `${artist} ${title}`;
}
