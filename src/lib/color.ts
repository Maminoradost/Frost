import { convertFileSrc } from '@tauri-apps/api/core';
import type { ThemeMode } from './types';
import { clamp } from './format';

export const DEFAULT_ACCENT = '#8b9cff';

const cache = new Map<string, string>();

function base64url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Картинка через локальный прокси: с CORS-заголовками, чтобы canvas не был «tainted». */
export function proxiedImage(url: string): string {
  return `${convertFileSrc('', 'frost')}img/${base64url(url)}`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue(p, q, h + 1 / 3) * 255),
    Math.round(hue(p, q, h) * 255),
    Math.round(hue(p, q, h - 1 / 3) * 255),
  ];
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Доминирующий «живой» цвет обложки: гистограмма оттенков с весом по насыщенности,
 * затем яркость подгоняется под тему, чтобы акцент всегда был читаемым.
 */
export async function extractAccent(url: string | null | undefined, theme: ThemeMode): Promise<string> {
  if (!url) return DEFAULT_ACCENT;
  const cacheKey = `${theme}|${url}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  try {
    const img = await loadImage(proxiedImage(url));
    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return DEFAULT_ACCENT;
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    const buckets = Array.from({ length: 18 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const [h, s, l] = rgbToHsl(r, g, b);
      const w = s * s * Math.max(0, 1 - Math.abs(l - 0.5) * 1.8);
      if (w <= 0.01) continue;
      const bucket = buckets[Math.min(17, Math.floor(h * 18))];
      bucket.w += w;
      bucket.r += r * w;
      bucket.g += g * w;
      bucket.b += b * w;
    }
    const best = buckets.reduce((a, b) => (b.w > a.w ? b : a));
    let color: string;
    if (best.w < 1.5) {
      color = theme === 'dark' ? '#a9b1c9' : '#5b6275';
    } else {
      const [h, s] = rgbToHsl(best.r / best.w, best.g / best.w, best.b / best.w);
      const light = theme === 'dark' ? 0.66 : 0.44;
      const [r, g, b] = hslToRgb(h, clamp(s * 1.15, 0.5, 0.9), light);
      color = rgbToHex(r, g, b);
    }
    cache.set(cacheKey, color);
    return color;
  } catch {
    return DEFAULT_ACCENT;
  }
}

export function applyAccent(color: string) {
  const [r, g, b] = hexToRgb(color);
  const root = document.documentElement;
  root.style.setProperty('--accent', color);
  root.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
