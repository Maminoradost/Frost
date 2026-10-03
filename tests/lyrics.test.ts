import { describe, expect, test } from 'bun:test';
import { extractLyrics, extractLyricsFromHtml, parseSearch, pickHit, type GeniusHit } from '../src/lib/genius';
import { cleanTitle, lyricsCandidates } from '../src/lib/lyrics';
import { isNewer } from '../src/lib/version';
import { sleepLeft } from '../src/store/sleep';

const song = (title: string, artist: string, url: string, extra: Record<string, unknown> = {}) => ({
  type: 'song',
  result: { title, url, primary_artist: { name: artist }, ...extra },
});

describe('genius: поиск', () => {
  test('новый формат с sections: дубли, не-песни и чужие ссылки отбрасываются', () => {
    const json = {
      response: {
        sections: [
          { type: 'top_hit', hits: [song('Billie Jean', 'Michael Jackson', 'https://genius.com/Michael-jackson-billie-jean-lyrics')] },
          {
            type: 'song',
            hits: [
              song('Billie Jean', 'Michael Jackson', 'https://genius.com/Michael-jackson-billie-jean-lyrics'),
              { type: 'artist', result: { name: 'Michael Jackson', url: 'https://genius.com/artists/Michael-jackson' } },
              song('Billie Jean', 'Spam', 'https://evil.example/billie-jean'),
              song('Billie Jean (Instrumental)', 'Michael Jackson', 'https://genius.com/Michael-jackson-billie-jean-instrumental-lyrics', {
                instrumental: true,
              }),
            ],
          },
        ],
      },
    };
    const hits = parseSearch(json);
    expect(hits.map((h) => h.url)).toEqual([
      'https://genius.com/Michael-jackson-billie-jean-lyrics',
      'https://genius.com/Michael-jackson-billie-jean-instrumental-lyrics',
    ]);
    expect(hits[0]).toEqual({
      title: 'Billie Jean',
      artist: 'Michael Jackson',
      url: 'https://genius.com/Michael-jackson-billie-jean-lyrics',
      instrumental: false,
    });
    expect(hits[1].instrumental).toBe(true);
  });

  test('старый формат с hits и artist_names', () => {
    const json = {
      response: {
        hits: [{ type: 'song', result: { title: 'Группа крови', artist_names: 'Кино', url: 'https://genius.com/Kino-gruppa-krovi-lyrics' } }],
      },
    };
    expect(parseSearch(json)).toEqual([
      { title: 'Группа крови', artist: 'Кино', url: 'https://genius.com/Kino-gruppa-krovi-lyrics', instrumental: false },
    ]);
  });

  test('мусор на входе: пустой список', () => {
    expect(parseSearch(null)).toEqual([]);
    expect(parseSearch({})).toEqual([]);
    expect(parseSearch({ response: { sections: 'нет' } })).toEqual([]);
    expect(parseSearch('<html>')).toEqual([]);
  });
});

describe('genius: выбор результата', () => {
  const hits: GeniusHit[] = [
    { title: 'Группа крови (English Translation)', artist: 'Genius English Translations', url: 'https://genius.com/a', instrumental: false },
    { title: 'Звезда по имени Солнце', artist: 'Кино', url: 'https://genius.com/b', instrumental: false },
    { title: 'Группа крови', artist: 'Кино', url: 'https://genius.com/c', instrumental: false },
  ];

  test('берёт оригинал, а не перевод Genius', () => {
    expect(pickHit(hits, { artist: 'Кино', title: 'Группа крови' })?.url).toBe('https://genius.com/c');
  });

  test('чужой исполнитель или другое название: ничего', () => {
    expect(pickHit(hits, { artist: 'Metallica', title: 'Группа крови' })).toBeNull();
    expect(pickHit(hits, { artist: 'Кино', title: 'Кукушка' })).toBeNull();
    expect(pickHit([], { artist: 'Кино', title: 'Группа крови' })).toBeNull();
  });

  test('исполнитель прямо в названии (заливки лейблов)', () => {
    const labelHits: GeniusHit[] = [{ title: 'Скриптонит - Положение', artist: 'VSRAP', url: 'https://genius.com/d', instrumental: false }];
    expect(pickHit(labelHits, { artist: 'Скриптонит', title: 'Скриптонит - Положение' })?.url).toBe('https://genius.com/d');
  });
});

