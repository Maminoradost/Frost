import { Effect, getCurrentWindow } from '@tauri-apps/api/window';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { BackdropEffect } from './types';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
export const appWindow = isTauri ? getCurrentWindow() : null;

/** Системный фон окна: Acrylic / Mica / Mica Alt (Tabbed) или без эффекта. */
export async function applyBackdrop(effect: BackdropEffect) {
  if (!appWindow) return;
  try {
    if (effect === 'none') {
      await appWindow.clearEffects();
      return;
    }
    // glass: размытие за окном (SetWindowCompositionAttribute). В отличие от системного акрила
    // Windows 11 не превращается в сплошную заливку, когда окно не в фокусе.
    const map = { glass: Effect.Blur, acrylic: Effect.Acrylic, mica: Effect.Mica, tabbed: Effect.Tabbed };
    await appWindow.setEffects({ effects: [map[effect]] });
  } catch (e) {
    console.warn('setEffects failed', e);
  }
}

/** null: окно следует системной теме Windows. */
export async function applyWindowTheme(theme: 'dark' | 'light' | null) {
  if (!appWindow) return;
  try {
    await appWindow.setTheme(theme);
  } catch (e) {
    console.warn('setTheme failed', e);
  }
}

export async function openExternal(url: string) {
  try {
    await openUrl(url);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}
