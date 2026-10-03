/**
 * Интеграция с Windows: трей, закрытие в трей, автозапуск, глобальные горячие клавиши,
 * мини-плеер. Всё через API Tauri, в браузере (vite dev без Tauri) молча ничего не делает.
 */
import { invoke } from '@tauri-apps/api/core';
import { defaultWindowIcon } from '@tauri-apps/api/app';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Menu, MenuItem, PredefinedMenuItem } from '@tauri-apps/api/menu';
import { TrayIcon } from '@tauri-apps/api/tray';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { Window, getCurrentWindow } from '@tauri-apps/api/window';
import {
  disable as autostartDisable,
  enable as autostartEnable,
  isEnabled as autostartIsEnabled,
} from '@tauri-apps/plugin-autostart';
import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut';
import { isTauri } from './window';

export const MINI_LABEL = 'mini';
export const isMiniWindow = typeof location !== 'undefined' && location.hash === '#mini';

// ---------------------------------------------------------------------------
// Окна
// ---------------------------------------------------------------------------

export async function showMainWindow() {
  if (!isTauri) return;
  const main = await Window.getByLabel('main');
  if (!main) return;
  await main.unminimize().catch(() => {});
  await main.show().catch(() => {});
  await main.setFocus().catch(() => {});
}

export async function hideMainWindow() {
  if (!isTauri) return;
  const main = await Window.getByLabel('main');
  await main?.hide().catch(() => {});
}

/**
 * Открывает мини-плеер. Окно создаёт ядро (команда `mini_open`): только так у него те же
 * аргументы WebView2, что и у главного окна. Окно из JS (`new WebviewWindow`) получало другие
 * аргументы, WebView2 отказывался его создавать, и оно мелькало белым и закрывалось.
 * Ошибку не глотаем: её покажет уведомление.
 */
export async function openMiniPlayer(): Promise<void> {
  if (!isTauri) return;
  await invoke('mini_open');
  if (isMiniWindow) return;
  // Главное окно убираем с глаз, только если оно на экране: из трея оно не должно
  // внезапно появиться на панели задач свёрнутым.
  const main = getCurrentWindow();
  const visible = await main.isVisible().catch(() => false);
  const minimized = await main.isMinimized().catch(() => false);
  if (visible && !minimized) await main.minimize().catch(() => {});
}

