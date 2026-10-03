/**
 * Genius: дополнительный источник текстов (без синхронизации), когда в LRCLIB нет
 * синхронизированной версии. Используем открытый поиск сайта (genius.com/api/search/song
 * работает без токена) и разбираем страницу песни. Запросы идут через ядро (net_fetch),
 * поэтому CORS не мешает, а сетевые настройки (прокси) применяются автоматически.
 */
import { invoke } from '@tauri-apps/api/core';
import { normalize, similarity } from './match';

interface FetchResponse {
  status: number;
  url: string;
  body: string;
}

export interface GeniusHit {
  title: string;
  artist: string;
  url: string;
  instrumental: boolean;
}

export interface LyricsQuery {
  artist: string;
  title: string;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;

/** Разбирает ответ поиска Genius (формат с `sections` и старый с `hits`). */
export function parseSearch(json: unknown): GeniusHit[] {
  const response = isObj(json) && isObj(json.response) ? json.response : null;
  if (!response) return [];
  const lists: unknown[] = Array.isArray(response.sections)
    ? response.sections.map((s) => (isObj(s) ? s.hits : null))
    : [response.hits];
  const seen = new Set<string>();
  const out: GeniusHit[] = [];
  for (const hits of lists) {
    if (!Array.isArray(hits)) continue;
    for (const h of hits) {
      if (!isObj(h) || !isObj(h.result)) continue;
      if (typeof h.type === 'string' && h.type !== 'song') continue;
      const r = h.result;
      const url = typeof r.url === 'string' ? r.url : '';
      if (!/^https:\/\/genius\.com\//.test(url) || seen.has(url)) continue;
      seen.add(url);
      const artist = isObj(r.primary_artist) && typeof r.primary_artist.name === 'string' ? r.primary_artist.name : String(r.artist_names ?? '');
      out.push({ title: String(r.title ?? ''), artist, url, instrumental: r.instrumental === true });
    }
  }
  return out;
}

/** Лучший результат поиска для запроса, или null, если уверенного совпадения нет. */
export function pickHit(hits: GeniusHit[], query: LyricsQuery): GeniusHit | null {
  const wantTitle = normalize(query.title);
  const wantArtist = normalize(query.artist);
  let best: GeniusHit | null = null;
  let bestScore = 0;
  for (const hit of hits) {
    // «Genius English Translations», «Genius Romanizations»: это переводы, а не оригинал
    if (/^genius\b/i.test(hit.artist) && !/^genius\b/i.test(query.artist)) continue;
    const t = similarity(normalize(hit.title), wantTitle);
    const a = wantArtist ? similarity(normalize(hit.artist), wantArtist) : 0;
    const artistInTitle = wantArtist !== '' && normalize(hit.title).includes(wantArtist);
    if (t < 0.72) continue;
    if (wantArtist && a < 0.5 && !artistInTitle) continue;
    const score = t * 0.6 + a * 0.4;
    if (score > bestScore) {
      best = hit;
      bestScore = score;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Разбор страницы песни
// ---------------------------------------------------------------------------

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
    }
    return NAMED[code.toLowerCase()] ?? all;
  });
}

/** Индекс закрывающего тега `tag`, парного открывающему, после которого стоит `from`. */
function matchingClose(html: string, from: number, tag: string): number {
  const re = new RegExp(`<${tag}\\b[^>]*>|</${tag}\\s*>`, 'gi');
  re.lastIndex = from;
  let depth = 1;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[0][1] === '/') {
      depth -= 1;
      if (depth === 0) return m.index;
    } else if (!m[0].endsWith('/>')) {
      depth += 1;
    }
  }
  return -1;
}

/** Вырезает служебные блоки (заголовок «N Contributors», «Translations»…). */
function removeExcluded(html: string): string {
  const re = /<([a-z0-9]+)\b[^>]*data-exclude-from-selection="true"[^>]*>/i;
  let out = html;
  for (let guard = 0; guard < 100; guard += 1) {
    const m = re.exec(out);
    if (!m) break;
    const tag = m[1].toLowerCase();
    const openEnd = m.index + m[0].length;
    const close = m[0].endsWith('/>') ? -1 : matchingClose(out, openEnd, tag);
    const cut = close < 0 ? openEnd : out.indexOf('>', close) + 1;
    out = out.slice(0, m.index) + out.slice(cut);
  }
  return out;
}

function tidy(text: string): string | null {
  const out = text
    .split('\n')
    .map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return out.length > 0 ? out : null;
}

/** Строковый разбор (для тестов и на случай, если DOMParser недоступен). */
export function extractLyricsFromHtml(html: string): string | null {
  const parts: string[] = [];
  const re = /<div\b[^>]*data-lyrics-container="true"[^>]*>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const start = m.index + m[0].length;
    const end = matchingClose(html, start, 'div');
    if (end < 0) break;
    parts.push(html.slice(start, end));
    re.lastIndex = end;
  }
  if (!parts.length) return null;
  const inner = removeExcluded(parts.join('<br/>'));
  const text = inner
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return tidy(decodeEntities(text));
}

/** Текст песни со страницы Genius. */
export function extractLyrics(html: string): string | null {
  if (typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const blocks = Array.from(doc.querySelectorAll('[data-lyrics-container="true"]'));
      if (blocks.length) {
        const text = blocks
          .map((block) => {
            const el = block.cloneNode(true) as Element;
            el.querySelectorAll('[data-exclude-from-selection="true"]').forEach((x) => x.remove());
            el.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
            return el.textContent ?? '';
          })
          .join('\n');
        return tidy(text);
      }
    } catch {
      /* разберём строкой */
    }
  }
  return extractLyricsFromHtml(html);
}

// ---------------------------------------------------------------------------
// Сеть
// ---------------------------------------------------------------------------

async function get(url: string, accept?: string): Promise<FetchResponse> {
  return invoke<FetchResponse>('net_fetch', { url, accept: accept ?? null });
}

export interface GeniusLyrics {
  text: string;
  url: string;
  title: string;
  artist: string;
}

/** Ищет текст на Genius по списку вариантов «исполнитель + название». */
export async function geniusLyrics(queries: LyricsQuery[]): Promise<GeniusLyrics | null> {
  const tried = new Set<string>();
  for (const q of queries) {
    const text = `${q.artist} ${q.title}`.trim();
    if (!q.title || tried.has(text.toLowerCase())) continue;
    tried.add(text.toLowerCase());
    const res = await get(`https://genius.com/api/search/song?per_page=5&q=${encodeURIComponent(text)}`);
    if (res.status !== 200) continue;
    let json: unknown;
    try {
      json = JSON.parse(res.body);
    } catch {
      continue;
    }
    const hit = pickHit(parseSearch(json), q);
    if (!hit) continue;
    const page = await get(hit.url, 'text/html,application/xhtml+xml');
    if (page.status !== 200) continue;
    const lyrics = extractLyrics(page.body);
    if (lyrics) return { text: lyrics, url: hit.url, title: hit.title, artist: hit.artist };
  }
  return null;
}
