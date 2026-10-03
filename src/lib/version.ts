import pkg from '../../package.json';

/**
 * Сравнение версий для проверки обновлений: «v0.2.10» новее «0.2.9».
 * Префикс «v» не мешает; релиз новее своей предварительной версии (0.3.0 > 0.3.0-beta.2).
 */
interface Parsed {
  nums: number[];
  pre: string;
}

function parse(version: string): Parsed {
  const clean = version.trim().replace(/^v/i, '').split('+')[0];
  const dash = clean.indexOf('-');
  const core = dash < 0 ? clean : clean.slice(0, dash);
  const pre = dash < 0 ? '' : clean.slice(dash + 1);
  return { nums: core.split('.').map((x) => parseInt(x, 10) || 0), pre };
}

export function isNewer(latest: string, current: string): boolean {
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.nums.length, b.nums.length); i += 1) {
    const x = a.nums[i] ?? 0;
    const y = b.nums[i] ?? 0;
    if (x !== y) return x > y;
  }
  if (a.pre === b.pre) return false;
  if (!a.pre) return true;
  if (!b.pre) return false;
  return a.pre.localeCompare(b.pre, 'en', { numeric: true }) > 0;
}

/** Версия Frost из package.json (совпадает с Cargo.toml и tauri.conf.json). */
export const APP_VERSION: string = pkg.version;
