import { describe, expect, test } from 'bun:test';
import { clip, discordActivity } from '../src/lib/discord';
import { decodeCp1251, decodeTextFile, looksCyrillic1251 } from '../src/lib/encoding';
import { parseCSV, parseM3U, parsePlaylistFile, parseText, playlistNameFromFile, splitArtistTitle } from '../src/lib/importer';
import { genreName, readTags, tagsFromFileName } from '../src/lib/tags';
import type { Track } from '../src/lib/types';
import { computeWrapped, countsAsPlay, listenerType, periodRange, primaryArtist } from '../src/lib/wrapped';

// ---------- помощники ----------

const enc = new TextEncoder();
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const syncsafe = (n: number) => [(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127];
/** Кириллица → Windows-1251 (для тестов хватает А–я, Ё и ё). */
const cp1251 = (s: string) =>
  Array.from(s, (c) => {
    const code = c.charCodeAt(0);
    if (code < 128) return code;
    if (c === 'Ё') return 0xa8;
    if (c === 'ё') return 0xb8;
    return code - 0x410 + 0xc0;
  });

function reader(bytes: number[] | Uint8Array) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return { read: async (start: number, length: number) => buf.slice(start, Math.min(buf.length, start + length)), size: buf.length };
}

function id3Frame(id: string, body: number[]) {
  return [...ascii(id), ...be32(body.length), 0, 0, ...body];
}

function mpegFrames(frames: number) {
  // MPEG-1 Layer III, 128 кбит/с, 44100 Гц, стерео: кадр 417 байт; в первом заголовок Xing
  const frame = new Array(417).fill(0);
  frame.splice(0, 4, 0xff, 0xfb, 0x90, 0x00);
  frame.splice(36, 12, ...ascii('Xing'), ...be32(1), ...be32(frames));
  const second = new Array(417).fill(0);
  second.splice(0, 4, 0xff, 0xfb, 0x90, 0x00);
  return [...frame, ...second];
}

const track = (id: string, artist: string, duration = 200, title = `Трек ${id}`): Track => ({
  id,
  provider: 'youtube',
  title,
  artist,
  artistId: null,
  album: null,
  artwork: null,
  artworkSmall: null,
  duration,
  permalink: null,
  genre: null,
  plays: null,
  likes: null,
  streamable: true,
  previewOnly: false,
});

// ---------- теги ----------

