import type { Provider, SourceProvider } from './types';

export interface ProviderMeta {
  label: string;
  short: string;
  color: string;
  /** Можно ли искать и играть (false: трек из старой медиатеки v0.1). */
  active: boolean;
  hint: string;
}

export const PROVIDERS: Record<Provider, ProviderMeta> = {
  soundcloud: {
    label: 'SoundCloud',
    short: 'SC',
    color: '#ff5500',
    active: true,
    hint: 'Более 300 млн треков, ремиксы и андеграунд. Работает без ключей: Frost подключается так же, как сайт soundcloud.com.',
  },
  youtube: {
    label: 'YouTube Music',
    short: 'YT',
    color: '#ff0033',
    active: true,
    hint: 'Самый большой каталог: все крупные лейблы и артисты СНГ. Движок: RustyPipe (встроен) или yt-dlp.',
  },
  audius: {
    label: 'Audius',
    short: 'AU',
    color: '#9b6bff',
    active: false,
    hint: 'Источник v0.1. Треки из медиатеки находятся заново в SoundCloud/YouTube Music.',
  },
  local: {
    label: 'Файлы на компьютере',
    short: 'PC',
    color: '#7c8cff',
    active: true,
    hint: 'Музыка из ваших папок: MP3, FLAC, M4A, OGG, OPUS, WAV.',
  },
  jamendo: {
    label: 'Jamendo',
    short: 'JA',
    color: '#35d0b4',
    active: false,
    hint: 'Источник v0.1. Треки из медиатеки находятся заново в SoundCloud/YouTube Music.',
  },
};

export const SOURCE_ORDER: SourceProvider[] = ['youtube', 'soundcloud'];

export function providerMeta(provider: Provider | string): ProviderMeta {
  return PROVIDERS[provider as Provider] ?? {
    label: String(provider),
    short: String(provider).slice(0, 2).toUpperCase(),
    color: '#888888',
    active: false,
    hint: '',
  };
}

/** Страны для чартов YouTube Music (СНГ в начале). */
export const CHART_COUNTRIES: string[] = ['RU', 'KZ', 'BY', 'UA', 'UZ', 'KG', 'AM', 'GE', 'AZ', 'MD', 'US', 'GB', 'DE', 'TR', 'ZZ'];

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(['ru'], { type: 'region' });
  } catch {
    return null;
  }
})();

export function countryName(code: string): string {
  if (code === 'ZZ') return 'Весь мир';
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}
