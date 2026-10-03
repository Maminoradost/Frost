import { describe, expect, test } from 'bun:test';
import { activeLineIndex, estimateWords, parseLrc, syncableLines, timedLrc, wordProgress } from '../src/lib/lrc';
import { yrcToLrc } from '../src/lib/lyricsMatch';

describe('LRC: пословная разметка и ручная синхронизация', () => {
  test('Enhanced LRC: слова с метками', () => {
    const [line] = parseLrc('[00:10.00]<00:10.00>Hello <00:10.50>dear <00:11.20>world<00:12.00>');
    expect(line.text).toBe('Hello dear world');
    expect(line.words?.map((w) => w.text.trim())).toEqual(['Hello', 'dear', 'world']);
    expect(line.words?.[2].end).toBeCloseTo(12, 2);
    expect(wordProgress(line.words![1], 10.85)).toBeCloseTo(0.5, 1);
  });

  test('повтор строки сдвигает и пословные метки', () => {
    const lines = parseLrc('[00:05.00][01:05.00]<00:05.00>la <00:05.50>la');
    expect(lines).toHaveLength(2);
    expect(lines[1].words?.[1].time).toBeCloseTo(65.5, 2);
  });

  test('NetEase YRC → Enhanced LRC', () => {
    const yrc = [
      '{"t":0,"c":[{"tx":"作词: "}]}',
      '[1000,2000](1000,500,0)One (1500,500,0)two',
      '[4000,1500](4000,700,0)three (4700,800,0)four',
      '[7000,1000](7000,1000,0)five',
    ].join('\n');
    const lrc = yrcToLrc(yrc)!;
    const lines = parseLrc(lrc);
    expect(lines.map((l) => l.text)).toEqual(['One two', 'three four', 'five']);
    expect(lines[1].words?.[1].time).toBeCloseTo(4.7, 2);
    expect(lines[1].words?.[1].end).toBeCloseTo(5.5, 2);
  });

  test('оценка слов без разметки укладывается в промежуток', () => {
    const lines = parseLrc('[00:01.00]раз два три\n[00:02.50]дальше');
    const words = estimateWords(lines[0], lines[1]);
    expect(words).toHaveLength(3);
    expect(words[0].time).toBeCloseTo(1, 3);
    expect(words[2].end).toBeLessThanOrEqual(2.5);
  });

  test('строки для синхронизации без пометок разделов', () => {
    expect(syncableLines('[Припев]\nПервая строка\n\n(Chorus)\nВторая')).toEqual(['Первая строка', 'Вторая']);
  });

  test('ручные метки → LRC', () => {
    const lrc = timedLrc(['a', 'b', 'c'], [1.234, 62.5]);
    expect(lrc).toBe('[00:01.23]a\n[01:02.50]b');
    const lines = parseLrc(lrc);
    expect(activeLineIndex(lines, 63)).toBe(1);
  });
});