describe('genius: разбор страницы', () => {
  const page = `<!doctype html><html><head><title>Кино – Группа крови</title></head><body>
    <div class="Header">Кино – Группа крови</div>
    <div data-lyrics-container="true" class="Lyrics__Container-sc-1">
      <div data-exclude-from-selection="true" class="LyricsHeader"><div><span>12 Contributors</span></div><h2>Группа крови Lyrics</h2></div>[Куплет 1]<br/>Тёплое место, но улицы ждут<br>Отпечатков наших ног<br/><a href="/123" class="ReferentFragment"><span>Звёздная пыль</span></a> на сапогах &amp; мягкое кресло<br/>
    </div>
    <div class="RightSidebar">Реклама</div>
    <div data-lyrics-container="true" class="Lyrics__Container-sc-1">[Припев]<br/>Группа крови на рукаве,<br/><i>Мой порядковый номер</i> на рукаве<br/>Пожелай мне удачи в бою, пожелай мне&#x2026;<br/>Не остаться в этой траве</div>
  </body></html>`;

  const expected = [
    '[Куплет 1]',
    'Тёплое место, но улицы ждут',
    'Отпечатков наших ног',
    'Звёздная пыль на сапогах & мягкое кресло',
    '',
    '[Припев]',
    'Группа крови на рукаве,',
    'Мой порядковый номер на рукаве',
    'Пожелай мне удачи в бою, пожелай мне…',
    'Не остаться в этой траве',
  ].join('\n');

  test('склеивает блоки, убирает служебный заголовок, теги и сущности', () => {
    const text = extractLyricsFromHtml(page);
    expect(text).toBe(expected);
    expect(text).not.toContain('Contributors');
    expect(text).not.toContain('Реклама');
    expect(text).not.toContain('<');
  });

  test('extractLyrics без DOMParser разбирает строкой так же', () => {
    expect(typeof DOMParser).toBe('undefined');
    expect(extractLyrics(page)).toBe(expected);
  });

  test('на странице без текста: null', () => {
    expect(extractLyricsFromHtml('<html><body><div class="Lyrics">Скоро</div></body></html>')).toBeNull();
    expect(extractLyricsFromHtml('<div data-lyrics-container="true"><div data-exclude-from-selection="true">1 Contributor</div></div>')).toBeNull();
  });
});

describe('lyrics: подготовка запроса', () => {
  test('cleanTitle убирает скобки, feat./prod. и хвост после «|»', () => {
    expect(cleanTitle('T-Fest - Улети (prod. by Solo) [Official Video]')).toBe('T-Fest - Улети');
    expect(cleanTitle('Macan - ASPHALT 8 | Премьера клипа 2021')).toBe('Macan - ASPHALT 8');
    expect(cleanTitle('Oxxxymiron feat. Porchy — Где нас нет')).toBe('Oxxxymiron — Где нас нет');
    expect(cleanTitle('«Кукла колдуна»')).toBe('Кукла колдуна');
    expect(cleanTitle('Billie Jean')).toBe('Billie Jean');
  });

  test('lyricsCandidates: исполнитель из названия идёт первым', () => {
    const q = lyricsCandidates({ artist: 'VSRAP', title: 'Скриптонит - Положение (Official Audio)' });
    expect(q[0]).toEqual({ artist: 'Скриптонит', title: 'Положение' });
    // Загрузчик и перевёрнутый порядок «Название - Исполнитель» тоже пробуем.
    expect(q).toContainEqual({ artist: 'VSRAP', title: 'Скриптонит - Положение' });
    expect(q).toContainEqual({ artist: 'Положение', title: 'Скриптонит' });
  });
});

describe('обновления: сравнение версий', () => {
  test('числа сравниваются как числа, «v» не мешает', () => {
    expect(isNewer('v0.2.1', '0.2.0')).toBe(true);
    expect(isNewer('0.2.10', '0.2.9')).toBe(true);
    expect(isNewer('1.0', '0.9.9')).toBe(true);
    expect(isNewer('v0.2.0', '0.2.0')).toBe(false);
    expect(isNewer('0.1.9', '0.2.0')).toBe(false);
  });

  test('релиз новее своей беты', () => {
    expect(isNewer('0.3.0', '0.3.0-beta.2')).toBe(true);
    expect(isNewer('0.3.0-beta.2', '0.3.0')).toBe(false);
    expect(isNewer('0.3.0-beta.10', '0.3.0-beta.9')).toBe(true);
  });
});

describe('таймер сна', () => {
  test('sleepLeft', () => {
    const now = 1_000_000;
    expect(sleepLeft(null, now)).toBe('');
    expect(sleepLeft({ kind: 'track' }, now)).toBe('до конца трека');
    expect(sleepLeft({ kind: 'time', minutes: 30, endsAt: now + 23 * 60_000 - 5_000 }, now)).toBe('23 мин');
    expect(sleepLeft({ kind: 'time', minutes: 15, endsAt: now + 45_000 }, now)).toBe('45 с');
    expect(sleepLeft({ kind: 'time', minutes: 15, endsAt: now - 10_000 }, now)).toBe('0 с');
  });
});
