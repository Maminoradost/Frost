/**
 * Группы настроек версии 0.9: Windows, звук (переход, громкость, устройство, пресеты),
 * интеграции, данные и проверка обновлений.
 */
import { invoke } from '@tauri-apps/api/core';
import { Database, Download, ExternalLink, Monitor, Plug, RotateCcw, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Switch } from '../../components/Switch';
import { accelFromEvent, accelLabel } from '../../lib/accelerator';
import { DEFAULT_GLOBAL_KEYS, GLOBAL_ACTIONS, getAutostart, openMiniPlayer, setAutostart, type GlobalAction } from '../../lib/desktop';
import { buildReport } from '../../lib/diagnostics';
import { clearJournal, exportJournal, importJournal, journalSize } from '../../lib/journal';
import { DISCORD_APP_ID, LISTENBRAINZ_SETTINGS, newIssueUrl } from '../../lib/links';
import { lastfmAuthUrl, lastfmAvailable, lastfmGetSession, lastfmGetToken, listenbrainzValidate, loadQueue } from '../../lib/scrobble';
import { flushScrobbles } from '../../lib/scrobbler';
import { findAppUpdate, installAppUpdate, type AppUpdate } from '../../lib/updates';
import { APP_VERSION } from '../../lib/version';
import { isTauri, openExternal } from '../../lib/window';
import { useLibrary } from '../../store/library';
import { useSettings } from '../../store/settings';
import { toast, useUi } from '../../store/ui';
import { Group, Row } from './ui';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

function KeyCapture({ action }: { action: GlobalAction }) {
  const map = useSettings((s) => s.globalKeyMap);
  const update = useSettings((s) => s.update);
  const [listening, setListening] = useState(false);
  const value = map[action] ?? DEFAULT_GLOBAL_KEYS[action];

  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return setListening(false);
      if (e.key === 'Backspace' || e.key === 'Delete') {
        update({ globalKeyMap: { ...useSettings.getState().globalKeyMap, [action]: '' } });
        return setListening(false);
      }
      const accel = accelFromEvent(e);
      if (!accel) return;
      update({ globalKeyMap: { ...useSettings.getState().globalKeyMap, [action]: accel } });
      setListening(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [listening, action, update]);

  return (
    <button
      className={`key-capture ${listening ? 'is-listening' : ''}`}
      onClick={() => setListening((v) => !v)}
      onBlur={() => setListening(false)}
      aria-label={`Сочетание: ${value ? accelLabel(value) : 'не задано'}. Нажмите, чтобы изменить`}
    >
      {listening ? 'Нажмите сочетание…' : value ? accelLabel(value) : 'Не задано'}
    </button>
  );
}

export function WindowsGroup() {
  const s = useSettings();
  const [autostart, setAuto] = useState<boolean | null>(null);

  useEffect(() => {
    if (isTauri) void getAutostart().then(setAuto);
  }, []);

  const toggleAutostart = async (on: boolean) => {
    try {
      await setAutostart(on);
      setAuto(await getAutostart());
    } catch (e) {
      toast(`Не удалось изменить автозапуск: ${errText(e)}`, 'error');
    }
  };

  return (
    <Group icon={<Monitor size={18} />} title="Windows" subtitle="Трей, автозапуск, мини-плеер и глобальные клавиши">
      <Switch
        checked={s.closeToTray}
        onChange={(v) => s.update({ closeToTray: v })}
        label="Сворачивать в трей при закрытии"
        description="Крестик прячет окно, музыка продолжает играть. Выйти можно из меню значка в трее."
      />
      <Switch checked={!!autostart} onChange={(v) => void toggleAutostart(v)} label="Запускать вместе с Windows" />
      {autostart && (
        <Switch checked={s.startMinimized} onChange={(v) => s.update({ startMinimized: v })} label="При автозапуске сразу прятаться в трей" />
      )}
      <Row label="Мини-плеер" description="Маленькое окно поверх остальных: обложка, название и кнопки.">
        <button
          className="btn btn--ghost btn--sm"
          onClick={() => openMiniPlayer().catch((e: unknown) => toast(`Мини-плеер не открылся: ${errText(e)}`, 'error'))}
        >
          Открыть
        </button>
      </Row>
      <Switch
        checked={s.globalKeys}
        onChange={(v) => s.update({ globalKeys: v })}
        label="Глобальные горячие клавиши"
        description="Работают, даже когда Frost свёрнут. Мультимедийные клавиши клавиатуры работают всегда."
      />
      {s.globalKeys && (
        <div className="global-keys">
          {GLOBAL_ACTIONS.map((a) => (
            <div className="global-keys__row" key={a.id}>
              <span>{a.label}</span>
              <KeyCapture action={a.id} />
            </div>
          ))}
          <div className="global-keys__foot">
            <span className="setting-row__desc">Backspace очищает сочетание, Esc отменяет ввод.</span>
            <button className="btn btn--ghost btn--sm" onClick={() => s.update({ globalKeyMap: {} })}>
              <RotateCcw size={14} /> По умолчанию
            </button>
          </div>
        </div>
      )}
    </Group>
  );
}

