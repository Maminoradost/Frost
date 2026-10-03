/**
 * Теги и длительность аудиофайлов без внешних библиотек: MP3 (ID3v2.2–2.4, ID3v1,
 * Xing/VBRI), FLAC, OGG Vorbis/Opus, M4A/MP4 и WAV. Файл целиком не читается:
 * нужные куски запрашиваются через `read(start, length)` (обычно 128 КБ с начала
 * и немного с конца). Старые русские теги в Windows-1251 распознаются сами.
 */

export interface AudioTags {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  track?: number;
  disc?: number;
  year?: number;
  genre?: string;
  /** Секунды, если их можно узнать из заголовков. */
  duration?: number;
  picture?: { mime: string; data: Uint8Array };
}

export type ReadFn = (start: number, length: number) => Promise<Uint8Array>;

const HEAD = 128 * 1024;
/** Больше этого метаданные не читаем (огромные обложки просто пропускаем). */
const MAX_META = 12 * 1024 * 1024;

import { decodeLegacy, decodeSmart } from './encoding';

// ---------------------------------------------------------------------------
// Текст
// ---------------------------------------------------------------------------

const utf8 = new TextDecoder('utf-8');
const utf16 = new TextDecoder('utf-16le');

function decodeUtf16(bytes: Uint8Array, bigEndian: boolean): string {
  let b = bytes;
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) {
    b = b.subarray(2);
    bigEndian = false;
  } else if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
    b = b.subarray(2);
    bigEndian = true;
  }
  if (!bigEndian) return utf16.decode(b);
  const swapped = new Uint8Array(b.length - (b.length % 2));
  for (let i = 0; i + 1 < b.length; i += 2) {
    swapped[i] = b[i + 1];
    swapped[i + 1] = b[i];
  }
  return utf16.decode(swapped);
}

function decodeId3(enc: number, bytes: Uint8Array): string {
  switch (enc) {
    case 1:
      return decodeUtf16(bytes, false);
    case 2:
      return decodeUtf16(bytes, true);
    case 3:
      return utf8.decode(bytes);
    default:
      return decodeLegacy(bytes);
  }
}

