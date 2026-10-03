import { describe, expect, test } from 'bun:test';
import { bestMatch, matchScore, normalize, searchQuery, similarity } from '../src/lib/match';
import { BASELINE_SEED, SEED_PRESETS, hexToRgb, rgbToHex, rgbToLch, schemeFromSeed } from '../src/lib/material';
import { artworkSize, findClientId, mapTrack, rankTranscodings, scriptUrls } from '../src/lib/soundcloud';
import type { Track } from '../src/lib/types';

const T = (p: Partial<Track>): Track => ({
  id: Math.random().toString(36).slice(2),
  provider: 'youtube',
  title: '',
  artist: '',
  artistId: null,
  album: null,
  artwork: null,
  artworkSmall: null,
  duration: 0,
  permalink: null,
  genre: null,
  plays: null,
  likes: null,
  streamable: true,
  previewOnly: false,
  ...p,
});

// ---------------- умная подмена ----------------
describe('match', () => {
  test('normalize убирает мусор, но сохраняет версии', () => {
    expect(normalize('Billie Jean (Official Video) [HD]')).toBe('billie jean');
    expect(normalize('Кукла колдуна (Remix)')).toContain('remix');
    expect(normalize('Ёлка feat. Кто-то')).toBe('елка');
    expect(normalize('Artist feat. Jay-Z - Song')).toBe('artist song');
    expect(normalize('Кукушка (клип, премьера 2024)')).toBe('кукушка');
  });

  test('кириллические версии («кавер», «ремикс») штрафуются', () => {
    const want = T({ title: 'Кукушка', artist: 'Кино', duration: 400 });
    const cover = matchScore(want, T({ title: 'Кукушка кавер', artist: 'Кино', duration: 400 }));
    const orig = matchScore(want, T({ title: 'Кукушка', artist: 'Кино', duration: 401 }));
    expect(orig - cover).toBeGreaterThan(0.25);
  });

  test('similarity: одинаковые = 1, разные = 0', () => {
    expect(similarity('Billie Jean', 'billie jean')).toBe(1);
    expect(similarity('Billie Jean', 'Beat It')).toBe(0);
  });

  test('находит «Billie Jean» среди заливок SoundCloud', () => {
    const want = T({ provider: 'soundcloud', title: 'Billie Jean', artist: 'Michael Jackson', duration: 294, previewOnly: true });
    const cands = [
      T({ title: 'Billie Jean (Cover)', artist: 'Some Guy', duration: 290 }),
      T({ title: 'Billie Jean (Slowed + Reverb)', artist: 'Michael Jackson', duration: 360 }),
      T({ title: 'Beat It', artist: 'Michael Jackson', duration: 258 }),
      T({ id: 'good', title: 'Billie Jean', artist: 'Michael Jackson', duration: 294 }),
    ];
    expect(bestMatch(want, cands)?.id).toBe('good');
  });

  test('формат «Артист - Название» от загрузчика', () => {
    const want = T({ title: 'Кукла колдуна', artist: 'Король и Шут', duration: 204 });
    const cands = [
      T({ provider: 'soundcloud', id: 'sc', title: 'Король и Шут - Кукла колдуна', artist: 'user59201', duration: 205 }),
      T({ provider: 'soundcloud', title: 'Король и Шут - Лесник', artist: 'user59201', duration: 190 }),
    ];
    expect(bestMatch(want, cands)?.id).toBe('sc');
  });

  test('не подменяет другой песней и превью', () => {
    const want = T({ title: 'Billie Jean', artist: 'Michael Jackson', duration: 294 });
    expect(bestMatch(want, [T({ title: 'Beat It', artist: 'Michael Jackson', duration: 258 })])).toBeNull();
    expect(bestMatch(want, [T({ title: 'Billie Jean', artist: 'Michael Jackson', duration: 294, previewOnly: true })])).toBeNull();
  });

  test('ремикс проигрывает оригиналу', () => {
    const want = T({ title: 'Последний герой', artist: 'Кино', duration: 250 });
    const remix = matchScore(want, T({ title: 'Последний герой (Remix)', artist: 'Кино', duration: 250 }));
    const orig = matchScore(want, T({ title: 'Последний герой', artist: 'Кино', duration: 252 }));
    expect(orig).toBeGreaterThan(remix + 0.2);
  });

  test('searchQuery', () => {
    expect(searchQuery({ title: 'Billie Jean (Official Video)', artist: 'Michael Jackson' })).toBe('michael jackson billie jean');
    expect(searchQuery({ title: 'Кино - Кукушка', artist: 'Кино' })).toBe('кино кукушка');
  });
});

