/**
 * Журнал для отчёта об ошибке: последние предупреждения и ошибки консоли,
 * необработанные исключения. Ничего не отправляет: отчёт копирует сам пользователь.
 */
export interface LogEntry {
  at: number;
  level: 'error' | 'warn' | 'info';
  text: string;
}

const MAX = 300;
const KEY = 'frost.log';
let entries: LogEntry[] = [];
let installed = false;
let saveTimer = 0;

function describe(value: unknown): string {
  if (value instanceof Error) {
    const stack = value.stack?.split('\n').slice(1, 4).join('\n') ?? '';
    return `${value.name}: ${value.message}${stack ? `\n${stack}` : ''}`;
  }
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Прячет токены и ключи, если они вдруг попали в текст ошибки. */
export function redact(text: string): string {
  return text
    .replace(/(token|api_key|sk|session|client_id|authorization)(["'=:\s]+)([\w.-]{6,})/gi, '$1$2***')
    .replace(/Token\s+[\w-]{8,}/g, 'Token ***');
}

function save() {
  if (saveTimer || typeof window === 'undefined') return;
  saveTimer = window.setTimeout(() => {
    saveTimer = 0;
    try {
      localStorage.setItem(KEY, JSON.stringify(entries.slice(-150)));
    } catch {
      /* хранилище переполнено: журнал не критичен */
    }
  }, 2000);
}

export function logEntry(level: LogEntry['level'], ...args: unknown[]) {
  entries.push({ at: Date.now(), level, text: redact(args.map(describe).join(' ')).slice(0, 2000) });
  if (entries.length > MAX) entries = entries.slice(-MAX);
  save();
}

export function installDiagnostics() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '[]') as LogEntry[];
    entries = Array.isArray(saved) ? saved.slice(-150) : [];
  } catch {
    entries = [];
  }
  logEntry('info', `Запуск: ${location.hash || 'главное окно'}`);
  for (const level of ['error', 'warn'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      logEntry(level, ...args);
      original(...args);
    };
  }
  window.addEventListener('error', (e) => logEntry('error', e.message || 'Ошибка', e.filename ? `(${e.filename}:${e.lineno})` : ''));
  window.addEventListener('unhandledrejection', (e) => logEntry('error', 'Необработанная ошибка:', e.reason));
}

export function recentLog(): LogEntry[] {
  return entries.slice();
}

export function clearLog() {
  entries = [];
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ничего страшного */
  }
}

function stamp(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Текст отчёта для Issues или Telegram: сведения о системе и последние записи журнала. */
export function buildReport(details: Record<string, string | number | boolean | null | undefined>, log = entries): string {
  const lines = ['### Отчёт Frost', ''];
  for (const [key, value] of Object.entries(details)) {
    if (value === undefined || value === null || value === '') continue;
    lines.push(`- ${key}: ${value}`);
  }
  if (typeof navigator !== 'undefined') {
    lines.push(`- WebView: ${navigator.userAgent}`);
    lines.push(`- Язык системы: ${navigator.language}`);
  }
  lines.push('', '```');
  for (const e of log.slice(-120)) lines.push(`${stamp(e.at)} ${e.level.toUpperCase().padEnd(5)} ${e.text}`);
  lines.push('```');
  return redact(lines.join('\n'));
}
