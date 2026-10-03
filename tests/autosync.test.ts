import { describe, expect, test } from 'bun:test';
import { alignLines, buildLrc, HOP, syllables, voicedSegments } from '../src/lib/autosync';

function fakeEnvelope(parts: [number, number][], duration: number) {
  const env = new Float32Array(Math.round(duration / HOP));
  for (const [a, b] of parts) for (let i = Math.round(a / HOP); i < Math.round(b / HOP); i += 1) env[i] = 1;
  for (let i = 0; i < env.length; i += 1) env[i] += 0.02;
  return { env, hop: HOP, duration };
}

describe('autosync', () => {
  test('слоги', () => {
    expect(syllables('Привет, как дела')).toBe(5);
    expect(syllables('hello world')).toBe(3);
    expect(syllables('   ')).toBe(0);
  });
  test('находит участки голоса и раскладывает строки', () => {
    const e = fakeEnvelope([[10, 20], [30, 40]], 60);
    const segs = voicedSegments(e);
    expect(segs.length).toBe(2);
    expect(segs[0].start).toBeCloseTo(10, 0);
    const lines = ['раз два три', 'четыре пять', 'шесть семь', 'восемь девять'];
    const t = alignLines(lines, segs, 60);
    expect(t[0]).toBeCloseTo(10, 0);
    expect(t[2]).toBeCloseTo(30, 0);
    for (let i = 1; i < t.length; i += 1) expect(t[i]).toBeGreaterThan(t[i - 1]);
    expect(buildLrc(['a', '', 'b'], [1, 2, 3])).toBe('[00:01.00]a\n[00:03.00]b');
  });
  test('без голоса: равномерно', () => {
    const t = alignLines(['a', 'b', 'c'], [], 100);
    expect(t[0]).toBeGreaterThan(0);
    expect(t[2]).toBeLessThan(100);
  });
});
