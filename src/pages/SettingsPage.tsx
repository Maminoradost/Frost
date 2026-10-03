import {
  ArrowUpDown,
  AudioLines,
  Check,
  CircleAlert,
  Cpu,
  Download,
  ExternalLink,
  Globe,
  Info,
  Keyboard,
  Radio,
  RefreshCw,
  SlidersVertical,
} from 'lucide-react';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { EQ_BANDS } from '../audio/engine';
import { ProviderBadge } from '../components/ProviderBadge';
import { Spinner } from '../components/States';
import { Switch } from '../components/Switch';
import { formatHz } from '../lib/actions';
import { api, errorText } from '../lib/api';
import { countryName, providerMeta } from '../lib/providers';
import type {
  AppInfo,
  NetMode,
  SearchSource,
  SourceProvider,
  YtdlpStatus,
  YtEngine,
} from '../lib/types';
import { DEFAULT_CONFIG } from '../lib/types';
import { GITHUB_REPO, githubUrl, TELEGRAM_URL } from '../lib/links';
import { isTauri, openExternal } from '../lib/window';
import { APP_VERSION } from '../lib/version';
import { TelegramIcon } from '../components/Telegram';
import { navigate } from '../store/ui';
import { EQ_PRESETS, useSettings } from '../store/settings';
import { toast, useUi } from '../store/ui';
import { DataGroup, IntegrationsGroup, SoundExtras, UpdatesRow, WindowsGroup } from './settings/extra';
import { AppearanceGroup, LyricsGroup } from './settings/appearance';
import { Group, RadioList, Row, Segmented } from './settings/ui';
import { AudioCacheCard, BotguardRow, YoutubeCheck } from './settings/youtube';

// ---------------------------------------------------------------------------
// Справочники
// ---------------------------------------------------------------------------

const SEARCH_SOURCES: [SearchSource, string][] = [
  ['all', 'Везде'],
  ['youtube', 'YouTube Music'],
  ['soundcloud', 'SoundCloud'],
];

const NET_MODES: { id: NetMode; label: string; hint: string }[] = [
  { id: 'system', label: 'Как в системе', hint: 'Системный прокси Windows: подхватывает большинство VPN-клиентов' },
  { id: 'custom', label: 'Свой прокси', hint: 'HTTP, HTTPS или SOCKS5, например socks5://127.0.0.1:1080' },
  { id: 'direct', label: 'Напрямую', hint: 'Игнорировать системный прокси' },
];

const ENGINES: { id: YtEngine; label: string; hint: string }[] = [
  {
    id: 'auto',
    label: 'Авто',
    hint: 'Трек скачивается целиком, пока начинает играть: быстрый старт через RustyPipe, а если YouTube обрывает поток, файл докачивает yt-dlp (Frost ставит его сам). Источник меняется посреди загрузки незаметно, без пауз',
  },
  {
    id: 'rustypipe',
    label: 'Только RustyPipe',
    hint: 'Без yt-dlp: Frost перебирает клиенты YouTube (TV, iOS, Android) и запоминает сработавший. Надёжнее всего вместе с помощником RustyPipe (кнопка ниже)',
  },
  {
    id: 'ytdlp',
    label: 'Только yt-dlp',
    hint: 'Файл всегда качает сам yt-dlp. Старт на 2–5 секунд дольше, зато это самый устойчивый к изменениям YouTube способ',
  },
];

/** Регионы YouTube Music: влияют на выдачу поиска, чарты и новинки. */
const REGIONS = ['RU', 'KZ', 'BY', 'UA', 'UZ', 'KG', 'AM', 'GE', 'AZ', 'MD', 'TJ', 'US', 'GB', 'DE', 'TR'];

const LANGUAGES: [string, string][] = [
  ['ru', 'Русский'],
  ['uk', 'Українська'],
  ['be', 'Беларуская'],
  ['kk', 'Қазақша'],
  ['uz', 'Oʻzbekcha'],
  ['hy', 'Հայերեն'],
  ['ka', 'ქართული'],
  ['az', 'Azərbaycanca'],
  ['en', 'English'],
];

