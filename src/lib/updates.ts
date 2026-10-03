/**
 * Обновления: Frost (GitHub Releases, установка в один клик) и yt-dlp
 * (сам раз в неделю и один раз за сеанс, если YouTube перестал играть).
 */
import { invoke } from '@tauri-apps/api/core';
import { api } from './api';
import { logEntry } from './diagnostics';
import { GITHUB_REPO, githubUrl } from './links';
import { isNewer } from './version';
import { openExternal } from './window';
import { toast } from '../store/ui';

interface GhAsset {
  name: string;
  browser_download_url: string;
}

interface GhRelease {
  tag_name?: string;
  html_url?: string;
  assets?: GhAsset[];
}

async function ghLatest(repo: string): Promise<GhRelease | null> {
  const res = await invoke<{ status: number; body: string }>('net_fetch', {
    url: `https://api.github.com/repos/${repo}/releases/latest`,
    accept: 'application/vnd.github+json',
  });
  if (res.status !== 200) return null;
  return JSON.parse(res.body) as GhRelease;
}

export interface AppUpdate {
  version: string;
  page: string;
  /** Прямая ссылка на установщик NSIS, если он есть в релизе. */
  installer: string | null;
}

/** Установщик для Windows x64 среди файлов релиза. */
export function pickInstaller(assets: GhAsset[] | undefined): string | null {
  const setup = assets?.find((a) => /_x64-setup\.exe$/i.test(a.name));
  return setup?.browser_download_url ?? null;
}

export async function findAppUpdate(): Promise<AppUpdate | null> {
  if (!GITHUB_REPO) return null;
  const [info, release] = await Promise.all([api.appInfo(), ghLatest(GITHUB_REPO)]);
  const tag = release?.tag_name ?? '';
  if (!release || !tag || !isNewer(tag, info.version)) return null;
  return {
    version: tag.replace(/^v/i, ''),
    page: release.html_url ?? githubUrl('/releases/latest'),
    installer: pickInstaller(release.assets),
  };
}

let installing = false;

/** Скачивает установщик и запускает его; Frost закроется и откроется уже обновлённым. */
export async function installAppUpdate(update: AppUpdate) {
  if (!update.installer) {
    void openExternal(update.page);
    return;
  }
  if (installing) return;
  installing = true;
  toast(`Скачиваю Frost ${update.version}. После установки он откроется сам`, 'info');
  try {
    await invoke('update_install', { url: update.installer });
  } catch (e) {
    installing = false;
    logEntry('error', 'Обновление Frost:', e);
    toast(`Не удалось обновиться: ${e instanceof Error ? e.message : String(e)}`, 'error', {
      label: 'Страница релиза',
      onClick: () => void openExternal(update.page),
    });
  }
}

export function notifyAppUpdate(update: AppUpdate) {
  toast(`Доступна новая версия Frost ${update.version}`, 'info', {
    label: update.installer ? 'Обновить' : 'Скачать',
    onClick: () => void installAppUpdate(update),
  });
}

const YTDLP_KEY = 'frost.ytdlp-check';
const WEEK = 7 * 24 * 3600_000;
let failureTried = false;

/**
 * Обновляет yt-dlp, если вышла новая версия. Только тот, что поставил сам Frost:
 * свой exe пользователь обновляет сам. Возвращает true, если обновление прошло.
 */
export async function updateYtdlpIfNeeded(reason: 'schedule' | 'failure' | 'manual'): Promise<boolean> {
  if (reason === 'failure') {
    if (failureTried) return false;
    failureTried = true;
  } else if (reason === 'schedule') {
    const last = Number(localStorage.getItem(YTDLP_KEY) ?? 0);
    if (Date.now() - last < WEEK) return false;
  }
  try {
    const status = await api.ytdlpStatus();
    if (!status.installed || !status.managed) return false;
    const release = await ghLatest('yt-dlp/yt-dlp');
    localStorage.setItem(YTDLP_KEY, String(Date.now()));
    const latest = release?.tag_name ?? '';
    if (!latest || (status.version && !isNewer(latest, status.version))) return false;
    const next = await api.ytdlpUpdate();
    logEntry('info', `yt-dlp обновлён: ${status.version ?? '?'} → ${next.version ?? latest} (${reason})`);
    return true;
  } catch (e) {
    logEntry('warn', 'yt-dlp: обновление не удалось', e);
    return false;
  }
}