// ---------------------------------------------------------------------------
// Звук
// ---------------------------------------------------------------------------

export function SoundExtras() {
  const crossfade = useSettings((s) => s.crossfade);
  const normalize = useSettings((s) => s.normalize);
  const outputDevice = useSettings((s) => s.outputDevice);
  const eqCustom = useSettings((s) => s.eqCustom);
  const eqPreset = useSettings((s) => s.eqPreset);
  const { update, applyPreset, saveEqPreset, deleteEqPreset } = useSettings.getState();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  const loadDevices = async (ask = false) => {
    try {
      if (ask) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      }
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((d) => d.kind === 'audiooutput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications'));
    } catch (e) {
      if (ask) toast(`Список устройств недоступен: ${errText(e)}`, 'error');
    }
  };

  useEffect(() => {
    void loadDevices();
    const onChange = () => void loadDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', onChange);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', onChange);
  }, []);

  const named = devices.filter((d) => d.label);

  return (
    <>
      <Row label="Плавный переход" description="Конец трека растворяется в начале следующего.">
        <span className="range-field">
          <input
            type="range"
            min={0}
            max={12}
            step={1}
            value={crossfade}
            onChange={(e) => update({ crossfade: Number(e.target.value) })}
            aria-label="Длительность плавного перехода, секунд"
          />
          <span className="range-field__value">{crossfade ? `${crossfade} с` : 'Выкл'}</span>
        </span>
      </Row>
      <Switch
        checked={normalize}
        onChange={(v) => update({ normalize: v })}
        label="Выравнивать громкость"
        description="Тихие и громкие треки звучат ровнее. Работает мягкий компрессор, качество не страдает."
      />
      <Row
        label="Устройство вывода"
        description={
          named.length
            ? 'Если устройство отключить, звук вернётся в устройство Windows по умолчанию.'
            : 'Чтобы показать названия устройств, движок Windows один раз спросит доступ к микрофону. Сам микрофон не используется.'
        }
      >
        {named.length ? (
          <select className="input select" value={outputDevice} onChange={(e) => update({ outputDevice: e.target.value })} aria-label="Устройство вывода">
            <option value="">Как в Windows</option>
            {named.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        ) : (
          <button className="btn btn--ghost btn--sm" onClick={() => void loadDevices(true)}>
            Показать устройства
          </button>
        )}
      </Row>
      <Row label="Свои пресеты эквалайзера" description="Сохраните текущие полосы под своим именем." stacked>
        <div className="chip-row">
          {Object.keys(eqCustom).map((name) => (
            <span key={name} className={`chip chip--sm ${eqPreset === name ? 'is-active' : ''}`}>
              <button className="chip__main" onClick={() => applyPreset(name)}>
                {name}
              </button>
              <button className="chip__remove" onClick={() => deleteEqPreset(name)} aria-label={`Удалить пресет ${name}`}>
                <X size={12} />
              </button>
            </span>
          ))}
          <button
            className="chip chip--sm chip--add"
            onClick={() =>
              useUi.getState().openModal({
                kind: 'prompt',
                title: 'Новый пресет',
                placeholder: 'Например, «Наушники»',
                confirm: 'Сохранить',
                onSubmit: (name) => saveEqPreset(name),
              })
            }
          >
            + Сохранить текущий
          </button>
        </div>
      </Row>
    </>
  );
}