const SHORTCUTS: [string, string][] = [
  ['Пробел', 'Играть / пауза'],
  ['Ctrl + → / ←', 'Следующий / предыдущий трек'],
  ['Shift + → / ←', 'Перемотка на 5 секунд'],
  ['Ctrl + ↑ / ↓', 'Громкость'],
  ['M', 'Без звука'],
  ['S', 'Перемешать'],
  ['R', 'Режим повтора'],
  ['L', 'Лайк текущему треку'],
  ['Q', 'Очередь'],
  ['F', 'Экран «Сейчас играет»'],
  ['Ctrl + K, Ctrl + F, /', 'Поиск'],
  ['Alt + ← / →', 'Назад / вперёд'],
  ['Esc', 'Закрыть оверлей'],
  ['Медиаклавиши', 'Через системную панель мультимедиа Windows'],
];

const CREDITS: [string, string, string][] = [
  ['RustyPipe', 'клиент YouTube Music на Rust (GPL-3.0)', 'https://codeberg.org/ThetaDev/rustypipe'],
  ['yt-dlp', 'универсальный загрузчик (Unlicense)', 'https://github.com/yt-dlp/yt-dlp'],
  ['Deno', 'JS-движок для yt-dlp (MIT)', 'https://deno.com'],
  ['LRCLIB', 'синхронизированные тексты песен', 'https://lrclib.net'],
  ['Tauri', 'оболочка приложения (MIT / Apache-2.0)', 'https://tauri.app'],
  ['Material You', 'дизайн-система Material 3 от Google', 'https://m3.material.io'],
];

type CheckResult = { ok: boolean; text: string };

// ---------------------------------------------------------------------------
// Страница
// ---------------------------------------------------------------------------

export function SettingsPage() {
  return (
    <div className="page page--narrow page--settings">
      <div className="page-head">
        <h1 className="page-title">Настройки</h1>
        <p className="page-subtitle">Всё работает сразу после установки: никаких ключей и аккаунтов</p>
      </div>
      <SourcesGroup />
      <YoutubeGroup />
      <NetworkGroup />
      <AppearanceGroup />
      <LyricsGroup />
      <SoundGroup />
      {isTauri && <WindowsGroup />}
      <IntegrationsGroup />
      <DataGroup />
      <Group icon={<Keyboard size={20} />} title="Горячие клавиши">
        <div className="shortcuts">
          {SHORTCUTS.map(([keys, action]) => (
            <div key={keys} className="shortcuts__row">
              <kbd>{keys}</kbd>
              <span>{action}</span>
            </div>
          ))}
        </div>
      </Group>
      <AboutGroup />
    </div>
  );
}

// ---------- источники ----------

function SourcesGroup() {
  const s = useSettings();
  const config = s.config ?? DEFAULT_CONFIG;
  const [checks, setChecks] = useState<Partial<Record<SourceProvider, CheckResult>>>({});
  const [testing, setTesting] = useState<SourceProvider | null>(null);

  const test = async (p: SourceProvider) => {
    setTesting(p);
    try {
      const ms = await api.testSource(p);
      setChecks((c) => ({ ...c, [p]: { ok: true, text: `Работает: «Billie Jean» найден за ${ms} мс` } }));
    } catch (e) {
      setChecks((c) => ({ ...c, [p]: { ok: false, text: errorText(e) } }));
    } finally {
      setTesting(null);
    }
  };

  const toggle = async (p: SourceProvider, on: boolean) => {
    const other = p === 'youtube' ? config.soundcloud : config.youtube;
    if (!on && !other) {
      toast('Хотя бы один источник должен остаться включённым', 'error');
      return;
    }
    await s.patchConfig(p === 'youtube' ? { youtube: on } : { soundcloud: on });
  };

  const card = (p: SourceProvider) => {
    const meta = providerMeta(p);
    const on = p === 'youtube' ? config.youtube : config.soundcloud;
    const result = checks[p];
    return (
      <div className={`source-card ${on ? '' : 'source-card--off'}`} key={p}>
        <div className="source-card__head">
          <ProviderBadge provider={p} withLabel />
          <span className="spacer" />
          <button className="btn btn--text btn--sm" onClick={() => void test(p)} disabled={!on || testing !== null}>
            {testing === p ? <Spinner size={14} /> : <RefreshCw size={14} />} Проверить
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={`${meta.label}: ${on ? 'включён' : 'выключен'}`}
            className={`switch ${on ? 'is-on' : ''}`}
            onClick={() => void toggle(p, !on)}
          >
            <span className="switch__knob" />
          </button>
        </div>
        <p className="source-card__hint">{meta.hint}</p>
        {result && (
          <div className={`source-card__result ${result.ok ? 'is-ok' : 'is-error'}`}>
            {result.ok ? <Check size={14} /> : <CircleAlert size={14} />} {result.text}
          </div>
        )}
      </div>
    );
  };

  const first = s.sourceOrder[0] ?? 'youtube';
  const second: SourceProvider = first === 'youtube' ? 'soundcloud' : 'youtube';

  return (
    <Group icon={<Radio size={20} />} title="Источники" subtitle="Откуда Frost берёт музыку">
      <div className="sources">{(['youtube', 'soundcloud'] as SourceProvider[]).map(card)}</div>
      <Row label="Поиск по умолчанию" description="Где искать, когда вы открываете поиск" stacked>
        <Segmented
          label="Источник поиска"
          value={s.searchSource}
          options={SEARCH_SOURCES}
          onChange={(v) => {
            s.update({ searchSource: v });
            useUi.getState().setSearchProvider(v);
          }}
        />
      </Row>
      <Row label="Приоритет" description="Какой источник пробовать первым для подмены и радио">
        <button className="btn btn--tonal btn--sm" onClick={() => s.update({ sourceOrder: [second, first] })}>
          <ArrowUpDown size={16} /> {providerMeta(first).label} → {providerMeta(second).label}
        </button>
      </Row>
      <Switch
        checked={s.smartFallback}
        onChange={(v) => s.update({ smartFallback: v })}
        label="Умная подмена"
        description="Если в SoundCloud доступно только 30-секундное превью или трек удалён, Frost найдёт полную версию в другом источнике"
      />
      <Switch
        checked={s.autoplayRadio}
        onChange={(v) => s.update({ autoplayRadio: v })}
        label="Автопродолжение"
        description="Когда очередь закончится, включать похожие треки"
      />
    </Group>
  );
}

