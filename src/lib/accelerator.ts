/** Сочетания клавиш для глобальных горячих клавиш (формат ускорителей Tauri). */

const NAMED: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  MediaPlayPause: 'MediaPlayPause',
  MediaTrackNext: 'MediaTrackNext',
  MediaTrackPrevious: 'MediaTrackPrevious',
  MediaStop: 'MediaStop',
};

export interface KeyLike {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/** Клавиша по физическому коду, чтобы раскладка (русская или английская) не мешала. */
function keyName(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Num${code.slice(6)}`;
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
  return NAMED[code] ?? null;
}

/** Строит ускоритель из нажатия. null, если это одна клавиша-модификатор или сочетание небезопасно. */
export function accelFromEvent(e: KeyLike): string | null {
  const key = keyName(e.code);
  if (!key) return null;
  const mods: string[] = [];
  if (e.ctrlKey) mods.push('CommandOrControl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  const standalone = /^F\d+$/.test(key) || key.startsWith('Media');
  // Без модификатора глобальная клавиша перехватит обычный набор текста во всей системе
  if (!mods.length && !standalone) return null;
  if (mods.length === 1 && mods[0] === 'Shift' && !standalone) return null;
  return [...mods, key].join('+');
}

/** Человеческая запись: Ctrl + Alt + → */
export function accelLabel(accel: string): string {
  const pretty: Record<string, string> = {
    CommandOrControl: 'Ctrl',
    Super: 'Win',
    Up: '↑',
    Down: '↓',
    Left: '←',
    Right: '→',
    Space: 'Пробел',
    MediaPlayPause: 'Play/Pause',
    MediaTrackNext: 'Next',
    MediaTrackPrevious: 'Prev',
  };
  return accel
    .split('+')
    .map((p) => pretty[p] ?? p)
    .join(' + ');
}