describe('теги', () => {
  test('ID3v2.3: UTF-16, Windows-1251, номер трека, обложка и длительность по Xing', async () => {
    const picture = new Array(64).fill(7);
    const frames = [
      ...id3Frame('TIT2', [1, 0xff, 0xfe, ...Array.from('Звезда', (c) => [c.charCodeAt(0) & 255, c.charCodeAt(0) >> 8]).flat()]),
      ...id3Frame('TPE1', [0, ...cp1251('Кино')]),
      ...id3Frame('TALB', [3, ...enc.encode('Группа крови')]),
      ...id3Frame('TRCK', [0, ...ascii('3/12')]),
      ...id3Frame('TCON', [0, ...ascii('(17)')]),
      ...id3Frame('APIC', [0, ...ascii('image/jpeg'), 0, 3, 0, ...picture]),
    ];
    const tag = [...ascii('ID3'), 3, 0, 0, ...syncsafe(frames.length + 16), ...frames, ...new Array(16).fill(0)];
    const { read, size } = reader([...tag, ...mpegFrames(1000)]);
    const t = await readTags(read, size);
    expect(t.title).toBe('Звезда');
    expect(t.artist).toBe('Кино');
    expect(t.album).toBe('Группа крови');
    expect(t.track).toBe(3);
    expect(t.genre).toBe('Rock');
    expect(t.picture?.mime).toBe('image/jpeg');
    expect(t.picture?.data.length).toBe(64);
    expect(t.duration).toBeCloseTo((1000 * 1152) / 44100, 2);
  });

  test('ID3v1 в конце файла', async () => {
    const pad = (b: number[], n: number) => [...b, ...new Array(n).fill(0)].slice(0, n);
    const v1 = [...ascii('TAG'), ...pad(cp1251('Восьмиклассница'), 30), ...pad(cp1251('Кино'), 30), ...pad(ascii('Album'), 30), ...ascii('1986'), ...pad([], 28), 0, 5, 17];
    const { read, size } = reader([...mpegFrames(100), ...v1]);
    const t = await readTags(read, size);
    expect(t.title).toBe('Восьмиклассница');
    expect(t.artist).toBe('Кино');
    expect(t.year).toBe(1986);
    expect(t.track).toBe(5);
  });

  test('FLAC: STREAMINFO и Vorbis comment', async () => {
    const info = [0x10, 0, 0x10, 0, 0, 0, 0, 0, 0, 0, 0x0a, 0xc4, 0x42, 0xf0, ...be32(441000), ...new Array(16).fill(0)];
    const comments = (list: string[]) => {
      const vendor = enc.encode('test');
      const out = [...le32(vendor.length), ...vendor, ...le32(list.length)];
      for (const c of list) {
        const b = enc.encode(c);
        out.push(...le32(b.length), ...b);
      }
      return out;
    };
    const vc = comments(['TITLE=Кукушка', 'ARTIST=Кино', 'ALBUM=Чёрный альбом', 'TRACKNUMBER=2', 'DATE=1990-01-01']);
    const bytes = [...ascii('fLaC'), 0, 0, 0, 34, ...info, 0x84, (vc.length >> 16) & 255, (vc.length >> 8) & 255, vc.length & 255, ...vc];
    const { read, size } = reader(bytes);
    const t = await readTags(read, size);
    expect(t.title).toBe('Кукушка');
    expect(t.album).toBe('Чёрный альбом');
    expect(t.track).toBe(2);
    expect(t.year).toBe(1990);
    expect(t.duration).toBeCloseTo(10, 3);
  });

  test('M4A: moov после mdat', async () => {
    const atom = (type: string, body: number[]) => [...be32(body.length + 8), ...ascii(type), ...body];
    const data = (kind: number, body: number[]) => atom('data', [0, 0, 0, kind, 0, 0, 0, 0, ...body]);
    const mvhd = atom('mvhd', [0, 0, 0, 0, ...be32(0), ...be32(0), ...be32(1000), ...be32(5000), ...new Array(80).fill(0)]);
    const ilst = atom('ilst', [
      ...atom('\u00a9nam', data(1, [...enc.encode('Песня')])),
      ...atom('\u00a9ART', data(1, [...enc.encode('Артист')])),
      ...atom('trkn', data(0, [0, 0, 0, 4, 0, 10, 0, 0])),
    ]);
    const meta = atom('meta', [0, 0, 0, 0, ...atom('hdlr', new Array(25).fill(0)), ...ilst]);
    const moov = atom('moov', [...mvhd, ...atom('udta', meta)]);
    const bytes = [...atom('ftyp', ascii('M4A \0\0\0\0')), ...atom('mdat', new Array(5000).fill(1)), ...moov];
    const { read, size } = reader(bytes);
    const t = await readTags(read, size);
    expect(t.title).toBe('Песня');
    expect(t.artist).toBe('Артист');
    expect(t.track).toBe(4);
    expect(t.duration).toBe(5);
  });

  test('WAV: LIST INFO и длительность', async () => {
    const info = [...ascii('INFO'), ...ascii('INAM'), ...le32(6), ...ascii('Title'), 0, ...ascii('IART'), ...le32(4), ...cp1251('Кин'), 0];
    const fmt = [1, 0, 2, 0, ...le32(44100), ...le32(176400), 4, 0, 16, 0];
    const body = [...ascii('WAVE'), ...ascii('fmt '), ...le32(16), ...fmt, ...ascii('LIST'), ...le32(info.length), ...info, ...ascii('data'), ...le32(352800)];
    const bytes = new Uint8Array(8 + body.length + 352800);
    bytes.set([...ascii('RIFF'), ...le32(body.length + 352800), ...body]);
    const { read, size } = reader(bytes);
    const t = await readTags(read, size);
    expect(t.title).toBe('Title');
    expect(t.artist).toBe('Кин');
    expect(t.duration).toBeCloseTo(2, 3);
  });

  test('имя файла и жанры', () => {
    expect(tagsFromFileName('D:\\Music\\01. Кино - Группа крови.mp3')).toEqual({ artist: 'Кино', title: 'Группа крови', track: 1 });
    expect(tagsFromFileName('/music/track_name.flac').title).toBe('track name');
    expect(genreName('(13)')).toBe('Pop');
    expect(genreName('17')).toBe('Rock');
    expect(genreName('(17)Русский рок')).toBe('Русский рок');
  });
});

