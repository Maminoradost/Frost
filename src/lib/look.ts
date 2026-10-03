/** Атрибуты оформления на <html>: их читают стили (tokens.css, appearance.css). Общие для главного окна и мини-плеера. */
export function applyLookAttributes(
  root: HTMLElement,
  look: { theme: 'dark' | 'light'; corner: string; textScale: string; motion: string; compact: boolean },
) {
  root.dataset.theme = look.theme;
  root.dataset.corner = look.corner;
  root.dataset.textScale = look.textScale;
  root.dataset.motion = look.motion;
  root.dataset.compact = look.compact ? 'true' : 'false';
}