// ---------- YouTube Music: движок, yt-dlp, регион ----------

type Busy = 'status' | 'install' | 'update' | 'deno' | null;

function YoutubeGroup() {
  const config = useSettings((s) => s.config) ?? DEFAULT_CONFIG;
  const patchConfig = useSettings((s) => s.patchConfig);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [status, setStatus] = useState<YtdlpStatus | null>(null);
  const [busy, setBusy] = useState<Busy>('status');
  const [path, setPath] = useState(config.ytdlpPath);

  const refresh = useCallback(async () => {
    setBusy('status');
    try {
      const [i, st] = await Promise.all([api.appInfo(), api.ytdlpStatus()]);
      setInfo(i);
      setStatus(st);
    } catch (e) {
      console.warn('ytdlp_status failed', e);
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => setPath(config.ytdlpPath), [config.ytdlpPath]);

  const run = async (kind: 'install' | 'update' | 'deno') => {
    setBusy(kind);
    try {
      const st =
        kind === 'install' ? await api.ytdlpInstall() : kind === 'update' ? await api.ytdlpUpdate() : await api.denoInstall();
      setStatus(st);
      toast(kind === 'deno' ? 'Deno установлен' : kind === 'install' ? 'yt-dlp установлен' : 'yt-dlp обновлён', 'success');
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const rustypipe = info?.rustypipe ?? status?.rustypipe ?? true;

  const savePath = async () => {
    const value = path.trim();
    if (value === config.ytdlpPath) return;
    if (await patchConfig({ ytdlpPath: value })) {
      toast(value ? 'Путь к yt-dlp сохранён' : 'Frost сам найдёт yt-dlp', 'success');
      void refresh();
    }
  };

  let ytdlpHint: string;
  if (status?.installed) {
    ytdlpHint = status.managed ? 'Установлен Frost в папку данных приложения.' : `Найден: ${status.path ?? 'в PATH'}.`;
  } else if (config.ytEngine === 'ytdlp') {
    ytdlpHint = 'Выбран движок yt-dlp, но он не установлен: YouTube играть не будет. Установка займёт около 18 МБ.';
  } else {
    ytdlpHint = config.ytEngine === 'auto' && config.youtube
      ? 'В режиме «Авто» Frost поставит yt-dlp сам через несколько секунд после запуска (около 18 МБ, один раз).'
      : 'Нужен для движков «Авто» и «Только yt-dlp»: через него звук YouTube стабильнее всего. Около 18 МБ.';
  }

  return (
    <Group icon={<Cpu size={20} />} title="YouTube Music" subtitle="Движок, yt-dlp и регион выдачи">
      <Row label="Движок воспроизведения" stacked>
        <RadioList
          value={config.ytEngine}
          options={ENGINES}
          onChange={(v) => void patchConfig({ ytEngine: v })}
          disabled={(id) => (id === 'rustypipe' && !rustypipe ? 'Эта сборка Frost собрана без RustyPipe' : null)}
          badge={(id) => (id === 'auto' ? <span className="tag tag--primary">рекомендуется</span> : null)}
        />
      </Row>

      <div className="tool-card">
        <div className="tool-card__head">
          <span className="tool-card__title">yt-dlp</span>
          {busy === 'status' ? (
            <Spinner size={14} />
          ) : status?.installed ? (
            <span className="status status--ok">
              <Check size={14} /> {status.version ? `версия ${status.version}` : 'установлен'}
            </span>
          ) : (
            <span className="status">не установлен</span>
          )}
          <span className="spacer" />
          {status?.installed ? (
            <button className="btn btn--tonal btn--sm" onClick={() => void run('update')} disabled={busy !== null}>
              {busy === 'update' ? <Spinner size={14} /> : <RefreshCw size={14} />} Обновить
            </button>
          ) : (
            <button className="btn btn--filled btn--sm" onClick={() => void run('install')} disabled={busy !== null}>
              {busy === 'install' ? <Spinner size={14} /> : <Download size={14} />} Установить
            </button>
          )}
        </div>
        <p className="tool-card__hint">{ytdlpHint}</p>

        <div className="tool-card__head">
          <span className="tool-card__title">Deno</span>
          {busy === 'status' ? (
            <Spinner size={14} />
          ) : status?.deno ? (
            <span className="status status--ok">
              <Check size={14} /> установлен
            </span>
          ) : (
            <span className="status">не установлен</span>
          )}
          <span className="spacer" />
          {!status?.deno && (
            <button className="btn btn--outlined btn--sm" onClick={() => void run('deno')} disabled={busy !== null}>
              {busy === 'deno' ? <Spinner size={14} /> : <Download size={14} />} Установить
            </button>
          )}
        </div>
        <p className="tool-card__hint">
          JS-движок, которым yt-dlp расшифровывает подписи YouTube. Без него часть треков через yt-dlp может не открываться.
        </p>

        <BotguardRow status={status} onStatus={setStatus} />

        <label className="field">
          <span>Свой yt-dlp.exe (необязательно)</span>
          <input
            className="input"
            placeholder="C:\Tools\yt-dlp.exe"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onBlur={() => void savePath()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void savePath();
            }}
          />
        </label>
      </div>

      <AudioCacheCard />
      <YoutubeCheck />

      <Row label="Регион" description="Влияет на поиск, чарты и новинки YouTube Music">
        <select className="select" value={config.region} onChange={(e) => void patchConfig({ region: e.target.value })}>
          {REGIONS.map((c) => (
            <option key={c} value={c}>
              {countryName(c)}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Язык" description="Язык названий жанров, подборок и разделов">
        <select className="select" value={config.language} onChange={(e) => void patchConfig({ language: e.target.value })}>
          {LANGUAGES.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
      </Row>
    </Group>
  );
}

// ---------- сеть ----------

const PROXY_RE = /^(https?|socks5h?):\/\/[^\s/]+(:\d+)?\/?$/i;

function NetworkGroup() {
  const config = useSettings((s) => s.config) ?? DEFAULT_CONFIG;
  const patchConfig = useSettings((s) => s.patchConfig);
  const [mode, setMode] = useState<NetMode>(config.netMode);
  const [proxy, setProxy] = useState(config.proxyUrl);

  useEffect(() => {
    setMode(config.netMode);
    setProxy(config.proxyUrl);
  }, [config.netMode, config.proxyUrl]);

  const proxyValid = mode !== 'custom' || PROXY_RE.test(proxy.trim());
  const dirty = mode !== config.netMode || proxy.trim() !== config.proxyUrl;

  const reset = () => {
    setMode(config.netMode);
    setProxy(config.proxyUrl);
  };

  const save = async () => {
    if (!proxyValid) {
      toast('Адрес прокси должен выглядеть как http://host:port или socks5://host:port', 'error');
      return;
    }
    if (await patchConfig({ netMode: mode, proxyUrl: proxy.trim() })) toast('Сеть перенастроена', 'success');
  };

  return (
    <Group icon={<Globe size={20} />} title="Сеть" subtitle="Если что-то не грузится из-за ограничений провайдера">
      <Row label="Подключение" stacked>
        <RadioList value={mode} options={NET_MODES} onChange={setMode} />
      </Row>
      {mode === 'custom' && (
        <label className="field">
          <span>Адрес прокси</span>
          <input
            className={`input ${proxyValid ? '' : 'input--error'}`}
            placeholder="socks5://127.0.0.1:1080"
            value={proxy}
            onChange={(e) => setProxy(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
            }}
          />
        </label>
      )}
      {dirty && (
        <div className="settings-save">
          <button className="btn btn--text" onClick={reset}>
            Отмена
          </button>
          <button className="btn btn--filled" onClick={() => void save()} disabled={!proxyValid}>
            Применить
          </button>
        </div>
      )}
    </Group>
  );
}

// ---------- оформление ----------

// ---------- звук ----------

function SoundGroup() {
  const s = useSettings();
  return (
    <Group icon={<SlidersVertical size={20} />} title="Звук" subtitle="10-полосный эквалайзер для всех источников">
      <Switch checked={s.eqEnabled} onChange={(v) => s.update({ eqEnabled: v })} label="Эквалайзер" />
      <div className={`eq ${s.eqEnabled ? '' : 'is-disabled'}`}>
        <div className="chip-row eq__presets">
          {Object.keys(EQ_PRESETS).map((name) => (
            <button key={name} className={`chip ${s.eqPreset === name ? 'chip--on' : ''}`} onClick={() => s.applyPreset(name)}>
              {s.eqPreset === name && <Check size={14} />}
              {name}
            </button>
          ))}
        </div>
        <div className="eq__bands">
          {EQ_BANDS.map((hz, i) => {
            const gain = s.eqGains[i] ?? 0;
            return (
              <div key={hz} className="eq__band">
                <span className="eq__value">{gain > 0 ? `+${gain}` : gain}</span>
                <input
                  type="range"
                  className="eq__slider"
                  min={-12}
                  max={12}
                  step={1}
                  value={gain}
                  aria-label={`${formatHz(hz)} Гц`}
                  onChange={(e) => s.setEqBand(i, Number(e.target.value))}
                  style={{ '--fill': `${((gain + 12) / 24) * 100}%` } as CSSProperties}
                />
                <span className="eq__freq">{formatHz(hz)}</span>
              </div>
            );
          })}
        </div>
      </div>
      <SoundExtras />
    </Group>
  );
}

// ---------- о программе ----------

function AboutGroup() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    api.appInfo().then(setInfo, () => setInfo(null));
  }, []);
  return (
    <Group icon={<Info size={20} />} title="О программе">
      <div className="about">
        <p>
          <strong>Frost {info?.version ?? APP_VERSION}</strong>: музыкальный плеер для Windows в стиле Material You. SoundCloud и YouTube
          Music без ключей и аккаунтов.
        </p>
        <p className="muted">Свободная программа под лицензией GNU GPL v3 или новее. Все права на музыку принадлежат её авторам.</p>
        {isTauri && <UpdatesRow />}
        <button className="tg-banner" onClick={() => void openExternal(TELEGRAM_URL)}>
          <TelegramIcon size={36} />
          <span className="tg-banner__text">
            <span className="tg-banner__title">Канал Frost в Telegram</span>
            <span className="tg-banner__sub">Новости, обновления, ответы на вопросы и место для ваших идей</span>
          </span>
          <ExternalLink size={16} />
        </button>
        <div className="about__actions">
          <button
            className="btn btn--tonal btn--sm"
            onClick={() => {
              useSettings.getState().update({ onboardingDone: false });
              navigate({ name: 'home' });
            }}
          >
            Пройти знакомство ещё раз
          </button>
          {GITHUB_REPO && (
            <button className="btn btn--outlined btn--sm" onClick={() => void openExternal(githubUrl())}>
              GitHub <ExternalLink size={14} />
            </button>
          )}
          {useSettings.getState().hideTelegramCard && (
            <button className="btn btn--text btn--sm" onClick={() => useSettings.getState().update({ hideTelegramCard: false })}>
              Вернуть карточку Telegram в меню
            </button>
          )}
        </div>
        <div className="credits">
          {CREDITS.map(([name, what, url]) => (
            <button key={name} className="credit" onClick={() => void openExternal(url)}>
              <AudioLines size={16} />
              <span className="credit__text">
                <span className="credit__name">{name}</span>
                <span className="credit__what">{what}</span>
              </span>
              <ExternalLink size={14} />
            </button>
          ))}
        </div>
      </div>
    </Group>
  );
}