// ---------- кодировки ----------

describe('кодировки', () => {
  test('Windows-1251', () => {
    expect(decodeCp1251(new Uint8Array(cp1251('Привет, Ёжик')))).toBe('Привет, Ёжик');
    expect(looksCyrillic1251(new Uint8Array(cp1251('Кино')))).toBe(true);
    expect(looksCyrillic1251(new Uint8Array(ascii('Café del Mar')))).toBe(false);
  });

  test('текстовые файлы: BOM, UTF-8 и 1251', () => {
    expect(decodeTextFile(new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode('Ура')]))).toBe('Ура');
    expect(decodeTextFile(enc.encode('Звезда'))).toBe('Звезда');
    expect(decodeTextFile(new Uint8Array(cp1251('Звезда')))).toBe('Звезда');
  });
});

// ---------- импорт ----------

describe('импорт плейлистов', () => {
  test('M3U с EXTINF и без', () => {
    const items = parseM3U('#EXTM3U\n#EXTINF:215,Кино - Звезда по имени Солнце\nD:\\Music\\kino.mp3\n\nC:/Music/02 - Сплин - Выхода нет.flac\n');
    expect(items[0]).toEqual({ title: 'Звезда по имени Солнце', artist: 'Кино', duration: 215, path: 'D:\\Music\\kino.mp3' });
    expect(items[1].artist).toBe('Сплин');
    expect(items[1].title).toBe('Выхода нет');
  });

  test('CSV из Exportify', () => {
    const csv =
      '"Track URI","Track Name","Artist URI(s)","Artist Name(s)","Album Name","Track Duration (ms)"\n' +
      '"spotify:track:1","Numb","x","Linkin Park","Meteora","185586"\n' +
      '"spotify:track:2","Hey, Soul Sister","y","Train","Save Me, San Francisco","216773"\n';
    const items = parseCSV(csv);
    expect(items).toHaveLength(2);
    expect(items[1]).toEqual({ title: 'Hey, Soul Sister', artist: 'Train', duration: 216.773 });
  });

  test('CSV с точкой с запятой в Windows-1251', () => {
    const bytes = new Uint8Array(cp1251('Исполнитель;Название\r\nКино;Пачка сигарет\r\nДДТ;Осень\r\n'));
    const items = parsePlaylistFile('мой.csv', bytes);
    expect(items).toEqual([
      { title: 'Пачка сигарет', artist: 'Кино', duration: undefined },
      { title: 'Осень', artist: 'ДДТ', duration: undefined },
    ]);
  });

  test('простой текст', () => {
    expect(parseText('1. Кино - Кукушка\n\n2) Ария — Беспечный ангел\nБез артиста')).toEqual([
      { artist: 'Кино', title: 'Кукушка' },
      { artist: 'Ария', title: 'Беспечный ангел' },
      { artist: '', title: 'Без артиста' },
    ]);
    expect(splitArtistTitle('AC-DC')).toBeNull();
    expect(playlistNameFromFile('Мой_плейлист.m3u8')).toBe('Мой плейлист');
  });
});

