import { useEffect } from 'react';
import { api } from '../lib/api';
import { GITHUB_REPO } from '../lib/links';
import { findAppUpdate, notifyAppUpdate, updateYtdlpIfNeeded } from '../lib/updates';
import { useSettings } from '../store/settings';

/**
 * Тихо ставит yt-dlp при первом запуске (режим «Авто», YouTube включён): звук YouTube
 * надёжнее всего брать через него. Около 18 МБ, один раз; ошибки не показываем:
 * плеер повторит попытку сам, когда yt-dlp действительно понадобится.
 */
export function useYtdlpBootstrap() {
  const config = useSettings((s) => s.config);
  const wanted = !!config && config.youtube && config.ytEngine === 'auto';
  useEffect(() => {
    if (!wanted) return;
    const t = window.setTimeout(() => {
      api.ensureYtdlp().catch((e: unknown) => console.warn('yt-dlp: фоновая установка не удалась', e));
    }, 5000);
    return () => window.clearTimeout(t);
  }, [wanted]);
}

const UPDATE_KEY = 'frost.update-check';

interface UpdateMemo {
  at: number;
  notified?: string;
}

/**
 * Раз в сутки спрашивает GitHub Releases о новой версии. Если она есть, показывает
 * уведомление с кнопкой «Обновить»: установщик скачается и запустится сам.
 */
export function useUpdateCheck() {
  useEffect(() => {
    if (!GITHUB_REPO) return;
    let memo: UpdateMemo = { at: 0 };
    try {
      memo = { ...memo, ...(JSON.parse(localStorage.getItem(UPDATE_KEY) ?? '{}') as UpdateMemo) };
    } catch {
      /* пусто */
    }
    if (Date.now() - memo.at < 24 * 3600_000) return;
    const t = window.setTimeout(async () => {
      try {
        const update = await findAppUpdate();
        memo.at = Date.now();
        if (update && memo.notified !== update.version) {
          memo.notified = update.version;
          notifyAppUpdate(update);
        }
        localStorage.setItem(UPDATE_KEY, JSON.stringify(memo));
      } catch (e) {
        console.warn('Проверка обновлений не удалась', e);
      }
    }, 12_000);
    return () => window.clearTimeout(t);
  }, []);
}

/** yt-dlp, поставленный Frost, обновляется сам раз в неделю (проверка через полторы минуты после запуска). */
export function useYtdlpSchedule() {
  const config = useSettings((s) => s.config);
  const wanted = !!config && config.youtube && config.ytEngine !== 'rustypipe';
  useEffect(() => {
    if (!wanted) return;
    const t = window.setTimeout(() => void updateYtdlpIfNeeded('schedule'), 90_000);
    return () => window.clearTimeout(t);
  }, [wanted]);
}