/** Конец строки с учётом кодировки: смещение терминатора (или длина) и следующей позиции. */
function terminator(enc: number, b: Uint8Array, start: number): [end: number, next: number] {
  if (enc === 1 || enc === 2) {
    for (let i = start; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return [i, i + 2];
    return [b.length, b.length];
  }
  const i = b.indexOf(0, start);
  return i < 0 ? [b.length, b.length] : [i, i + 1];
}

const clean = (s: string | undefined) => {
  const t = s?.replace(/\0/g, '').replace(/\s+/g, ' ').trim();
  return t ? t : undefined;
};

const ascii = (b: Uint8Array, o: number, n: number) => {
  let s = '';
  for (let i = o; i < o + n && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};

const u16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u24 = (b: Uint8Array, o: number) => (b[o] << 16) | (b[o + 1] << 8) | b[o + 2];
const u32 = (b: Uint8Array, o: number) => b[o] * 0x1000000 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
const le32 = (b: Uint8Array, o: number) => b[o] + (b[o + 1] << 8) + (b[o + 2] << 16) + b[o + 3] * 0x1000000;
const le64 = (b: Uint8Array, o: number) => le32(b, o) + le32(b, o + 4) * 0x100000000;
const syncsafe = (b: Uint8Array, o: number) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);

/** «3/12» → 3. */
function num(s: string | undefined): number | undefined {
  const m = /^\s*(\d{1,4})/.exec(s ?? '');
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function year(s: string | undefined): number | undefined {
  const m = /(\d{4})/.exec(s ?? '');
  const y = m ? Number(m[1]) : NaN;
  return y >= 1000 && y <= 2999 ? y : undefined;
}

const GENRES =
  'Blues|Classic Rock|Country|Dance|Disco|Funk|Grunge|Hip-Hop|Jazz|Metal|New Age|Oldies|Other|Pop|R&B|Rap|Reggae|Rock|Techno|Industrial|Alternative|Ska|Death Metal|Pranks|Soundtrack|Euro-Techno|Ambient|Trip-Hop|Vocal|Jazz+Funk|Fusion|Trance|Classical|Instrumental|Acid|House|Game|Sound Clip|Gospel|Noise|AlternRock|Bass|Soul|Punk|Space|Meditative|Instrumental Pop|Instrumental Rock|Ethnic|Gothic|Darkwave|Techno-Industrial|Electronic|Pop-Folk|Eurodance|Dream|Southern Rock|Comedy|Cult|Gangsta|Top 40|Christian Rap|Pop/Funk|Jungle|Native American|Cabaret|New Wave|Psychadelic|Rave|Showtunes|Trailer|Lo-Fi|Tribal|Acid Punk|Acid Jazz|Polka|Retro|Musical|Rock & Roll|Hard Rock'.split(
    '|',
  );

/** «(17)», «17» и «(17)Rock» → название жанра. */
export function genreName(raw: string | undefined): string | undefined {
  const s = clean(raw);
  if (!s) return undefined;
  const m = /^\((\d+)\)\s*(.*)$/.exec(s) ?? /^(\d+)()$/.exec(s);
  if (m) return clean(m[2]) ?? GENRES[Number(m[1])] ?? undefined;
  return s;
}

function merge(into: AudioTags, from: AudioTags) {
  for (const [k, v] of Object.entries(from) as [keyof AudioTags, never][]) {
    if (into[k] === undefined && v !== undefined) into[k] = v;
  }
  return into;
}

// ---------------------------------------------------------------------------
// Буфер, который дочитывается по мере надобности
// ---------------------------------------------------------------------------

class Source {
  constructor(
    readonly read: ReadFn,
    readonly size: number,
    public buf: Uint8Array,
  ) {}

  /** Гарантирует, что в буфере есть байты [0, end). false, если это слишком много. */
  async ensure(end: number): Promise<boolean> {
    const want = Math.min(end, this.size);
    if (want <= this.buf.length) return true;
    if (want > MAX_META) return false;
    const more = await this.read(this.buf.length, want - this.buf.length);
    const next = new Uint8Array(this.buf.length + more.length);
    next.set(this.buf);
    next.set(more, this.buf.length);
    this.buf = next;
    return this.buf.length >= want;
  }

  /** Последние `n` байт файла. */
  async tail(n: number): Promise<Uint8Array> {
    const from = Math.max(0, this.size - n);
    if (this.size <= this.buf.length) return this.buf.subarray(from, this.size);
    return this.read(from, this.size - from);
  }

  /** Произвольный кусок файла (из буфера, если он уже прочитан). */
  async slice(start: number, length: number): Promise<Uint8Array> {
    const end = Math.min(this.size, start + length);
    if (end <= this.buf.length) return this.buf.subarray(start, end);
    return this.read(start, end - start);
  }
}

// ---------------------------------------------------------------------------
// ID3v2
// ---------------------------------------------------------------------------

function removeUnsync(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  let j = 0;
  for (let i = 0; i < data.length; i++) {
    out[j++] = data[i];
    if (data[i] === 0xff && data[i + 1] === 0) i++;
  }
  return out.subarray(0, j);
}

const ID3_FIELDS: Record<string, keyof AudioTags | 'pic' | 'len'> = {
  TIT2: 'title', TT2: 'title',
  TPE1: 'artist', TP1: 'artist',
  TALB: 'album', TAL: 'album',
  TPE2: 'albumArtist', TP2: 'albumArtist',
  TRCK: 'track', TRK: 'track',
  TPOS: 'disc', TPA: 'disc',
  TYER: 'year', TYE: 'year', TDRC: 'year', TORY: 'year', TDOR: 'year',
  TCON: 'genre', TCO: 'genre',
  TLEN: 'len', TLE: 'len',
  APIC: 'pic', PIC: 'pic',
};

/** Размер тега ID3v2 вместе с заголовком (0, если тега нет). */
export function id3Size(b: Uint8Array, o = 0): number {
  if (ascii(b, o, 3) !== 'ID3' || b.length < o + 10) return 0;
  return 10 + syncsafe(b, o + 6) + (b[o + 5] & 0x10 ? 10 : 0);
}

export function parseId3v2(b: Uint8Array): AudioTags {
  const tags: AudioTags = {};
  if (ascii(b, 0, 3) !== 'ID3') return tags;
  const ver = b[3];
  const flags = b[5];
  const end = Math.min(b.length, 10 + syncsafe(b, 6));
  let data = b.subarray(10, end);
  if (ver < 4 && flags & 0x80) data = removeUnsync(data);
  let p = 0;
  if (flags & 0x40) p = ver >= 4 ? syncsafe(data, 0) : 4 + u32(data, 0);
  const idLen = ver === 2 ? 3 : 4;
  const head = ver === 2 ? 6 : 10;
  let picture: { mime: string; data: Uint8Array; type: number } | null = null;
  let lenMs = 0;
  while (p + head <= data.length) {
    const id = ascii(data, p, idLen);
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
    const size = ver === 2 ? u24(data, p + 3) : ver >= 4 ? syncsafe(data, p + 4) : u32(data, p + 4);
    const fflags = ver === 2 ? 0 : u16(data, p + 8);
    const start = p + head;
    p = start + size;
    if (size <= 0) continue;
    if (start + size > data.length) break; // дальше тег не прочитан
    const field = ID3_FIELDS[id];
    if (!field) continue;
    let body = data.subarray(start, start + size);
    if (ver >= 4) {
      if (fflags & 0x000c) continue; // сжатие, шифрование
      if (fflags & 0x0040) body = body.subarray(1);
      if (fflags & 0x0001) body = body.subarray(4);
      if (fflags & 0x0002) body = removeUnsync(body);
    } else if (ver === 3) {
      if (fflags & 0x00c0) continue;
      if (fflags & 0x0020) body = body.subarray(1);
    }
    if (!body.length) continue;
    const enc = body[0];
    if (field === 'pic') {
      let q = 1;
      let mime: string;
      if (ver === 2) {
        const fmt = ascii(body, 1, 3).toUpperCase();
        mime = fmt === 'PNG' ? 'image/png' : 'image/jpeg';
        q = 4;
      } else {
        const z = body.indexOf(0, 1);
        if (z < 0) continue;
        mime = ascii(body, 1, z - 1).toLowerCase() || 'image/jpeg';
        if (!mime.includes('/')) mime = `image/${mime === 'jpg' ? 'jpeg' : mime}`;
        q = z + 1;
      }
      const type = body[q];
      const [, next] = terminator(enc, body, q + 1);
      const img = body.subarray(next);
      if (img.length > 32 && (!picture || (type === 3 && picture.type !== 3))) picture = { mime, data: img, type };
      continue;
    }
    const text = decodeId3(enc, body.subarray(1));
    const values = text.split('\0').map((v) => clean(v)).filter((v): v is string => !!v);
    if (!values.length) continue;
    switch (field) {
      case 'len':
        lenMs = Number(values[0]) || 0;
        break;
      case 'track':
      case 'disc':
        tags[field] ??= num(values[0]);
        break;
      case 'year':
        tags.year ??= year(values[0]);
        break;
      case 'genre':
        tags.genre ??= genreName(values[0]);
        break;
      case 'artist':
        tags.artist ??= values.join(', ');
        break;
      default:
        if (field === 'title' || field === 'album' || field === 'albumArtist') tags[field] ??= values[0];
    }
  }
  if (picture) tags.picture = { mime: picture.mime, data: picture.data };
  if (lenMs > 1000) tags.duration = lenMs / 1000;
  return tags;
}

export function parseId3v1(b: Uint8Array): AudioTags {
  if (b.length < 128 || ascii(b, b.length - 128, 3) !== 'TAG') return {};
  const t = b.subarray(b.length - 128);
  const field = (o: number, n: number) => {
    const raw = t.subarray(o, o + n);
    const z = raw.indexOf(0);
    return clean(decodeLegacy(z >= 0 ? raw.subarray(0, z) : raw));
  };
  const tags: AudioTags = {
    title: field(3, 30),
    artist: field(33, 30),
    album: field(63, 30),
    year: year(ascii(t, 93, 4)),
    genre: t[127] < GENRES.length ? GENRES[t[127]] : undefined,
  };
  if (t[125] === 0 && t[126] !== 0) tags.track = t[126];
  return tags;
}

// ---------------------------------------------------------------------------
// MPEG
// ---------------------------------------------------------------------------

const BITRATES: Record<string, number[]> = {
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SAMPLE_RATES = [
  [44100, 48000, 32000],
  [22050, 24000, 16000],
  [11025, 12000, 8000],
];

interface MpegFrame {
  version: 1 | 2 | 2.5;
  layer: 1 | 2 | 3;
  bitrate: number;
  rate: number;
  mono: boolean;
  length: number;
  samples: number;
}

function mpegHeader(b: Uint8Array, o: number): MpegFrame | null {
  if (o + 4 > b.length || b[o] !== 0xff || (b[o + 1] & 0xe0) !== 0xe0) return null;
  const v = (b[o + 1] >> 3) & 3;
  const l = (b[o + 1] >> 1) & 3;
  const br = b[o + 2] >> 4;
  const sr = (b[o + 2] >> 2) & 3;
  if (v === 1 || l === 0 || br === 0 || br === 15 || sr === 3) return null;
  const version = v === 3 ? 1 : v === 2 ? 2 : 2.5;
  const layer = (4 - l) as 1 | 2 | 3;
  const bitrate = BITRATES[version === 1 ? `1-${layer}` : layer === 1 ? '2-1' : '2-2'][br];
  const rate = SAMPLE_RATES[version === 1 ? 0 : version === 2 ? 1 : 2][sr];
  const pad = (b[o + 2] >> 1) & 1;
  const samples = layer === 1 ? 384 : layer === 2 || version === 1 ? 1152 : 576;
  const length = layer === 1 ? Math.floor((12 * bitrate * 1000) / rate + pad) * 4 : Math.floor(((samples / 8) * bitrate * 1000) / rate) + pad;
  return { version, layer, bitrate, rate, mono: b[o + 3] >> 6 === 3, length, samples };
}

/** Первый настоящий кадр MPEG (следующий кадр тоже должен начинаться с синхрослова). */
function findFrame(b: Uint8Array, from: number): [number, MpegFrame] | null {
  const limit = Math.min(b.length - 4, from + 64 * 1024);
  for (let i = from; i < limit; i++) {
    if (b[i] !== 0xff) continue;
    const f = mpegHeader(b, i);
    if (!f || f.length < 24) continue;
    const next = i + f.length;
    if (next + 4 <= b.length && !mpegHeader(b, next)) continue;
    return [i, f];
  }
  return null;
}

/** Длительность MP3: по заголовку Xing/Info/VBRI или по битрейту (CBR). */
export function mpegDuration(b: Uint8Array, audioStart: number, audioBytes: number): number | undefined {
  const found = findFrame(b, audioStart);
  if (!found) return undefined;
  const [at, f] = found;
  const side = f.version === 1 ? (f.mono ? 17 : 32) : f.mono ? 9 : 17;
  const x = at + 4 + side;
  const tag = ascii(b, x, 4);
  if ((tag === 'Xing' || tag === 'Info') && x + 12 <= b.length) {
    const flags = u32(b, x + 4);
    if (flags & 1) {
      const frames = u32(b, x + 8);
      if (frames > 0) return (frames * f.samples) / f.rate;
    }
  }
  if (ascii(b, at + 36, 4) === 'VBRI' && at + 54 <= b.length) {
    const frames = u32(b, at + 50);
    if (frames > 0) return (frames * f.samples) / f.rate;
  }
  const bytes = audioBytes - (at - audioStart);
  return bytes > 0 ? (bytes * 8) / (f.bitrate * 1000) : undefined;
}

async function readMp3(src: Source): Promise<AudioTags> {
  let tags: AudioTags = {};
  let audioStart = 0;
  const size = id3Size(src.buf);
  if (size) {
    const ok = await src.ensure(size + 8192);
    tags = parseId3v2(ok ? src.buf : src.buf.subarray(0, Math.min(src.buf.length, size)));
    audioStart = size;
    // Бывает несколько тегов подряд (после правки разными программами)
    while (id3Size(src.buf, audioStart) && audioStart < src.buf.length) {
      const extra = id3Size(src.buf, audioStart);
      await src.ensure(audioStart + extra + 8192);
      merge(tags, parseId3v2(src.buf.subarray(audioStart)));
      audioStart += extra;
    }
  }
  let tail: Uint8Array = new Uint8Array(0);
  if (src.size > 128 + audioStart) {
    tail = await src.tail(128);
  }
  const v1 = parseId3v1(tail);
  merge(tags, v1);
  if (tags.duration === undefined) {
    const audioBytes = src.size - audioStart - (v1.title !== undefined || ascii(tail, 0, 3) === 'TAG' ? 128 : 0);
    tags.duration = mpegDuration(src.buf, audioStart, audioBytes);
  }
  return tags;
}

// ---------------------------------------------------------------------------
// Vorbis comment (FLAC, OGG) и картинка в формате FLAC
// ---------------------------------------------------------------------------

function parsePictureBlock(b: Uint8Array): AudioTags['picture'] | undefined {
  if (b.length < 32) return undefined;
  let p = 4;
  const mimeLen = u32(b, p);
  const mime = ascii(b, p + 4, mimeLen).toLowerCase() || 'image/jpeg';
  p += 4 + mimeLen;
  const descLen = u32(b, p);
  p += 4 + descLen + 16;
  const len = u32(b, p);
  p += 4;
  if (p + len > b.length || len < 32) return undefined;
  return { mime, data: b.subarray(p, p + len) };
}

function base64Bytes(text: string): Uint8Array {
  const bin = atob(text.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function parseVorbisComment(b: Uint8Array, o = 0): AudioTags {
  const tags: AudioTags = {};
  if (o + 8 > b.length) return tags;
  let p = o + 4 + le32(b, o);
  const count = le32(b, p);
  p += 4;
  const artists: string[] = [];
  for (let i = 0; i < count && p + 4 <= b.length; i++) {
    const len = le32(b, p);
    p += 4;
    if (p + len > b.length) break;
    const entry = b.subarray(p, p + len);
    p += len;
    const eq = entry.indexOf(0x3d);
    if (eq <= 0) continue;
    const key = ascii(entry, 0, eq).toUpperCase();
    if (key === 'METADATA_BLOCK_PICTURE') {
      if (!tags.picture) {
        try {
          tags.picture = parsePictureBlock(base64Bytes(ascii(entry, eq + 1, entry.length - eq - 1)));
        } catch {
          /* битая картинка */
        }
      }
      continue;
    }
    const value = clean(utf8.decode(entry.subarray(eq + 1)));
    if (!value) continue;
    switch (key) {
      case 'TITLE':
        tags.title ??= value;
        break;
      case 'ARTIST':
        artists.push(value);
        break;
      case 'ALBUM':
        tags.album ??= value;
        break;
      case 'ALBUMARTIST':
      case 'ALBUM ARTIST':
      case 'ALBUM_ARTIST':
        tags.albumArtist ??= value;
        break;
      case 'TRACKNUMBER':
        tags.track ??= num(value);
        break;
      case 'DISCNUMBER':
        tags.disc ??= num(value);
        break;
      case 'DATE':
      case 'YEAR':
      case 'ORIGINALDATE':
        tags.year ??= year(value);
        break;
      case 'GENRE':
        tags.genre ??= genreName(value);
        break;
    }
  }
  if (artists.length) tags.artist = artists.join(', ');
  return tags;
}

async function readFlac(src: Source, start: number): Promise<AudioTags> {
  const tags: AudioTags = {};
  let p = start + 4;
  for (let guard = 0; guard < 64; guard++) {
    if (!(await src.ensure(p + 4))) break;
    const b = src.buf;
    const last = (b[p] & 0x80) !== 0;
    const type = b[p] & 0x7f;
    const len = u24(b, p + 1);
    const body = p + 4;
    p = body + len;
    if (type === 0 || type === 4 || type === 6) {
      if (!(await src.ensure(p))) {
        if (type === 6) {
          if (last) break;
          continue;
        }
        break;
      }
      const block = src.buf.subarray(body, p);
      if (type === 0 && block.length >= 18) {
        const rate = (block[10] << 12) | (block[11] << 4) | (block[12] >> 4);
        const total = (block[13] & 0x0f) * 0x100000000 + u32(block, 14);
        if (rate > 0 && total > 0) tags.duration = total / rate;
      } else if (type === 4) {
        merge(tags, parseVorbisComment(block));
      } else if (type === 6 && !tags.picture) {
        tags.picture = parsePictureBlock(block);
      }
    }
    if (last) break;
  }
  return tags;
}

// ---------------------------------------------------------------------------
// OGG (Vorbis, Opus)
// ---------------------------------------------------------------------------

/** Первые пакеты логического потока OGG (склеиваются из сегментов страниц). */
async function oggPackets(src: Source, want: number): Promise<Uint8Array[]> {
  const packets: Uint8Array[] = [];
  let current: Uint8Array[] = [];
  let p = 0;
  while (packets.length < want) {
    if (!(await src.ensure(p + 27)) || ascii(src.buf, p, 4) !== 'OggS') break;
    const segs = src.buf[p + 26];
    if (!(await src.ensure(p + 27 + segs))) break;
    const table = src.buf.subarray(p + 27, p + 27 + segs);
    let total = 0;
    for (const s of table) total += s;
    let q = p + 27 + segs;
    if (!(await src.ensure(q + total))) break;
    for (const s of table) {
      current.push(src.buf.subarray(q, q + s));
      q += s;
      if (s < 255) {
        const len = current.reduce((n, c) => n + c.length, 0);
        const packet = new Uint8Array(len);
        let o = 0;
        for (const c of current) {
          packet.set(c, o);
          o += c.length;
        }
        packets.push(packet);
        current = [];
        if (packets.length >= want) break;
      }
    }
    p = q;
  }
  return packets;
}

async function readOgg(src: Source): Promise<AudioTags> {
  const [ident, comments] = await oggPackets(src, 2);
  if (!ident) return {};
  let tags: AudioTags = {};
  let rate = 0;
  let preskip = 0;
  if (ascii(ident, 0, 8) === 'OpusHead') {
    rate = 48000;
    preskip = ident[10] | (ident[11] << 8);
    if (comments && ascii(comments, 0, 8) === 'OpusTags') tags = parseVorbisComment(comments, 8);
  } else if (ascii(ident, 1, 6) === 'vorbis') {
    rate = le32(ident, 12);
    if (comments && ascii(comments, 1, 6) === 'vorbis') tags = parseVorbisComment(comments, 7);
  }
  if (rate > 0) {
    const tail = await src.tail(64 * 1024);
    for (let i = tail.length - 27; i >= 0; i--) {
      if (tail[i] === 0x4f && ascii(tail, i, 4) === 'OggS') {
        const granule = le64(tail, i + 6);
        if (granule > 0 && granule < 2 ** 52) tags.duration = Math.max(0, granule - preskip) / rate;
        break;
      }
    }
  }
  return tags;
}

// ---------------------------------------------------------------------------
// MP4 / M4A
// ---------------------------------------------------------------------------

interface Atom {
  type: string;
  start: number;
  body: number;
  end: number;
}

function* atoms(b: Uint8Array, from: number, to: number): Generator<Atom> {
  let p = from;
  while (p + 8 <= to) {
    let size = u32(b, p);
    const type = ascii(b, p + 4, 4);
    let body = p + 8;
    if (size === 1) {
      size = u32(b, p + 8) * 0x100000000 + u32(b, p + 12);
      body = p + 16;
    } else if (size === 0) size = to - p;
    if (size < 8) return;
    yield { type, start: p, body, end: Math.min(to, p + size) };
    p += size;
  }
}

const child = (b: Uint8Array, parent: Atom, type: string) => {
  for (const a of atoms(b, parent.body, parent.end)) if (a.type === type) return a;
  return null;
};

const MP4_TEXT: Record<string, keyof AudioTags> = {
  '\u00a9nam': 'title',
  '\u00a9ART': 'artist',
  '\u00a9alb': 'album',
  aART: 'albumArtist',
  '\u00a9day': 'year',
  '\u00a9gen': 'genre',
};

export function parseMoov(b: Uint8Array): AudioTags {
  const tags: AudioTags = {};
  const moov: Atom = { type: 'moov', start: 0, body: 8, end: b.length };
  const mvhd = child(b, moov, 'mvhd');
  if (mvhd) {
    const v = b[mvhd.body];
    const scale = v === 1 ? u32(b, mvhd.body + 20) : u32(b, mvhd.body + 12);
    const dur = v === 1 ? u32(b, mvhd.body + 24) * 0x100000000 + u32(b, mvhd.body + 28) : u32(b, mvhd.body + 16);
    if (scale > 0 && dur > 0) tags.duration = dur / scale;
  }
  const udta = child(b, moov, 'udta');
  const meta = udta && child(b, udta, 'meta');
  if (!meta) return tags;
  // У iTunes-атома meta есть 4 байта версии и флагов, у QuickTime их нет
  const inner: Atom = ascii(b, meta.body + 4, 4) === 'hdlr' ? meta : { ...meta, body: meta.body + 4 };
  const ilst = child(b, inner, 'ilst');
  if (!ilst) return tags;
  for (const item of atoms(b, ilst.body, ilst.end)) {
    const data = child(b, item, 'data');
    if (!data || data.end - data.body < 8) continue;
    const kind = u24(b, data.body + 1);
    const value = b.subarray(data.body + 8, data.end);
    const field = MP4_TEXT[item.type];
    if (field) {
      const text = clean(utf8.decode(value));
      if (!text) continue;
      if (field === 'year') tags.year ??= year(text);
      else if (field === 'genre') tags.genre ??= genreName(text);
      else if (field === 'title' || field === 'artist' || field === 'album' || field === 'albumArtist') tags[field] ??= text;
    } else if ((item.type === 'trkn' || item.type === 'disk') && value.length >= 4) {
      const n = u16(value, 2);
      if (n > 0) tags[item.type === 'trkn' ? 'track' : 'disc'] = n;
    } else if (item.type === 'gnre' && value.length >= 2) {
      tags.genre ??= GENRES[u16(value, 0) - 1];
    } else if (item.type === 'covr' && !tags.picture && value.length > 32) {
      tags.picture = { mime: kind === 14 ? 'image/png' : 'image/jpeg', data: value };
    }
  }
  return tags;
}

async function readMp4(src: Source): Promise<AudioTags> {
  let p = 0;
  for (let guard = 0; guard < 64 && p + 8 <= src.size; guard++) {
    const head = await src.slice(p, 16);
    if (head.length < 8) break;
    let size = u32(head, 0);
    const type = ascii(head, 4, 4);
    if (size === 1 && head.length >= 16) size = u32(head, 8) * 0x100000000 + u32(head, 12);
    else if (size === 0) size = src.size - p;
    if (size < 8) break;
    if (type === 'moov') {
      if (size > MAX_META) return {};
      return parseMoov(await src.slice(p, size));
    }
    p += size;
  }
  return {};
}

// ---------------------------------------------------------------------------
// WAV
// ---------------------------------------------------------------------------

async function readWav(src: Source): Promise<AudioTags> {
  const tags: AudioTags = {};
  let byteRate = 0;
  let dataSize = 0;
  let p = 12;
  for (let guard = 0; guard < 64 && p + 8 <= src.size; guard++) {
    const head = await src.slice(p, 8);
    if (head.length < 8) break;
    const id = ascii(head, 0, 4);
    const size = le32(head, 4);
    const body = p + 8;
    if (id === 'fmt ') {
      const fmt = await src.slice(body, Math.min(size, 16));
      byteRate = le32(fmt, 8);
    } else if (id === 'data') {
      dataSize = Math.min(size, src.size - body);
    } else if (id === 'LIST' && size < 1024 * 1024) {
      const list = await src.slice(body, size);
      if (ascii(list, 0, 4) === 'INFO') {
        let q = 4;
        while (q + 8 <= list.length) {
          const key = ascii(list, q, 4);
          const len = le32(list, q + 4);
          const raw = list.subarray(q + 8, q + 8 + len);
          const z = raw.indexOf(0);
          const value = clean(decodeSmart(z >= 0 ? raw.subarray(0, z) : raw));
          q += 8 + len + (len & 1);
          if (!value) continue;
          if (key === 'INAM') tags.title ??= value;
          else if (key === 'IART') tags.artist ??= value;
          else if (key === 'IPRD') tags.album ??= value;
          else if (key === 'ICRD') tags.year ??= year(value);
          else if (key === 'IGNR') tags.genre ??= genreName(value);
          else if (key === 'ITRK' || key === 'IPRT') tags.track ??= num(value);
        }
      }
    } else if ((id === 'id3 ' || id === 'ID3 ') && size < MAX_META) {
      merge(tags, parseId3v2(await src.slice(body, size)));
    }
    p = body + size + (size & 1);
  }
  if (byteRate > 0 && dataSize > 0) tags.duration = dataSize / byteRate;
  return tags;
}

// ---------------------------------------------------------------------------

export async function readTags(read: ReadFn, size: number): Promise<AudioTags> {
  if (size <= 0) return {};
  const src = new Source(read, size, await read(0, Math.min(size, HEAD)));
  const b = src.buf;
  const id3 = id3Size(b);
  if (id3 && ascii(b, id3, 4) === 'fLaC') return merge(await readFlac(src, id3), parseId3v2(b));
  if (id3 || mpegHeader(b, 0)) return readMp3(src);
  const magic = ascii(b, 0, 4);
  if (magic === 'fLaC') return readFlac(src, 0);
  if (magic === 'OggS') return readOgg(src);
  if (ascii(b, 4, 4) === 'ftyp') return readMp4(src);
  if (magic === 'RIFF' && ascii(b, 8, 4) === 'WAVE') return readWav(src);
  // MP3 с мусором в начале
  if (findFrame(b, 0)) return readMp3(src);
  return {};
}

/** Название и артист из имени файла: «01. Artist - Title.mp3». */
export function tagsFromFileName(path: string): { title: string; artist?: string; track?: number } {
  const name = path.split(/[\\/]/).pop() ?? path;
  let base = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  let track: number | undefined;
  const lead = /^(\d{1,3})(?:\s*[-.)]\s*|\s+)(.+)$/.exec(base);
  if (lead) {
    track = Number(lead[1]);
    base = lead[2];
  }
  const dash = /^(.+?)\s+[-–—]\s+(.+)$/.exec(base);
  if (dash) return { artist: dash[1].trim(), title: dash[2].trim(), track };
  return { title: base || name, track };
}