// ---------------------------------------------------------------------------
// Интеграции
// ---------------------------------------------------------------------------

export function IntegrationsGroup() {
  const s = useSettings();
  const [lbToken, setLbToken] = useState('');
  const [busy, setBusy] = useState<'' | 'lb' | 'lastfm'>('');
  const [lastfmToken, setLastfmToken] = useState('');
  const queued = loadQueue().length;
  const builtInDiscord = !!DISCORD_APP_ID;

  const connectLb = async () => {
    setBusy('lb');
    try {
      const user = await listenbrainzValidate(lbToken.trim());
      s.update({ listenbrainzToken: lbToken.trim(), listenbrainzUser: user });
      setLbToken('');
      toast(`ListenBrainz подключён: ${user}`, 'success');
    } catch (e) {
      toast(`ListenBrainz: ${errText(e)}`, 'error');
    } finally {
      setBusy('');
    }
  };

  const startLastfm = async () => {
    setBusy('lastfm');
    try {
      const token = await lastfmGetToken();
      setLastfmToken(token);
      await openExternal(lastfmAuthUrl(token));
    } catch (e) {
      toast(`Last.fm: ${errText(e)}`, 'error');
    } finally {
      setBusy('');
    }
  };

  const finishLastfm = async () => {
    setBusy('lastfm');
    try {
      const session = await lastfmGetSession(lastfmToken);
      s.update({ lastfmSession: session.key, lastfmUser: session.name });
      setLastfmToken('');
      toast(`Last.fm подключён: ${session.name}`, 'success');
    } catch (e) {
      toast(`Last.fm: ${errText(e)}. Разрешите доступ на сайте и нажмите кнопку ещё раз`, 'error');
    } finally {
      setBusy('');
    }
  };

  return (
    <Group icon={<Plug size={18} />} title="Интеграции" subtitle="Discord и учёт прослушиваний в ListenBrainz и Last.fm">
      <Switch
        checked={s.discordEnabled}
        onChange={(v) => s.update({ discordEnabled: v })}
        label="Показывать в Discord, что играет"
        description="Статус «Слушает» с названием, обложкой и временем. Нужен запущенный Discord на этом компьютере."
      />
      {s.discordEnabled && (
        <Row
          label={builtInDiscord ? 'Своё приложение Discord' : 'Application ID'}
          description={
            builtInDiscord
              ? 'Необязательно. Оставьте пустым, чтобы использовать приложение Frost.'
              : 'Создайте приложение на discord.com/developers (имя приложения будет видно в статусе) и вставьте его Application ID.'
          }
        >
          <input
            className="input input--sm"
            value={s.discordAppId}
            onChange={(e) => s.update({ discordAppId: e.target.value.replace(/\D/g, '') })}
            placeholder="123456789012345678"
            inputMode="numeric"
            aria-label="Discord Application ID"
          />
        </Row>
      )}

      <Row
        label="ListenBrainz"
        description={
          s.listenbrainzUser ? (
            `Подключено: ${s.listenbrainzUser}`
          ) : (
            <>
              Токен находится в{' '}
              <button className="link" onClick={() => void openExternal(LISTENBRAINZ_SETTINGS)}>
                настройках профиля ListenBrainz
              </button>
              .
            </>
          )
        }
      >
        {s.listenbrainzUser ? (
          <button className="btn btn--ghost btn--sm" onClick={() => s.update({ listenbrainzToken: '', listenbrainzUser: '' })}>
            Отключить
          </button>
        ) : (
          <span className="inline-form">
            <input
              className="input input--sm"
              value={lbToken}
              onChange={(e) => setLbToken(e.target.value)}
              placeholder="Токен"
              type="password"
              aria-label="Токен ListenBrainz"
            />
            <button className="btn btn--primary btn--sm" disabled={!lbToken.trim() || busy === 'lb'} onClick={() => void connectLb()}>
              Подключить
            </button>
          </span>
        )}
      </Row>

      <Row
        label="Last.fm"
        description={
          !lastfmAvailable()
            ? 'В этой сборке нет ключей Last.fm API. Их можно указать в src/lib/links.ts и собрать Frost заново.'
            : s.lastfmUser
              ? `Подключено: ${s.lastfmUser}`
              : lastfmToken
                ? 'Разрешите доступ в открывшемся браузере, затем нажмите «Готово».'
                : 'Вход через сайт Last.fm, пароль Frost не видит.'
        }
      >
        {lastfmAvailable() &&
          (s.lastfmUser ? (
            <button className="btn btn--ghost btn--sm" onClick={() => s.update({ lastfmSession: '', lastfmUser: '' })}>
              Отключить
            </button>
          ) : lastfmToken ? (
            <button className="btn btn--primary btn--sm" disabled={busy === 'lastfm'} onClick={() => void finishLastfm()}>
              Готово
            </button>
          ) : (
            <button className="btn btn--ghost btn--sm" disabled={busy === 'lastfm'} onClick={() => void startLastfm()}>
              <ExternalLink size={14} /> Войти
            </button>
          ))}
      </Row>
      {queued > 0 && (
        <Row label="Неотправленные прослушивания" description={`${queued} в очереди: отправятся, когда появится сеть.`}>
          <button className="btn btn--ghost btn--sm" onClick={() => void flushScrobbles()}>
            Отправить сейчас
          </button>
        </Row>
      )}
    </Group>
  );
}

