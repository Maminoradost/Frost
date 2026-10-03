import { describe, expect, test } from 'bun:test';
import { hctFromHex, hexToRgb, ratioOfTones, schemeFromSeed, SCHEME_STYLES } from '../src/lib/material';

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const near = (a: string, b: string, tol = 2) => hexToRgb(a).every((c, i) => Math.abs(c - hexToRgb(b)[i]) <= tol);

describe('Material You: HCT и динамические схемы', () => {
  test('базовая схема M3 из #6750A4 совпадает с эталоном Google', () => {
    const l = schemeFromSeed('#6750a4', false);
    expect(near(l.primary, '#65558f')).toBe(true);
    expect(near(l['primary-container'], '#eaddff')).toBe(true);
    expect(near(l.secondary, '#625b71')).toBe(true);
    expect(near(l.tertiary, '#7d5260')).toBe(true);
    expect(near(l['tertiary-container'], '#ffd8e4')).toBe(true);
    const d = schemeFromSeed('#6750a4', true);
    expect(near(d.surface, '#141218')).toBe(true);
    expect(near(d.primary, '#d0bcff')).toBe(true);
  });

  test('синий сид: как в тестах material-color-utilities', () => {
    expect(near(schemeFromSeed('#0000ff', false).primary, '#555992')).toBe(true);
    expect(near(schemeFromSeed('#0000ff', true).primary, '#bec2ff')).toBe(true);
  });

  test('CAM16/HCT: эталонные значения material-color-utilities', () => {
    const red = hctFromHex('#ff0000');
    expect(red[0]).toBeCloseTo(27.41, 1);
    expect(red[1]).toBeCloseTo(113.36, 0);
    const blue = hctFromHex('#0000ff');
    expect(blue[0]).toBeCloseTo(282.79, 1);
    expect(blue[1]).toBeCloseTo(87.23, 0);
    const green = hctFromHex('#00ff00');
    expect(green[0]).toBeCloseTo(142.14, 1);
    expect(Math.round(hctFromHex('#6750a4')[2])).toBe(40);
    expect(Math.round(ratioOfTones(100, 0))).toBe(21);
  });

  test('все 9 стилей и 3 уровня контраста читаемы', () => {
    for (const { id } of SCHEME_STYLES) {
      for (const dark of [false, true]) {
        for (const level of ['standard', 'medium', 'high'] as const) {
          const s = schemeFromSeed('#d0643c', dark, id, level);
          // Акцент на фоне: кривая контраста 4.5 / 7 / 11.
          const accent = level === 'standard' ? 4.4 : level === 'medium' ? 6.8 : 10.5;
          expect(contrast(s.primary, s['on-primary'])).toBeGreaterThan(accent);
          expect(contrast(s.surface, s['on-surface'])).toBeGreaterThan(Math.max(7, accent));
          // Контейнеры при повышенном контрасте темнеют (светлая тема), текст на них остаётся читаемым.
          expect(contrast(s['primary-container'], s['on-primary-container'])).toBeGreaterThan(4.4);
          expect(contrast(s['secondary-container'], s['on-secondary-container'])).toBeGreaterThan(4.4);
        }
      }
    }
  });

  test('высокий контраст усиливает вторичный текст', () => {
    const std = schemeFromSeed('#0061a4', false, 'tonalSpot', 'standard');
    const high = schemeFromSeed('#0061a4', false, 'tonalSpot', 'high');
    expect(contrast(high['surface-container-high'], high['on-surface-variant'])).toBeGreaterThan(
      contrast(std['surface-container-high'], std['on-surface-variant']),
    );
  });

  test('стили различаются по смыслу', () => {
    const chroma = (hex: string) => hctFromHex(hex)[1];
    const seed = '#0061a4';
    expect(chroma(schemeFromSeed(seed, true, 'vibrant').primary)).toBeGreaterThan(chroma(schemeFromSeed(seed, true, 'tonalSpot').primary));
    const mono = schemeFromSeed(seed, true, 'monochrome');
    const [r, g, b] = hexToRgb(mono['secondary-container']);
    expect(r === g && g === b).toBe(true);
    const rainbow = schemeFromSeed(seed, true, 'rainbow');
    const [sr, sg, sb] = hexToRgb(rainbow.surface);
    expect(sr === sg && sg === sb).toBe(true);
    const fidelity = schemeFromSeed('#ff0000', false, 'fidelity');
    expect(chroma(fidelity['primary-container'])).toBeGreaterThan(60);
    const expressive = schemeFromSeed(seed, false, 'expressive');
    expect(Math.abs(hctFromHex(expressive.primary)[0] - hctFromHex(seed)[0])).toBeGreaterThan(30);
  });
});