// ---------------- Material You ----------------
const lum = (hex: string) => {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

describe('material', () => {
  test('hex ⇄ rgb', () => {
    expect(rgbToHex(hexToRgb(BASELINE_SEED))).toBe(BASELINE_SEED);
    expect(hexToRgb('#fff')).toEqual([255, 255, 255]);
  });

  const seeds = [...SEED_PRESETS.map((p) => p.color), '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#111111', '#f5f5f5', '#ff5500'];
  for (const seed of seeds) {
    for (const dark of [true, false]) {
      test(`контраст ролей ${seed} ${dark ? 'dark' : 'light'}`, () => {
        const s = schemeFromSeed(seed, dark);
        for (const v of Object.values(s)) expect(v).toMatch(/^#[0-9a-f]{6}$/);
        expect(contrast(s.primary, s['on-primary'])).toBeGreaterThanOrEqual(4.5);
        expect(contrast(s['primary-container'], s['on-primary-container'])).toBeGreaterThanOrEqual(4.5);
        expect(contrast(s['secondary-container'], s['on-secondary-container'])).toBeGreaterThanOrEqual(4.5);
        expect(contrast(s.surface, s['on-surface'])).toBeGreaterThanOrEqual(7);
        expect(contrast(s['surface-container-high'], s['on-surface-variant'])).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  test('оттенок primary следует за сидом', () => {
    for (const seed of ['#0061a4', '#a73a37', '#386a20']) {
      const h0 = rgbToLch(hexToRgb(seed))[2];
      const h1 = rgbToLch(hexToRgb(schemeFromSeed(seed, false).primary))[2];
      const d = Math.min(Math.abs(h0 - h1), 360 - Math.abs(h0 - h1));
      expect(d).toBeLessThan(12);
    }
  });
});

// ---------------- SoundCloud без ключей ----------------
describe('soundcloud', () => {
  const ID = 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6';
  test('client_id из бандла', () => {
    expect(findClientId(`...{client_id:"${ID}",env:"production"}...`)).toBe(ID);
    expect(findClientId(`fetch("https://api-v2.soundcloud.com/x?client_id=${ID}&app_version=1")`)).toBe(ID);
    expect(findClientId('client_id:"short"')).toBeNull();
  });

  test('scriptUrls: только бандлы sndcdn', () => {
    const html = `<script crossorigin src="https://a-v2.sndcdn.com/assets/0-abc.js"></script>
      <script src="//a-v2.sndcdn.com/assets/49-def.js"></script><script src="https://evil.com/x.js"></script>`;
    expect(scriptUrls(html)).toEqual(['https://a-v2.sndcdn.com/assets/0-abc.js', 'https://a-v2.sndcdn.com/assets/49-def.js']);
  });

  test('выбор транскодинга', () => {
    const list = [
      { url: 'opus', format: { protocol: 'hls', mime_type: 'audio/ogg; codecs="opus"' } },
      { url: 'mp3p', format: { protocol: 'progressive', mime_type: 'audio/mpeg' } },
      { url: 'enc', format: { protocol: 'ctr-encrypted-hls', mime_type: 'audio/mp4; codecs="mp4a.40.2"' } },
      { url: 'abr', preset: 'abr_sq', format: { protocol: 'hls', mime_type: 'audio/mp4; codecs="mp4a.40.2"' } },
      { url: 'aach', format: { protocol: 'hls', mime_type: 'audio/mp4; codecs="mp4a.40.2"' } },
      { url: 'snip', snipped: true, format: { protocol: 'progressive', mime_type: 'audio/mpeg' } },
    ];
    expect(rankTranscodings(list).map((t) => t.url)).toEqual(['aach', 'mp3p', 'opus', 'snip']);
  });

  test('mapTrack: превью Go+ и артист из publisher_metadata', () => {
    const t = mapTrack({
      id: 1,
      title: 'Billie Jean',
      duration: 30000,
      full_duration: 294000,
      policy: 'SNIP',
      artwork_url: 'https://i1.sndcdn.com/artworks-xyz-large.jpg',
      user: { id: 7, username: 'michaeljackson' },
      publisher_metadata: { artist: 'Michael Jackson' },
      media: { transcodings: [{ url: 'u', snipped: true, format: { protocol: 'hls', mime_type: 'audio/mpeg' } }] },
    });
    expect(t?.previewOnly).toBe(true);
    expect(t?.duration).toBe(294);
    expect(t?.artist).toBe('Michael Jackson');
    expect(t?.artwork).toBe('https://i1.sndcdn.com/artworks-xyz-t500x500.jpg');
  });

  test('artworkSize', () => {
    expect(artworkSize('https://i1.sndcdn.com/avatars-1-large.jpg', 't300x300')).toBe('https://i1.sndcdn.com/avatars-1-t300x300.jpg');
    expect(artworkSize(null, 'large')).toBeNull();
  });
});
