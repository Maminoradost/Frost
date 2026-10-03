/**
 * Перевод интерфейса. Ключ — исходная русская строка (как в gettext), поэтому всё,
 * что ещё не переведено, просто остаётся по-русски. Язык определяется один раз при
 * загрузке (из сохранённых настроек, при первом запуске — по языку Windows);
 * смена языка перезапускает интерфейс, поэтому `tr()` можно звать где угодно,
 * даже в константах модулей.
 */
import { EN } from '../locales/en';

export type UiLanguage = 'ru' | 'en';

/** Языки, для которых по умолчанию включается русский интерфейс. */
const RU_FAMILY = /^(ru|uk|be|kk|uz|ky|tg|hy|ka|az|tk|mo)\b/;

export function detectLanguage(saved: unknown, systemLanguage: string | undefined): UiLanguage {
  if (saved === 'ru' || saved === 'en') return saved;
  const sys = (systemLanguage ?? 'ru').toLowerCase();
  return RU_FAMILY.test(sys) ? 'ru' : 'en';
}

function initialLanguage(): UiLanguage {
  let saved: unknown;
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem('frost.settings') ?? '{}') as { state?: { uiLanguage?: unknown } };
    saved = raw.state?.uiLanguage;
  } catch {
    /* повреждённые настройки: язык по системе */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : undefined;
  return detectLanguage(saved, nav);
}

export const lang: UiLanguage = initialLanguage();
let dict: Record<string, string> | null = lang === 'en' ? EN : null;

/** Только для тестов: переключить словарь без перезапуска. */
export function setDictionaryForTests(next: UiLanguage) {
  dict = next === 'en' ? EN : null;
}

/** Перевод строки; `{0}`, `{1}`… заменяются аргументами. */
export function tr(text: string, ...args: (string | number)[]): string {
  const out = (dict && dict[text]) || text;
  if (!args.length) return out;
  return out.replace(/\{(\d+)\}/g, (m, i: string) => {
    const v = args[Number(i)];
    return v === undefined ? m : String(v);
  });
}

/**
 * Склонение по числу. Русские формы — ключ словаря («трек|трека|треков»),
 * английский перевод — «track|tracks».
 */
export function plural(n: number, one: string, few: string, many: string): string {
  if (dict) {
    const en = dict[`${one}|${few}|${many}`];
    if (en) {
      const [single, multi] = en.split('|');
      return Math.abs(n) === 1 ? single : multi ?? single;
    }
  }
  const n10 = Math.abs(n) % 10;
  const n100 = Math.abs(n) % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}

/** Локаль для Intl (даты, числа). */
export const locale = lang === 'en' ? 'en-US' : 'ru-RU';