export async function closeMiniPlayer() {
  if (!isTauri) return;
  try {
    await invoke('mini_close');
  } catch {
    const mini = await WebviewWindow.getByLabel(MINI_LABEL);
    await mini?.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Трей
// ---------------------------------------------------------------------------

export interface TrayHandlers {
  toggle(): void;
  next(): void;
  prev(): void;
  mini(): void;
}

let tray: TrayIcon | null = null;
let playItem: MenuItem | null = null;
let trayPending: Promise<void> | null = null;

export function hasTray() {
  return tray !== null;
}

export function setupTray(handlers: TrayHandlers): Promise<void> {
  if (!isTauri || isMiniWindow) return Promise.resolve();
  trayPending ??= (async () => {
    try {
      // Трей мог остаться от перезагрузки страницы в режиме разработки
      const old = await TrayIcon.getById('frost');
      if (old) await TrayIcon.removeById('frost');
      playItem = await MenuItem.new({ id: 'toggle', text: 'Играть', action: () => handlers.toggle() });
      const menu = await Menu.new({
        items: [
          await MenuItem.new({ id: 'show', text: 'Открыть Frost', action: () => void showMainWindow() }),
          await PredefinedMenuItem.new({ item: 'Separator' }),
          playItem,
          await MenuItem.new({ id: 'next', text: 'Следующий трек', action: () => handlers.next() }),
          await MenuItem.new({ id: 'prev', text: 'Предыдущий трек', action: () => handlers.prev() }),
          await MenuItem.new({ id: 'mini', text: 'Мини-плеер', action: () => handlers.mini() }),
          await PredefinedMenuItem.new({ item: 'Separator' }),
          await MenuItem.new({ id: 'quit', text: 'Выйти из Frost', action: () => void invoke('app_quit') }),
        ],
      });
      tray = await TrayIcon.new({
        id: 'frost',
        icon: (await defaultWindowIcon()) ?? undefined,
        tooltip: 'Frost',
        menu,
        showMenuOnLeftClick: false,
        action: (event) => {
          if (event.type === 'Click' && event.button === 'Left' && event.buttonState === 'Up') void showMainWindow();
          if (event.type === 'DoubleClick') void showMainWindow();
        },
      });
    } catch (e) {
      console.warn('Трей недоступен:', e);
    }
  })();
  return trayPending;
}

let lastTip = '';
export async function updateTray(title: string | null, playing: boolean) {
  if (!tray) return;
  const tip = title ? `Frost: ${title}`.slice(0, 120) : 'Frost';
  if (tip !== lastTip) {
    lastTip = tip;
    await tray.setTooltip(tip).catch(() => {});
  }
  await playItem?.setText(playing ? 'Пауза' : 'Играть').catch(() => {});
}

/**
 * Крестик и Alt+F4: если включено «сворачивать в трей», окно прячется, музыка играет.
 * Иначе Frost выходит целиком (вместе с мини-плеером).
 */
export async function setupCloseBehavior(closeToTray: () => boolean, onHidden: () => void) {
  if (!isTauri || isMiniWindow) return;
  const win = getCurrentWindow();
  await win.onCloseRequested(async (event) => {
    event.preventDefault();
    if (closeToTray() && tray) {
      await win.hide();
      onHidden();
    } else {
      await invoke('app_quit');
    }
  });
}

// ---------------------------------------------------------------------------
// Автозапуск
// ---------------------------------------------------------------------------

export async function getAutostart(): Promise<boolean> {
  if (!isTauri) return false;
  try {
    return await autostartIsEnabled();
  } catch {
    return false;
  }
}

export async function setAutostart(on: boolean) {
  if (!isTauri) return;
  if (on) await autostartEnable();
  else await autostartDisable();
}

export async function launchedByAutostart(): Promise<boolean> {
  if (!isTauri) return false;
  try {
    const args = await invoke<string[]>('startup_args');
    return args.includes('--autostart');
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Глобальные горячие клавиши
// ---------------------------------------------------------------------------

export type GlobalAction = 'toggle' | 'next' | 'prev' | 'volumeUp' | 'volumeDown' | 'like' | 'mini' | 'show';

export const GLOBAL_ACTIONS: { id: GlobalAction; label: string }[] = [
  { id: 'toggle', label: 'Пауза и воспроизведение' },
  { id: 'next', label: 'Следующий трек' },
  { id: 'prev', label: 'Предыдущий трек' },
  { id: 'volumeUp', label: 'Громче' },
  { id: 'volumeDown', label: 'Тише' },
  { id: 'like', label: 'В избранное' },
  { id: 'mini', label: 'Мини-плеер' },
  { id: 'show', label: 'Показать Frost' },
];

export const DEFAULT_GLOBAL_KEYS: Record<GlobalAction, string> = {
  toggle: 'CommandOrControl+Alt+Space',
  next: 'CommandOrControl+Alt+Right',
  prev: 'CommandOrControl+Alt+Left',
  volumeUp: 'CommandOrControl+Alt+Up',
  volumeDown: 'CommandOrControl+Alt+Down',
  like: 'CommandOrControl+Alt+L',
  mini: 'CommandOrControl+Alt+M',
  show: 'CommandOrControl+Alt+F',
};

/** Регистрирует сочетания заново. Возвращает те, что заняты другими программами. */
export async function applyGlobalShortcuts(
  enabled: boolean,
  custom: Record<string, string>,
  run: (action: GlobalAction) => void,
): Promise<string[]> {
  if (!isTauri || isMiniWindow) return [];
  await unregisterAll().catch(() => {});
  if (!enabled) return [];
  const busy: string[] = [];
  for (const { id } of GLOBAL_ACTIONS) {
    const accel = custom[id] ?? DEFAULT_GLOBAL_KEYS[id];
    if (!accel) continue;
    try {
      await register(accel, (event) => {
        if (event.state === 'Pressed') run(id);
      });
    } catch {
      busy.push(accel);
    }
  }
  return busy;
}

// ---------------------------------------------------------------------------
// Связь главного окна и мини-плеера
// ---------------------------------------------------------------------------

export interface MiniState {
  title: string | null;
  artist: string | null;
  artwork: string | null;
  isPlaying: boolean;
  position: number;
  duration: number;
  liked: boolean;
  loading: boolean;
}

export type MiniCommand = 'toggle' | 'next' | 'prev' | 'like' | 'expand' | 'hello' | { seek: number };

export const MINI_STATE = 'frost://mini-state';
export const MINI_CMD = 'frost://mini-cmd';

export function sendMiniState(state: MiniState) {
  if (!isTauri) return;
  void emit(MINI_STATE, state).catch(() => {});
}

export function sendMiniCommand(cmd: MiniCommand) {
  if (!isTauri) return;
  void emit(MINI_CMD, cmd).catch(() => {});
}

export function onMiniState(handler: (state: MiniState) => void): Promise<UnlistenFn> {
  return listen<MiniState>(MINI_STATE, (e) => handler(e.payload));
}

export function onMiniCommand(handler: (cmd: MiniCommand) => void): Promise<UnlistenFn> {
  return listen<MiniCommand>(MINI_CMD, (e) => handler(e.payload));
}