// ---------- итоги ----------

describe('итоги', () => {
  const tracks = {
    'youtube:a': track('a', 'Кино'),
    'youtube:b': track('b', 'Кино feat. Гребенщиков'),
    'youtube:c': track('c', 'Сплин - Topic'),
  };
  const day = (d: number, h = 12) => new Date(2026, 0, d, h).getTime();

  test('основной артист и засчитывание', () => {
    expect(primaryArtist('Кино feat. Гребенщиков')).toBe('Кино');
    expect(primaryArtist('A, B & C')).toBe('A');
    expect(primaryArtist('Сплин - Topic')).toBe('Сплин');
    expect(countsAsPlay(31, 200)).toBe(true);
    expect(countsAsPlay(20, 200)).toBe(false);
    expect(countsAsPlay(12, 20)).toBe(true);
  });

  test('статистика за период', () => {
    const entries: [string, number, number][] = [
      ['youtube:a', day(1), 200],
      ['youtube:a', day(2), 200],
      ['youtube:b', day(3, 23), 100],
      ['youtube:c', day(5), 10],
      ['youtube:c', new Date(2025, 5, 1).getTime(), 200],
    ];
    const s = computeWrapped(entries, tracks, { from: new Date(2026, 0, 1).getTime(), to: new Date(2027, 0, 1).getTime() });
    expect(s.seconds).toBe(510);
    expect(s.plays).toBe(3);
    expect(s.tracks).toBe(3);
    expect(s.artists).toBe(2);
    expect(s.days).toBe(4);
    expect(s.streak).toBe(3);
    expect(s.topTracks[0].track.id).toBe('a');
    expect(s.topTracks[0].plays).toBe(2);
    expect(s.topArtists[0].name).toBe('Кино');
    expect(s.topArtists[0].seconds).toBe(500);
    expect(s.byHour.reduce((a, b) => a + b, 0)).toBe(510);
    expect(s.byHour[23]).toBe(100);
    expect(s.discovered).toBe(2);
  });

  test('периоды и тип слушателя', () => {
    const now = new Date(2026, 9, 3);
    expect(periodRange('year', now).from).toBe(new Date(2026, 0, 1).getTime());
    expect(periodRange('last-year', now)).toEqual({ from: new Date(2025, 0, 1).getTime(), to: new Date(2026, 0, 1).getTime() });
    const hours = new Array(24).fill(0);
    hours[1] = 5000;
    expect(listenerType(hours)?.title).toBe('Ночная сова');
    expect(listenerType(new Array(24).fill(1))).toBeNull();
  });
});

// ---------- Discord ----------

describe('Discord', () => {
  test('строки от 2 до 128 символов', () => {
    expect(clip('A')).toHaveLength(2);
    expect(clip('x'.repeat(200))).toHaveLength(128);
  });

  test('активность', () => {
    const t = { ...track('a', 'Кино - Topic', 240, 'Звезда'), artwork: 'https://i.ytimg.com/a.jpg', permalink: 'https://music.youtube.com/watch?v=a' };
    const a = discordActivity(t, 1_000_000, 240);
    expect(a.type).toBe(2);
    expect(a.details).toBe('Звезда');
    expect(a.state).toBe('Кино');
    expect(a.timestamps).toEqual({ start: 1_000_000, end: 1_240_000 });
    expect((a.assets as { large_image: string }).large_image).toBe('https://i.ytimg.com/a.jpg');
    expect(a.buttons).toHaveLength(1);
    const local = discordActivity({ ...t, artwork: 'http://asset.localhost/x.jpg', permalink: null }, 0, 0);
    expect(local.assets).toBeUndefined();
    expect(local.buttons).toBeUndefined();
  });
});