// ---------------------------------------------------------------------------
// Данные
// ---------------------------------------------------------------------------

interface Backup {
  app: 'frost';
  version: string;
  created: string;
  settings: Record<string, unknown>;
  library: Record<string, unknown>;
  journal?: unknown;
}

/** Токены сервисов в копию не попадают: при восстановлении их проще ввести заново. */
const SECRET_KEYS = ['listenbrainzToken', 'listenbrainzUser', 'lastfmSession', 'lastfmUser'];

function plainState(state: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(state).filter(([, v]) => typeof v !== 'function'));
}

export function DataGroup() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [records, setRecords] = useState<number | null>(null);

  useEffect(() => {
    void journalSize().then(setRecords);
  }, []);

  const save = async () => {
    try {
      const settings = plainState(useSettings.getState());
      delete settings.config;
      for (const k of SECRET_KEYS) delete settings[k];
      const backup: Backup = {
        app: 'frost',
        version: APP_VERSION,
        created: new Date().toISOString(),
        settings,
        library: plainState(useLibrary.getState()),
        journal: await exportJournal(),
      };
      const { save: pick } = await import('@tauri-apps/plugin-dialog');
      const path = await pick({
        title: 'Резервная копия Frost',
        defaultPath: `frost-backup-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'Резервная копия', extensions: ['json'] }],
      });
      if (!path) return;
      await invoke('backup_write', { path, contents: JSON.stringify(backup) });
      toast('Резервная копия сохранена', 'success');
    } catch (e) {
      toast(`Не удалось сохранить копию: ${errText(e)}`, 'error');
    }
  };

  const restore = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as Partial<Backup>;
      if (data.app !== 'frost' || !data.settings || !data.library) throw new Error('это не резервная копия Frost');
      const settings = { ...data.settings };
      for (const k of [...SECRET_KEYS, 'config']) delete settings[k];
      const current = useSettings.getState() as unknown as Record<string, unknown>;
      const patch = Object.fromEntries(Object.entries(settings).filter(([k, v]) => k in current && typeof current[k] === typeof v));
      useSettings.getState().update(patch);
      const lib = useLibrary.getState() as unknown as Record<string, unknown>;
      const libPatch = Object.fromEntries(Object.entries(data.library).filter(([k, v]) => k in lib && typeof lib[k] !== 'function' && Array.isArray(lib[k]) === Array.isArray(v)));
      useLibrary.setState(libPatch);
      const added = await importJournal(data.journal as never);
      setRecords(await journalSize());
      toast(`Восстановлено из копии от ${new Date(data.created ?? '').toLocaleDateString('ru-RU')}${added ? `, записей журнала: ${added}` : ''}`, 'success');
    } catch (e) {
      toast(`Не удалось восстановить: ${errText(e)}`, 'error');
    }
  };

  const copyReport = async () => {
    const s = useSettings.getState();
    const report = buildReport({
      'Версия': APP_VERSION,
      'Источник по умолчанию': s.searchSource,
      'Движок YouTube': s.config?.ytEngine ?? null,
      'Плавный переход': s.crossfade,
      'Выравнивание': s.normalize,
      'Папок с музыкой': s.localFolders.length,
      'Discord': s.discordEnabled,
      'Платформа': navigator.userAgent,
    });
    try {
      await navigator.clipboard.writeText(report);
      toast('Отчёт скопирован. Вставьте его в задачу на GitHub', 'success', { label: 'Открыть', onClick: () => void openExternal(newIssueUrl()) });
    } catch (e) {
      toast(`Буфер обмена недоступен: ${errText(e)}`, 'error');
    }
  };

  return (
    <Group icon={<Database size={18} />} title="Данные" subtitle="Резервная копия, журнал прослушиваний и отчёт об ошибке">
      <Row label="Резервная копия" description="Избранное, плейлисты, подписки, история, журнал и настройки в одном файле. Токены сервисов не сохраняются.">
        <span className="inline-form">
          <button className="btn btn--ghost btn--sm" onClick={() => void save()} disabled={!isTauri}>
            Сохранить
          </button>
          <button className="btn btn--ghost btn--sm" onClick={() => fileRef.current?.click()}>
            Восстановить
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void restore(f);
            }}
          />
        </span>
      </Row>
      <Row label="Журнал прослушиваний" description={records === null ? 'Считаю…' : `Записей: ${records}. Из него строятся «Итоги».`}>
        <button
          className="btn btn--ghost btn--sm"
          disabled={!records}
          onClick={() =>
            useUi.getState().openModal({
              kind: 'confirm',
              title: 'Очистить журнал?',
              message: 'Статистика «Итогов» начнётся заново. Избранное и плейлисты останутся.',
              confirm: 'Очистить',
              danger: true,
              onConfirm: () =>
                void clearJournal().then(() => {
                  setRecords(0);
                  toast('Журнал очищен', 'success');
                }),
            })
          }
        >
          <Trash2 size={14} /> Очистить
        </button>
      </Row>
      <Row label="Сообщить об ошибке" description="В отчёт попадут версия, настройки и последние ошибки. Токены и пути к файлам скрываются.">
        <button className="btn btn--ghost btn--sm" onClick={() => void copyReport()}>
          Скопировать отчёт
        </button>
      </Row>
    </Group>
  );
}

// ---------------------------------------------------------------------------
// Обновления (в группе «О программе»)
// ---------------------------------------------------------------------------

export function UpdatesRow() {
  const [state, setState] = useState<'idle' | 'checking' | 'latest' | 'installing'>('idle');
  const [update, setUpdate] = useState<AppUpdate | null>(null);

  const check = async () => {
    setState('checking');
    try {
      const found = await findAppUpdate();
      setUpdate(found);
      setState(found ? 'idle' : 'latest');
    } catch (e) {
      setState('idle');
      toast(`Не удалось проверить обновления: ${errText(e)}`, 'error');
    }
  };

  const install = async () => {
    if (!update) return;
    setState('installing');
    try {
      await installAppUpdate(update);
    } catch (e) {
      setState('idle');
      toast(`Обновление не скачалось: ${errText(e)}`, 'error');
    }
  };

  return (
    <Row
      label="Обновления"
      description={
        update
          ? `Доступна версия ${update.version}. Установщик скачается и запустится сам.`
          : state === 'latest'
            ? `У вас последняя версия (${APP_VERSION}).`
            : 'Frost сам проверяет обновления раз в сутки.'
      }
    >
      {update ? (
        <button className="btn btn--primary btn--sm" onClick={() => void install()} disabled={state === 'installing'}>
          <Download size={14} /> {state === 'installing' ? 'Скачиваю…' : 'Обновить'}
        </button>
      ) : (
        <button className="btn btn--ghost btn--sm" onClick={() => void check()} disabled={state === 'checking'}>
          {state === 'checking' ? 'Проверяю…' : 'Проверить'}
        </button>
      )}
    </Row>
  );
}
