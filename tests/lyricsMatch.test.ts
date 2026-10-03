import { describe, expect, test } from 'bun:test';
import { cleanTitle, retimeLrc, scoreCandidate, similarity, stripCredits, trackInfo, translit } from '../src/lib/lyricsMatch';

describe('trackInfo', () => {
  test('вынимает исполнителя из названия и чистит пометки', () => {
    const info = trackInfo({ artist: 'VSRAP', title: 'Скриптонит - Положение (prod. by Bob) [Free DL] 🔥' });
    expect(info.queries[0]).toEqual({ artist: 'Скриптонит', title: 'Положение' });
    expect(info.version).toBe(null);
  });
  test('распознаёт slowed и sped up', () => {
    expect(trackInfo({ artist: 'x', title: 'Song (slowed + reverb)' }).version).toBe('slowed');
    expect(trackInfo({ artist: 'x', title: 'Song - sped up' }).version).toBe('spedup');
    expect(trackInfo({ artist: 'x', title: 'Song nightcore' }).version).toBe('spedup');
    expect(cleanTitle('Song (slowed + reverb)')).toBe('Song');
    expect(cleanTitle('Song | Official Audio')).toBe('Song');
  });
});

describe('similarity', () => {
  test('транслитерация и регистр', () => {
    expect(translit('Скриптонит')).toBe('skriptonit');
    expect(similarity('Skriptonit', 'Скриптонит')).toBeGreaterThan(0.9);
    expect(similarity('Billie Jean', 'billie jean')).toBe(1);
    expect(similarity('Billie Jean', 'Beat It')).toBeLessThan(0.5);
  });
});

describe('scoreCandidate', () => {
  test('замедленная версия: растяжение по длительности', () => {
    const info = trackInfo({ artist: 'fan', title: 'Artist - Song (slowed)' });
    const r = scoreCandidate(info, 240, { artist: 'Artist', title: 'Song', duration: 200 });
    expect(r.tempo).toBeCloseTo(1.2, 2);
    expect(r.score).toBeGreaterThan(0.85);
  });
  test('чужой трек получает низкую оценку', () => {
    const info = trackInfo({ artist: 'Artist', title: 'Song' });
    const r = scoreCandidate(info, 200, { artist: 'Other', title: 'Different thing', duration: 320 });
    expect(r.score).toBeLessThan(0.45);
  });
});

describe('retimeLrc', () => {
  test('растягивает и сдвигает метки', () => {
    expect(retimeLrc('[00:10.00]a\n[01:00.00]b', 1.5, 0.5)).toBe('[00:15.50]a\n[01:30.50]b');
  });
  test('убирает служебные строки', () => {
    expect(stripCredits('[00:00.00] 作词 : X\n[00:05.00]line')).toBe('[00:05.00]line');
  });
});
