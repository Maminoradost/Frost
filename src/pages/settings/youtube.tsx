import { Check, ClipboardCopy, Download, HardDrive, Stethoscope, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Spinner } from '../../components/States';
import { Switch } from '../../components/Switch';
import { api, errorText } from '../../lib/api';
import type { AudioCacheInfo, YtdlpStatus } from '../../lib/types';
import { DEFAULT_CONFIG } from '../../lib/types';
import { usePlayer } from '../../store/player';
import { useSettings } from '../../store/settings';
import { toast } from '../../store/ui';
import { Row } from './ui';

/** Помощник RustyPipe: PO-токены, без которых YouTube обрывает поток после первой порции. */
export function BotguardRow({ status, onStatus }: { status: YtdlpStatus | null; onStatus: (s: YtdlpStatus) => void }) {
  const [busy, setBusy] = useState(false);
  if (status && !status.rustypipe) return null;
  const run = async (remove: boolean) => {
    setBusy(true);
    try {
      const st = remove ? await api.botguardRemove() : await api.botguardInstall();
      onStatus(st);
      toast(remove ? 'Помощник RustyPipe удалён' : 'Помощник RustyPipe установлен', 'success');
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="tool-card__head">
        <span className="tool-card__title">Помощник RustyPipe</span>
        {status?.botguard ? (
          <span className="status status--ok">
            <Check size={14} /> установлен
          </span>
        ) : (
          <span className="status">не установлен</span>
        )}
        <span className="spacer" />
        {status?.botguard ? (
          <button className="btn btn--ghost btn--sm" onClick={() => void run(true)} disabled={busy}>
            {busy ? <Spinner size={14} /> : <Trash2 size={14} />} Удалить
          </button>
        ) : (
          <button className="btn btn--outlined btn--sm" onClick={() => void run(false)} disabled={busy}>
            {busy ? <Spinner size={14} /> : <Download size={14} />} Установить
          </button>
        )}
      </div>
      <p className="tool-card__hint">
        rustypipe-botguard от автора RustyPipe (около 16 МБ). Проходит проверку YouTube и выдаёт PO-токены: с ними YouTube
        отдаёт трек целиком и без yt-dlp.
      </p>
    </>
  );
}

const CACHE_SIZES: [number, string][] = [
  [512, '512 МБ'],
  [1024, '1 ГБ'],
  [2048, '2 ГБ'],
  [4096, '4 ГБ'],
  [8192, '8 ГБ'],
];

function mb(bytes: number) {
  const v = bytes / 1024 / 1024;
  return v >= 1024 ? `${(v / 1024).toFixed(1)} ГБ` : `${Math.round(v)} МБ`;
}

/** Кэш скачанного звука YouTube. */
export function AudioCacheCard() {
  const config = useSettings((s) => s.config) ?? DEFAULT_CONFIG;
  const patchConfig = useSettings((s) => s.patchConfig);
  const [info, setInfo] = useState<AudioCacheInfo | null>(null);

  const refresh = useCallback(() => {
    api.ytCacheInfo().then(setInfo).catch(() => setInfo(null));
  }, []);
  useEffect(() => refresh(), [refresh, config.audioCache, config.audioCacheMb]);

  const clear = async () => {
    try {
      setInfo(await api.ytCacheClear());
      toast('Кэш звука очищен', 'success');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  return (
    <div className="tool-card">
      <div className="tool-card__head">
        <HardDrive size={16} />
        <span className="tool-card__title">Кэш звука YouTube</span>
        <span className="spacer" />
        {info && (
          <span className="status">
            {info.files} {plural(info.files, 'трек', 'трека', 'треков')} · {mb(info.bytes)}
          </span>
        )}
      </div>
      <p className="tool-card__hint">
        Трек YouTube скачивается целиком, пока начинает играть. С кэшем он остаётся на диске: повторное прослушивание и
        перемотка мгновенные, без сети. Старые треки удаляются сами, когда кэш дорастает до предела.
      </p>
      <Switch
        checked={config.audioCache}
        onChange={(v) => void patchConfig({ audioCache: v })}
        label="Хранить скачанные треки"
      />
      <Row label="Предел кэша">
        <select
          className="select"
          value={config.audioCacheMb}
          disabled={!config.audioCache}
          onChange={(e) => void patchConfig({ audioCacheMb: Number(e.target.value) })}
        >
          {CACHE_SIZES.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </Row>
      <div className="tool-card__head">
        <span className="spacer" />
        <button className="btn btn--ghost btn--sm" onClick={() => void clear()} disabled={!info || info.files === 0}>
          <Trash2 size={14} /> Очистить кэш
        </button>
      </div>
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

/**
 * «Проверить YouTube»: для каждого способа (клиенты RustyPipe, yt-dlp) ядро читает начало,
 * середину и конец файла. Видно, где именно YouTube обрывает поток. Отчёт можно скопировать.
 */
export function YoutubeCheck() {
  const current = usePlayer((s) => s.current);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const id = current?.provider === 'youtube' ? current.id : undefined;

  const run = async () => {
    setBusy(true);
    setReport(null);
    try {
      setReport(await api.ytDiagnose(id));
    } catch (e) {
      setReport(`Ошибка: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report);
      toast('Отчёт скопирован', 'success');
    } catch {
      toast('Не удалось скопировать', 'error');
    }
  };

  return (
    <div className="tool-card">
      <div className="tool-card__head">
        <Stethoscope size={16} />
        <span className="tool-card__title">Проверить YouTube</span>
        <span className="spacer" />
        {report && (
          <button className="btn btn--ghost btn--sm" onClick={() => void copy()}>
            <ClipboardCopy size={14} /> Скопировать
          </button>
        )}
        <button className="btn btn--tonal btn--sm" onClick={() => void run()} disabled={busy}>
          {busy ? <Spinner size={14} /> : <Stethoscope size={14} />} Проверить
        </button>
      </div>
      <p className="tool-card__hint">
        {id
          ? 'Проверяется текущий трек. '
          : 'Проверяется тестовый трек (включите трек YouTube, чтобы проверить его). '}
        Для каждого способа видно, отдаёт ли YouTube начало, середину и конец файла. Если трек заикается или
        обрывается, пришлите этот отчёт.
      </p>
      {report && <pre className="diag-report">{report}</pre>}
    </div>
  );
}
