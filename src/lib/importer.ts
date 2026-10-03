/**
 * Импорт плейлистов: файлы M3U/M3U8, CSV (Exportify, TuneMyMusic, таблицы) и простой
 * текст «Артист - Название», а также ссылки на плейлисты YouTube Music и SoundCloud.
 * Разбор файлов здесь чистый и проверяется тестами; поиск треков в import.ts.
 */
import { decodeTextFile } from './encoding';
import { tagsFromFileName } from './tags';

export interface ImportItem {
  title: string;
  artist: string;
  /** Секунды, если известны: помогают выбрать правильную версию трека. */
  duration?: number;
  /** Путь к файлу из M3U: если он есть в медиатеке «На компьютере», берём его. */
  path?: string;
}

const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** «Артист - Название» (дефис, тире или длинное тире с пробелами). */
export function splitArtistTitle(line: string): { artist: string; title: string } | null {
  const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(clean(line));
  return m ? { artist: m[1].trim(), title: m[2].trim() } : null;
}

export function parseM3U(text: string): ImportItem[] {
  const items: ImportItem[] = [];
  let info: { duration?: number; artist?: string; title?: string } | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) {
      const body = line.slice(8);
      const comma = body.indexOf(',');
      const seconds = Number.parseFloat(body.slice(0, comma < 0 ? undefined : comma));
      const name = comma < 0 ? '' : body.slice(comma + 1);
      const pair = splitArtistTitle(name);
      info = { duration: seconds > 0 ? seconds : undefined, artist: pair?.artist, title: pair?.title ?? (clean(name) || undefined) };
      continue;
    }
    if (line.startsWith('#')) continue;
    const isUrl = /^[a-z]+:\/\//i.test(line) && !/^file:/i.test(line);
    const path = isUrl ? undefined : decodeURIComponent(line.replace(/^file:\/\/\/?/i, ''));
    const byName = tagsFromFileName(isUrl ? line.split(/[?#]/)[0] : line);
    const title = info?.title ?? byName.title;
    const artist = info?.artist ?? byName.artist ?? '';
    if (title) items.push({ title, artist, duration: info?.duration, path });
    info = null;
  }
  return items;
}

/** Разбор CSV с кавычками; разделитель угадывается по первой строке. */
export function parseCsvRows(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', ';', '\t'].map((d) => [d, first.split(d).length] as const);
  const delim = counts.sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}

const TITLE_COLS = ['track name', 'title', 'track', 'name', 'song', 'song name', 'track title', 'название', 'трек', 'песня'];
const ARTIST_COLS = ['artist name(s)', 'artist name', 'artist', 'artists', 'artist(s)', 'исполнитель', 'артист', 'исполнители'];
const DURATION_COLS = ['track duration (ms)', 'duration (ms)', 'duration_ms', 'duration', 'длительность'];

function findCol(header: string[], names: string[]): number {
  for (const name of names) {
    const i = header.indexOf(name);
    if (i >= 0) return i;
  }
  return -1;
}

export function parseCSV(text: string): ImportItem[] {
  const rows = parseCsvRows(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => clean(h).toLowerCase());
  let ti = findCol(header, TITLE_COLS);
  let ai = findCol(header, ARTIST_COLS);
  const di = findCol(header, DURATION_COLS);
  let body = rows.slice(1);
  if (ti < 0) {
    // Без заголовка: «Артист, Название» или одна колонка «Артист - Название»
    body = rows;
    if (rows[0].length >= 2) {
      ai = 0;
      ti = 1;
    } else {
      return parseText(rows.map((r) => r[0]).join('\n'));
    }
  }
  const items: ImportItem[] = [];
  for (const r of body) {
    let title = clean(r[ti]);
    let artist = ai >= 0 ? clean(r[ai]) : '';
    if (!title) continue;
    if (!artist) {
      const pair = splitArtistTitle(title);
      if (pair) ({ artist, title } = pair);
    }
    // Exportify перечисляет соавторов через запятую: для поиска хватит первых двух
    artist = artist.split(/\s*[,;]\s*/).filter(Boolean).slice(0, 2).join(', ');
    let duration: number | undefined;
    if (di >= 0) {
      const raw = clean(r[di]);
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) duration = header[di].includes('ms') || n > 10000 ? n / 1000 : n;
      else {
        const mmss = /^(\d+):(\d{2})$/.exec(raw);
        if (mmss) duration = Number(mmss[1]) * 60 + Number(mmss[2]);
      }
    }
    items.push({ title, artist, duration });
  }
  return items;
}

/** Строки «Артист - Название» (номера в начале и пустые строки пропускаются). */
export function parseText(text: string): ImportItem[] {
  const items: ImportItem[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = clean(raw.replace(/^\s*\d{1,4}[.)]\s+/, ''));
    if (!line || line.startsWith('#')) continue;
    const pair = splitArtistTitle(line);
    items.push(pair ? { artist: pair.artist, title: pair.title } : { artist: '', title: line });
  }
  return items;
}

export function parsePlaylistFile(name: string, bytes: Uint8Array): ImportItem[] {
  const text = decodeTextFile(bytes);
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'm3u' || ext === 'm3u8' || text.trimStart().startsWith('#EXTM3U')) return parseM3U(text);
  if (ext === 'csv' || ext === 'tsv') return parseCSV(text);
  return parseText(text);
}

/** Название плейлиста по имени файла. */
export const playlistNameFromFile = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || 'Импорт';
