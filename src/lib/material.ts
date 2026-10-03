/**
 * Material You (Material Design 3): динамические цветовые схемы.
 *
 * Всё считается в HCT, как в material-color-utilities от Google:
 * оттенок и насыщенность берутся из CAM16, тон — это светлота L* из CIELAB.
 * Варианты схем (Tonal Spot, Vibrant, Expressive, Fidelity, Content, Rainbow,
 * Fruit Salad, Neutral, Monochrome), тоны ролей, пары «роль ↔ контейнер»
 * и кривые контраста (стандартный, средний, высокий) повторяют MaterialDynamicColors.
 */

type Rgb = [number, number, number];
/** [оттенок 0…360, насыщенность, тон 0…100] */
export type Hct = [number, number, number];

const clamp = (lo: number, hi: number, v: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const sanitize = (deg: number) => ((deg % 360) + 360) % 360;

// ───────────────────────── sRGB ⇄ XYZ ⇄ L* ─────────────────────────

const SRGB_TO_XYZ = [
  [0.41233895, 0.35762064, 0.18051042],
  [0.2126, 0.7152, 0.0722],
  [0.01932141, 0.11916382, 0.95034478],
];
const XYZ_TO_SRGB = [
  [3.2413774792388685, -1.5376652402851851, -0.49885366846268053],
  [-0.9691452513005321, 1.8758853451067872, 0.04156585323298888],
  [0.05562093689691305, -0.20395524564742123, 1.0571799111220335],
];
const WHITE_D65 = [95.047, 100.0, 108.883];

/** 0…255 → линейная яркость канала 0…100. */
function linearized(c: number): number {
  const v = c / 255;
  return (v <= 0.040449936 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4) * 100;
}
/** Линейная 0…100 → 0…255 (с округлением и обрезкой по охвату sRGB). */
function delinearized(c: number): number {
  const v = c / 100;
  const d = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return clamp(0, 255, Math.round(d * 255));
}
function labF(t: number): number {
  return t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116;
}
function labInvf(ft: number): number {
  const ft3 = ft * ft * ft;
  return ft3 > 216 / 24389 ? ft3 : (116 * ft - 16) / (24389 / 27);
}
export const yFromLstar = (l: number) => 100 * labInvf((l + 16) / 116);
export const lstarFromY = (y: number) => labF(y / 100) * 116 - 16;

function xyzFromRgb([r, g, b]: Rgb): [number, number, number] {
  const lr = linearized(r);
  const lg = linearized(g);
  const lb = linearized(b);
  const m = SRGB_TO_XYZ;
  return [
    m[0][0] * lr + m[0][1] * lg + m[0][2] * lb,
    m[1][0] * lr + m[1][1] * lg + m[1][2] * lb,
    m[2][0] * lr + m[2][1] * lg + m[2][2] * lb,
  ];
}
function rgbFromXyz(x: number, y: number, z: number): Rgb {
  const m = XYZ_TO_SRGB;
  return [
    delinearized(m[0][0] * x + m[0][1] * y + m[0][2] * z),
    delinearized(m[1][0] * x + m[1][1] * y + m[1][2] * z),
    delinearized(m[2][0] * x + m[2][1] * y + m[2][2] * z),
  ];
}
const lstarFromRgb = (rgb: Rgb) => lstarFromY(xyzFromRgb(rgb)[1]);
function rgbFromLstar(l: number): Rgb {
  const c = delinearized(yFromLstar(l));
  return [c, c, c];
}
function labFromRgb(rgb: Rgb): [number, number, number] {
  const [x, y, z] = xyzFromRgb(rgb);
  const fx = labF(x / WHITE_D65[0]);
  const fy = labF(y / WHITE_D65[1]);
  const fz = labF(z / WHITE_D65[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function hexToRgb(hex: string): Rgb {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean.padEnd(6, '0');
  const n = parseInt(full.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const h = (v: number) => Math.round(clamp(0, 255, v)).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** CIE LCh(ab): [L, C, H]. */
export function rgbToLch(rgb: Rgb): [number, number, number] {
  const [L, a, b] = labFromRgb(rgb);
  return [L, Math.hypot(a, b), sanitize((Math.atan2(b, a) * 180) / Math.PI)];
}

// ───────────────────────── CAM16 ─────────────────────────

/** Стандартные условия наблюдения sRGB (как ViewingConditions.DEFAULT). */
const VC = (() => {
  const adapting = ((200 / Math.PI) * yFromLstar(50)) / 100;
  const surround = 2;
  const [xw, yw, zw] = WHITE_D65;
  const rW = xw * 0.401288 + yw * 0.650173 + zw * -0.051461;
  const gW = xw * -0.250268 + yw * 1.204414 + zw * 0.045854;
  const bW = xw * -0.002079 + yw * 0.048952 + zw * 0.953127;
  const f = 0.8 + surround / 10;
  const c = f >= 0.9 ? lerp(0.59, 0.69, (f - 0.9) * 10) : lerp(0.525, 0.59, (f - 0.8) * 10);
  const d = clamp(0, 1, f * (1 - (1 / 3.6) * Math.exp((-adapting - 42) / 92)));
  const rgbD = [d * (100 / rW) + 1 - d, d * (100 / gW) + 1 - d, d * (100 / bW) + 1 - d];
  const k = 1 / (5 * adapting + 1);
  const k4 = k * k * k * k;
  const k4F = 1 - k4;
  const fl = k4 * adapting + 0.1 * k4F * k4F * Math.cbrt(5 * adapting);
  const n = yFromLstar(50) / yw;
  const z = 1.48 + Math.sqrt(n);
  const nbb = 0.725 / Math.pow(n, 0.2);
  const factors = [rW, gW, bW].map((w, i) => Math.pow((fl * rgbD[i] * w) / 100, 0.42));
  const rgbA = factors.map((v) => (400 * v) / (v + 27.13));
  const aw = (2 * rgbA[0] + rgbA[1] + 0.05 * rgbA[2]) * nbb;
  return { n, aw, nbb, ncb: nbb, c, nc: f, rgbD, fl, fLRoot: Math.pow(fl, 0.25), z };
})();

interface Cam {
  hue: number;
  chroma: number;
  j: number;
  jstar: number;
  astar: number;
  bstar: number;
}

function camUcs(hue: number, chroma: number, j: number): Cam {
  const m = chroma * VC.fLRoot;
  const hr = (hue * Math.PI) / 180;
  const jstar = ((1 + 100 * 0.007) * j) / (1 + 0.007 * j);
  const mstar = (1 / 0.0228) * Math.log(1 + 0.0228 * m);
  return { hue, chroma, j, jstar, astar: mstar * Math.cos(hr), bstar: mstar * Math.sin(hr) };
}

function camFromRgb(rgb: Rgb): Cam {
  const [x, y, z] = xyzFromRgb(rgb);
  const rC = 0.401288 * x + 0.650173 * y - 0.051461 * z;
  const gC = -0.250268 * x + 1.204414 * y + 0.045854 * z;
  const bC = -0.002079 * x + 0.048952 * y + 0.953127 * z;
  const adapt = (v: number, i: number) => {
    const d = VC.rgbD[i] * v;
    const af = Math.pow((VC.fl * Math.abs(d)) / 100, 0.42);
    return (Math.sign(d) * 400 * af) / (af + 27.13);
  };
  const rA = adapt(rC, 0);
  const gA = adapt(gC, 1);
  const bA = adapt(bC, 2);
  const a = (11 * rA - 12 * gA + bA) / 11;
  const b = (rA + gA - 2 * bA) / 9;
  const u = (20 * rA + 20 * gA + 21 * bA) / 20;
  const p2 = (40 * rA + 20 * gA + bA) / 20;
  const hue = sanitize((Math.atan2(b, a) * 180) / Math.PI);
  const ac = p2 * VC.nbb;
  const j = 100 * Math.pow(ac / VC.aw, VC.c * VC.z);
  const huePrime = hue < 20.14 ? hue + 360 : hue;
  const eHue = 0.25 * (Math.cos((huePrime * Math.PI) / 180 + 2) + 3.8);
  const p1 = (50000 / 13) * eHue * VC.nc * VC.ncb;
  const t = (p1 * Math.hypot(a, b)) / (u + 0.305);
  const alpha = Math.pow(t, 0.9) * Math.pow(1.64 - Math.pow(0.29, VC.n), 0.73);
  return camUcs(hue, alpha * Math.sqrt(j / 100), j);
}

function rgbFromCam(cam: Cam): Rgb {
  const alpha = cam.chroma === 0 || cam.j === 0 ? 0 : cam.chroma / Math.sqrt(cam.j / 100);
  const t = Math.pow(alpha / Math.pow(1.64 - Math.pow(0.29, VC.n), 0.73), 1 / 0.9);
  const hr = (cam.hue * Math.PI) / 180;
  const eHue = 0.25 * (Math.cos(hr + 2) + 3.8);
  const ac = VC.aw * Math.pow(cam.j / 100, 1 / VC.c / VC.z);
  const p1 = eHue * (50000 / 13) * VC.nc * VC.ncb;
  const p2 = ac / VC.nbb;
  const hSin = Math.sin(hr);
  const hCos = Math.cos(hr);
  const gamma = (23 * (p2 + 0.305) * t) / (23 * p1 + 11 * t * hCos + 108 * t * hSin);
  const a = gamma * hCos;
  const b = gamma * hSin;
  const rA = (460 * p2 + 451 * a + 288 * b) / 1403;
  const gA = (460 * p2 - 891 * a - 261 * b) / 1403;
  const bA = (460 * p2 - 220 * a - 6300 * b) / 1403;
  const inv = (v: number, i: number) => {
    const base = Math.max(0, (27.13 * Math.abs(v)) / (400 - Math.abs(v)));
    return (Math.sign(v) * (100 / VC.fl) * Math.pow(base, 1 / 0.42)) / VC.rgbD[i];
  };
  const rF = inv(rA, 0);
  const gF = inv(gA, 1);
  const bF = inv(bA, 2);
  return rgbFromXyz(
    1.86206786 * rF - 1.01125463 * gF + 0.14918677 * bF,
    0.38752654 * rF + 0.62144744 * gF - 0.00897398 * bF,
    -0.0158415 * rF - 0.03412294 * gF + 1.04996444 * bF,
  );
}

function camDistance(a: Cam, b: Cam): number {
  const d = Math.hypot(a.jstar - b.jstar, a.astar - b.astar, a.bstar - b.bstar);
  return 1.41 * Math.pow(d, 0.63);
}

// ───────────────────────── HCT ─────────────────────────

/** Лучший цвет sRGB с оттенком hue и тоном lstar при насыщенности chroma (или null). */
function findByJ(hue: number, chroma: number, lstar: number): Rgb | null {
  let low = 0;
  let high = 100;
  let bestdL = 1000;
  let bestdE = 1000;
  let best: Rgb | null = null;
  while (Math.abs(low - high) > 0.01) {
    const mid = low + (high - low) / 2;
    const clipped = rgbFromCam(camUcs(hue, chroma, mid));
    const clippedL = lstarFromRgb(clipped);
    const dL = Math.abs(lstar - clippedL);
    if (dL < 0.2) {
      const cam = camFromRgb(clipped);
      const dE = camDistance(cam, camUcs(hue, cam.chroma, cam.j));
      if (dE <= 1 && dE <= bestdE) {
        bestdL = dL;
        bestdE = dE;
        best = clipped;
      }
    }
    if (bestdL === 0 && bestdE === 0) break;
    if (clippedL < lstar) low = mid;
    else high = mid;
  }
  return best;
}

/** HCT → sRGB: если насыщенность недостижима, она уменьшается до границы охвата. */
export function rgbFromHct(hue: number, chroma: number, tone: number): Rgb {
  if (chroma < 1 || Math.round(tone) <= 0 || Math.round(tone) >= 100) return rgbFromLstar(tone);
  hue = sanitize(hue);
  let high = chroma;
  let mid = chroma;
  let low = 0;
  let first = true;
  let answer: Rgb | null = null;
  while (Math.abs(low - high) >= 0.4) {
    const possible = findByJ(hue, mid, tone);
    if (first) {
      if (possible) return possible;
      first = false;
      mid = low + (high - low) / 2;
      continue;
    }
    if (possible) {
      answer = possible;
      low = mid;
    } else {
      high = mid;
    }
    mid = low + (high - low) / 2;
  }
  return answer ?? rgbFromLstar(tone);
}

export function hctFromRgb(rgb: Rgb): Hct {
  const cam = camFromRgb(rgb);
  return [cam.hue, cam.chroma, lstarFromRgb(rgb)];
}
export const hctFromHex = (hex: string): Hct => hctFromRgb(hexToRgb(hex));
/** Реальный цвет HCT после попадания в охват sRGB. */
const solved = (hue: number, chroma: number, tone: number): Hct => hctFromRgb(rgbFromHct(hue, chroma, tone));

/** Цвет с оттенком, насыщенностью и тоном HCT. */
export function tone(hue: number, chroma: number, t: number): string {
  return rgbToHex(rgbFromHct(hue, chroma, t));
}

export interface TonalPalette {
  hue: number;
  chroma: number;
  tone: (t: number) => string;
}

export function palette(hue: number, chroma: number): TonalPalette {
  const cache = new Map<number, string>();
  return {
    hue,
    chroma,
    tone: (t: number) => {
      const key = Math.round(clamp(0, 100, t) * 100) / 100;
      let hit = cache.get(key);
      if (!hit) {
        hit = tone(hue, chroma, key);
        cache.set(key, hit);
      }
      return hit;
    },
  };
}

// ───────────────────────── Контраст ─────────────────────────

const ratioOfYs = (y1: number, y2: number) => {
  const lighter = Math.max(y1, y2);
  const darker = lighter === y2 ? y1 : y2;
  return (lighter + 5) / (darker + 5);
};
export const ratioOfTones = (a: number, b: number) => ratioOfYs(yFromLstar(clamp(0, 100, a)), yFromLstar(clamp(0, 100, b)));

function lighter(t: number, ratio: number): number {
  if (t < 0 || t > 100) return -1;
  const darkY = yFromLstar(t);
  const lightY = ratio * (darkY + 5) - 5;
  const real = ratioOfYs(lightY, darkY);
  if (real < ratio && Math.abs(real - ratio) > 0.04) return -1;
  const value = lstarFromY(lightY) + 0.4;
  return value < 0 || value > 100 ? -1 : value;
}
function darker(t: number, ratio: number): number {
  if (t < 0 || t > 100) return -1;
  const lightY = yFromLstar(t);
  const darkY = (lightY + 5) / ratio - 5;
  const real = ratioOfYs(lightY, darkY);
  if (real < ratio && Math.abs(real - ratio) > 0.04) return -1;
  const value = lstarFromY(darkY) - 0.4;
  return value < 0 || value > 100 ? -1 : value;
}
const lighterUnsafe = (t: number, r: number) => {
  const v = lighter(t, r);
  return v < 0 ? 100 : v;
};
const darkerUnsafe = (t: number, r: number) => {
  const v = darker(t, r);
  return v < 0 ? 0 : v;
};
const prefersLightForeground = (t: number) => Math.round(t) < 60;

/** Тон текста поверх фона bgTone с контрастом не ниже ratio (DynamicColor.foregroundTone). */
export function foregroundTone(bgTone: number, ratio: number): number {
  const lt = lighterUnsafe(bgTone, ratio);
  const dt = darkerUnsafe(bgTone, ratio);
  const lr = ratioOfTones(lt, bgTone);
  const dr = ratioOfTones(dt, bgTone);
  if (prefersLightForeground(bgTone)) {
    const negligible = Math.abs(lr - dr) < 0.1 && lr < ratio && dr < ratio;
    return lr >= ratio || lr >= dr || negligible ? lt : dt;
  }
  return dr >= ratio || dr >= lr ? dt : lt;
}

// ───────────────────────── Температура цвета (для Fidelity и Content) ─────────────────────────

function rawTemperature(rgb: Rgb): number {
  const [, a, b] = labFromRgb(rgb);
  const hue = sanitize((Math.atan2(b, a) * 180) / Math.PI);
  const chroma = Math.hypot(a, b);
  return -0.5 + 0.02 * Math.pow(chroma, 1.07) * Math.cos((sanitize(hue - 50) * Math.PI) / 180);
}

const isBetween = (angle: number, a: number, b: number) => (a < b ? a <= angle && angle <= b : a <= angle || angle <= b);

interface Temp {
  hct: Hct;
  temp: number;
}

/** TemperatureCache: дополнительный и аналоговые цвета по «цветовой температуре». */
function temperatures(input: Hct) {
  const byHue: Temp[] = [];
  for (let h = 0; h < 360; h += 1) {
    const rgb = rgbFromHct(h, input[1], input[2]);
    byHue.push({ hct: hctFromRgb(rgb), temp: rawTemperature(rgb) });
  }
  const inputTemp = rawTemperature(rgbFromHct(input[0], input[1], input[2]));
  const all = [...byHue, { hct: input, temp: inputTemp }].sort((x, y) => x.temp - y.temp);
  const coldest = all[0];
  const warmest = all[all.length - 1];
  const range = warmest.temp - coldest.temp;
  const relative = (t: number) => (range === 0 ? 0.5 : (t - coldest.temp) / range);

  const complement = (): Hct => {
    const fromColdToWarm = isBetween(input[0], coldest.hct[0], warmest.hct[0]);
    const start = fromColdToWarm ? warmest.hct[0] : coldest.hct[0];
    const end = fromColdToWarm ? coldest.hct[0] : warmest.hct[0];
    let best = byHue[Math.round(input[0]) % 360].hct;
    let smallest = 1000;
    const target = 1 - relative(inputTemp);
    for (let add = 0; add <= 360; add += 1) {
      const hue = sanitize(start + add);
      if (!isBetween(hue, start, end)) continue;
      const candidate = byHue[Math.round(hue) % 360];
      const error = Math.abs(target - relative(candidate.temp));
      if (error < smallest) {
        smallest = error;
        best = candidate.hct;
      }
    }
    return best;
  };

  const analogous = (count = 5, divisions = 12): Hct[] => {
    const startHue = Math.round(input[0]) % 360;
    const start = byHue[startHue];
    let last = relative(start.temp);
    let total = 0;
    for (let i = 0; i < 360; i += 1) {
      const t = relative(byHue[(startHue + i) % 360].temp);
      total += Math.abs(t - last);
      last = t;
    }
    const step = total / divisions;
    const colors: Hct[] = [start.hct];
    let acc = 0;
    last = relative(start.temp);
    let add = 1;
    while (colors.length < divisions) {
      const c = byHue[(startHue + add) % 360];
      const t = relative(c.temp);
      acc += Math.abs(t - last);
      let satisfied = acc >= colors.length * step;
      let extra = 1;
      while (satisfied && colors.length < divisions) {
        colors.push(c.hct);
        satisfied = acc >= (colors.length + extra) * step;
        extra += 1;
      }
      last = t;
      add += 1;
      if (add > 360) {
        while (colors.length < divisions) colors.push(c.hct);
        break;
      }
    }
    const answers: Hct[] = [input];
    const ccw = Math.floor((count - 1) / 2);
    for (let i = 1; i <= ccw; i += 1) {
      let index = -i;
      while (index < 0) index += colors.length;
      answers.unshift(colors[index % colors.length]);
    }
    const cw = count - ccw - 1;
    for (let i = 1; i <= cw; i += 1) answers.push(colors[i % colors.length]);
    return answers;
  };

  return { complement, analogous };
}

/** DislikeAnalyzer: болотно-жёлтые тёмные цвета (оттенок 90…111) осветляются до T70. */
function fixIfDisliked(hct: Hct): Hct {
  const [h, c, t] = hct.map(Math.round);
  if (h >= 90 && h <= 111 && c > 16 && t < 65) return solved(hct[0], hct[1], 70);
  return hct;
}

// ───────────────────────── Варианты схем ─────────────────────────

export type SchemeStyle =
  | 'tonalSpot'
  | 'vibrant'
  | 'expressive'
  | 'fidelity'
  | 'content'
  | 'rainbow'
  | 'fruitSalad'
  | 'neutral'
  | 'monochrome';
export type ContrastLevel = 'standard' | 'medium' | 'high';

/** Уровни контраста Material 3 (как в Android 14+): 0, 0.5, 1. */
export const CONTRAST_VALUES: Record<ContrastLevel, number> = { standard: 0, medium: 0.5, high: 1 };

export const SCHEME_STYLES: { id: SchemeStyle; label: string; hint: string }[] = [
  { id: 'tonalSpot', label: 'Tonal Spot', hint: 'Стандарт Android: спокойные, сдержанные цвета' },
  { id: 'vibrant', label: 'Vibrant', hint: 'Максимум насыщенности, яркий основной цвет' },
  { id: 'expressive', label: 'Expressive', hint: 'Оттенки смещены по кругу: неожиданные сочетания' },
  { id: 'fidelity', label: 'Fidelity', hint: 'Точно повторяет цвет обложки, даже очень яркий' },
  { id: 'content', label: 'Content', hint: 'Цвет обложки и соседний по температуре' },
  { id: 'rainbow', label: 'Rainbow', hint: 'Цветные акценты на чисто серых поверхностях' },
  { id: 'fruitSalad', label: 'Fruit Salad', hint: 'Игривая палитра со сдвигом оттенка' },
  { id: 'neutral', label: 'Neutral', hint: 'Почти серая схема с лёгким оттенком' },
  { id: 'monochrome', label: 'Monochrome', hint: 'Только оттенки серого' },
];

function rotatedHue(source: number, hues: number[], rotations: number[]): number {
  for (let i = 0; i <= hues.length - 2; i += 1) {
    if (hues[i] < source && source < hues[i + 1]) return sanitize(source + rotations[i]);
  }
  return source;
}

const VIBRANT_HUES = [0, 41, 61, 101, 131, 181, 251, 301, 360];
const VIBRANT_SECONDARY = [18, 15, 10, 12, 15, 18, 15, 12, 12];
const VIBRANT_TERTIARY = [35, 30, 20, 25, 30, 35, 30, 25, 25];
const EXPRESSIVE_HUES = [0, 21, 51, 121, 151, 191, 271, 321, 360];
const EXPRESSIVE_SECONDARY = [45, 95, 45, 20, 45, 90, 45, 45, 45];
const EXPRESSIVE_TERTIARY = [120, 120, 20, 45, 20, 15, 20, 120, 120];

interface Palettes {
  p: TonalPalette;
  s: TonalPalette;
  t: TonalPalette;
  n: TonalPalette;
  nv: TonalPalette;
  e: TonalPalette;
}

const tempCache = new Map<string, ReturnType<typeof temperatures>>();
function tempsFor(src: Hct) {
  const key = src.map((v) => v.toFixed(2)).join(',');
  let hit = tempCache.get(key);
  if (!hit) {
    hit = temperatures(src);
    if (tempCache.size > 24) tempCache.clear();
    tempCache.set(key, hit);
  }
  return hit;
}

function palettesFor(style: SchemeStyle, src: Hct): Palettes {
  const [h, c] = src;
  const e = palette(25, 84);
  switch (style) {
    case 'vibrant':
      return {
        p: palette(h, 200),
        s: palette(rotatedHue(h, VIBRANT_HUES, VIBRANT_SECONDARY), 24),
        t: palette(rotatedHue(h, VIBRANT_HUES, VIBRANT_TERTIARY), 32),
        n: palette(h, 10),
        nv: palette(h, 12),
        e,
      };
    case 'expressive':
      return {
        p: palette(sanitize(h + 240), 40),
        s: palette(rotatedHue(h, EXPRESSIVE_HUES, EXPRESSIVE_SECONDARY), 24),
        t: palette(rotatedHue(h, EXPRESSIVE_HUES, EXPRESSIVE_TERTIARY), 32),
        n: palette(sanitize(h + 15), 8),
        nv: palette(sanitize(h + 15), 12),
        e,
      };
    case 'fidelity':
    case 'content': {
      const temps = tempsFor(src);
      const third = fixIfDisliked(style === 'fidelity' ? temps.complement() : temps.analogous(3, 6)[2]);
      return {
        p: palette(h, c),
        s: palette(h, Math.max(c - 32, c * 0.5)),
        t: palette(third[0], third[1]),
        n: palette(h, c / 8),
        nv: palette(h, c / 8 + 4),
        e,
      };
    }
    case 'rainbow':
      return { p: palette(h, 48), s: palette(h, 16), t: palette(sanitize(h + 60), 24), n: palette(h, 0), nv: palette(h, 0), e };
    case 'fruitSalad':
      return {
        p: palette(sanitize(h - 50), 48),
        s: palette(sanitize(h - 50), 36),
        t: palette(h, 36),
        n: palette(h, 10),
        nv: palette(h, 16),
        e,
      };
    case 'neutral':
      return { p: palette(h, 12), s: palette(h, 8), t: palette(h, 16), n: palette(h, 2), nv: palette(h, 2), e };
    case 'monochrome':
      return { p: palette(h, 0), s: palette(h, 0), t: palette(h, 0), n: palette(h, 0), nv: palette(h, 0), e };
    case 'tonalSpot':
    default:
      return { p: palette(h, 36), s: palette(h, 16), t: palette(sanitize(h + 60), 24), n: palette(h, 6), nv: palette(h, 8), e };
  }
}

// ───────────────────────── Динамические роли (MaterialDynamicColors) ─────────────────────────

interface Ctx extends Palettes {
  dark: boolean;
  /** −1…1 */
  contrast: number;
  style: SchemeStyle;
  source: Hct;
}

type Curve = [number, number, number, number];
/** ContrastCurve.get: low (−1), normal (0), medium (0.5), high (1). */
function curve([low, normal, medium, high]: Curve, level: number): number {
  if (level <= -1) return low;
  if (level < 0) return lerp(low, normal, level + 1);
  if (level < 0.5) return lerp(normal, medium, level / 0.5);
  if (level < 1) return lerp(medium, high, (level - 0.5) / 0.5);
  return high;
}

interface Role {
  name: string;
  palette: (s: Ctx) => TonalPalette;
  tone: (s: Ctx) => number;
  isBackground?: boolean;
  background?: (s: Ctx) => Role;
  contrastCurve?: Curve;
  pair?: () => { a: Role; b: Role; delta: number };
}

const isFidelity = (s: Ctx) => s.style === 'fidelity' || s.style === 'content';
const isMono = (s: Ctx) => s.style === 'monochrome';

/** findDesiredChromaByTone: тон, на котором палитра набирает нужную насыщенность. */
function desiredChromaTone(hue: number, chroma: number, start: number, byDecreasingTone: boolean): number {
  let answer = start;
  let closest = solved(hue, chroma, start);
  if (closest[1] < chroma) {
    let peak = closest[1];
    while (closest[1] < chroma) {
      answer += byDecreasingTone ? -1 : 1;
      if (answer <= 0 || answer >= 100) break;
      const candidate = solved(hue, chroma, answer);
      if (peak > candidate[1]) break;
      if (Math.abs(candidate[1] - chroma) < 0.4) break;
      if (Math.abs(candidate[1] - chroma) < Math.abs(closest[1] - chroma)) closest = candidate;
      peak = Math.max(peak, candidate[1]);
    }
  }
  return answer;
}

const R = {} as Record<string, Role>;
const highest = (s: Ctx) => (s.dark ? R.surfaceBright : R.surfaceDim);
const neutral = (s: Ctx) => s.n;
const neutralVariant = (s: Ctx) => s.nv;
const pal = (k: 'p' | 's' | 't' | 'e') => (s: Ctx) => s[k];
const bg = (name: string) => () => R[name];
const surfaceRole = (name: string, tone: (s: Ctx) => number): Role => ({ name, palette: neutral, tone, isBackground: true });
const pairOf = (container: string, accent: string) => () => ({ a: R[container], b: R[accent], delta: 10 });

const ROLES: Role[] = [
  surfaceRole('surface', (s) => (s.dark ? 6 : 98)),
  surfaceRole('surfaceDim', (s) => (s.dark ? 6 : curve([87, 87, 80, 75], s.contrast))),
  surfaceRole('surfaceBright', (s) => (s.dark ? curve([24, 24, 29, 34], s.contrast) : 98)),
  surfaceRole('surfaceContainerLowest', (s) => (s.dark ? curve([4, 4, 2, 0], s.contrast) : 100)),
  surfaceRole('surfaceContainerLow', (s) => (s.dark ? curve([10, 10, 11, 12], s.contrast) : curve([96, 96, 96, 95], s.contrast))),
  surfaceRole('surfaceContainer', (s) => (s.dark ? curve([12, 12, 16, 20], s.contrast) : curve([94, 94, 92, 90], s.contrast))),
  surfaceRole('surfaceContainerHigh', (s) => (s.dark ? curve([17, 17, 21, 25], s.contrast) : curve([92, 92, 88, 85], s.contrast))),
  surfaceRole('surfaceContainerHighest', (s) => (s.dark ? curve([22, 22, 26, 30], s.contrast) : curve([90, 90, 84, 80], s.contrast))),
  { name: 'onSurface', palette: neutral, tone: (s) => (s.dark ? 90 : 10), background: highest, contrastCurve: [4.5, 7, 11, 21] },
  { name: 'surfaceVariant', palette: neutralVariant, tone: (s) => (s.dark ? 30 : 90), isBackground: true },
  { name: 'onSurfaceVariant', palette: neutralVariant, tone: (s) => (s.dark ? 80 : 30), background: highest, contrastCurve: [3, 4.5, 7, 11] },
  { name: 'inverseSurface', palette: neutral, tone: (s) => (s.dark ? 90 : 20) },
  { name: 'inverseOnSurface', palette: neutral, tone: (s) => (s.dark ? 20 : 95), background: bg('inverseSurface'), contrastCurve: [4.5, 7, 11, 21] },
  { name: 'outline', palette: neutralVariant, tone: (s) => (s.dark ? 60 : 50), background: highest, contrastCurve: [1.5, 3, 4.5, 7] },
  { name: 'outlineVariant', palette: neutralVariant, tone: (s) => (s.dark ? 30 : 80), background: highest, contrastCurve: [1, 1, 3, 4.5] },
  { name: 'surfaceTint', palette: pal('p'), tone: (s) => (s.dark ? 80 : 40), isBackground: true },

  {
    name: 'primary',
    palette: pal('p'),
    tone: (s) => (isMono(s) ? (s.dark ? 100 : 0) : s.dark ? 80 : 40),
    isBackground: true,
    background: highest,
    contrastCurve: [3, 4.5, 7, 7],
    pair: pairOf('primaryContainer', 'primary'),
  },
  {
    name: 'onPrimary',
    palette: pal('p'),
    tone: (s) => (isMono(s) ? (s.dark ? 10 : 90) : s.dark ? 20 : 100),
    background: bg('primary'),
    contrastCurve: [4.5, 7, 11, 21],
  },
  {
    name: 'primaryContainer',
    palette: pal('p'),
    tone: (s) => (isFidelity(s) ? s.source[2] : isMono(s) ? (s.dark ? 85 : 25) : s.dark ? 30 : 90),
    isBackground: true,
    background: highest,
    contrastCurve: [1, 1, 3, 4.5],
    pair: pairOf('primaryContainer', 'primary'),
  },
  {
    name: 'onPrimaryContainer',
    palette: pal('p'),
    tone: (s) => (isFidelity(s) ? foregroundTone(toneOf(R.primaryContainer, s), 4.5) : isMono(s) ? (s.dark ? 0 : 100) : s.dark ? 90 : 10),
    background: bg('primaryContainer'),
    contrastCurve: [4.5, 7, 11, 21],
  },
  { name: 'inversePrimary', palette: pal('p'), tone: (s) => (s.dark ? 40 : 80), background: bg('inverseSurface'), contrastCurve: [3, 4.5, 7, 7] },

  {
    name: 'secondary',
    palette: pal('s'),
    tone: (s) => (s.dark ? 80 : 40),
    isBackground: true,
    background: highest,
    contrastCurve: [3, 4.5, 7, 7],
    pair: pairOf('secondaryContainer', 'secondary'),
  },
  {
    name: 'onSecondary',
    palette: pal('s'),
    tone: (s) => (isMono(s) ? (s.dark ? 10 : 100) : s.dark ? 20 : 100),
    background: bg('secondary'),
    contrastCurve: [4.5, 7, 11, 21],
  },
  {
    name: 'secondaryContainer',
    palette: pal('s'),
    tone: (s) => {
      const initial = s.dark ? 30 : 90;
      if (isMono(s)) return s.dark ? 30 : 85;
      if (!isFidelity(s)) return initial;
      return desiredChromaTone(s.s.hue, s.s.chroma, initial, !s.dark);
    },
    isBackground: true,
    background: highest,
    contrastCurve: [1, 1, 3, 4.5],
    pair: pairOf('secondaryContainer', 'secondary'),
  },
  {
    name: 'onSecondaryContainer',
    palette: pal('s'),
    tone: (s) => (isFidelity(s) ? foregroundTone(toneOf(R.secondaryContainer, s), 4.5) : s.dark ? 90 : 10),
    background: bg('secondaryContainer'),
    contrastCurve: [4.5, 7, 11, 21],
  },

  {
    name: 'tertiary',
    palette: pal('t'),
    tone: (s) => (isMono(s) ? (s.dark ? 90 : 25) : s.dark ? 80 : 40),
    isBackground: true,
    background: highest,
    contrastCurve: [3, 4.5, 7, 7],
    pair: pairOf('tertiaryContainer', 'tertiary'),
  },
  {
    name: 'onTertiary',
    palette: pal('t'),
    tone: (s) => (isMono(s) ? (s.dark ? 10 : 90) : s.dark ? 20 : 100),
    background: bg('tertiary'),
    contrastCurve: [4.5, 7, 11, 21],
  },
  {
    name: 'tertiaryContainer',
    palette: pal('t'),
    tone: (s) => {
      if (isMono(s)) return s.dark ? 60 : 49;
      if (!isFidelity(s)) return s.dark ? 30 : 90;
      return fixIfDisliked(solved(s.t.hue, s.t.chroma, s.source[2]))[2];
    },
    isBackground: true,
    background: highest,
    contrastCurve: [1, 1, 3, 4.5],
    pair: pairOf('tertiaryContainer', 'tertiary'),
  },
  {
    name: 'onTertiaryContainer',
    palette: pal('t'),
    tone: (s) =>
      isMono(s) ? (s.dark ? 0 : 100) : isFidelity(s) ? foregroundTone(toneOf(R.tertiaryContainer, s), 4.5) : s.dark ? 90 : 10,
    background: bg('tertiaryContainer'),
    contrastCurve: [4.5, 7, 11, 21],
  },

  {
    name: 'error',
    palette: pal('e'),
    tone: (s) => (s.dark ? 80 : 40),
    isBackground: true,
    background: highest,
    contrastCurve: [3, 4.5, 7, 7],
    pair: pairOf('errorContainer', 'error'),
  },
  { name: 'onError', palette: pal('e'), tone: (s) => (s.dark ? 20 : 100), background: bg('error'), contrastCurve: [4.5, 7, 11, 21] },
  {
    name: 'errorContainer',
    palette: pal('e'),
    tone: (s) => (s.dark ? 30 : 90),
    isBackground: true,
    background: highest,
    contrastCurve: [1, 1, 3, 4.5],
    pair: pairOf('errorContainer', 'error'),
  },
  {
    name: 'onErrorContainer',
    palette: pal('e'),
    tone: (s) => (s.dark ? 90 : 10),
    background: bg('errorContainer'),
    contrastCurve: [4.5, 7, 11, 21],
  },
];
for (const role of ROLES) R[role.name] = role;

const memo = new WeakMap<Ctx, Map<string, number>>();

/** DynamicColor.getTone: базовый тон роли, поправленный под уровень контраста и пары ролей. */
function toneOf(role: Role, s: Ctx): number {
  let m = memo.get(s);
  if (!m) {
    m = new Map();
    memo.set(s, m);
  }
  const hit = m.get(role.name);
  if (hit !== undefined) return hit;
  const value = computeTone(role, s);
  m.set(role.name, value);
  return value;
}

function computeTone(role: Role, s: Ctx): number {
  const decreasing = s.contrast < 0;
  if (role.pair && role.background) {
    // Пара «контейнер ↔ акцент» (полярность nearer): контейнер ближе к фону, акцент дальше на delta тонов.
    const { a: nearer, b: farther, delta } = role.pair();
    const bgTone = toneOf(role.background(s), s);
    const dir = s.dark ? 1 : -1;
    const nContrast = curve(nearer.contrastCurve!, s.contrast);
    const fContrast = curve(farther.contrastCurve!, s.contrast);
    const nInitial = nearer.tone(s);
    let nTone = ratioOfTones(bgTone, nInitial) >= nContrast ? nInitial : foregroundTone(bgTone, nContrast);
    const fInitial = farther.tone(s);
    let fTone = ratioOfTones(bgTone, fInitial) >= fContrast ? fInitial : foregroundTone(bgTone, fContrast);
    if (decreasing) {
      nTone = foregroundTone(bgTone, nContrast);
      fTone = foregroundTone(bgTone, fContrast);
    }
    if ((fTone - nTone) * dir < delta) {
      fTone = clamp(0, 100, nTone + delta * dir);
      if ((fTone - nTone) * dir < delta) nTone = clamp(0, 100, fTone - delta * dir);
    }
    if (nTone >= 50 && nTone < 60) {
      if (dir > 0) {
        nTone = 60;
        fTone = Math.max(fTone, nTone + delta * dir);
      } else {
        nTone = 49;
        fTone = Math.min(fTone, nTone + delta * dir);
      }
    } else if (fTone >= 50 && fTone < 60) {
      fTone = dir > 0 ? 60 : 49;
    }
    return role.name === nearer.name ? nTone : fTone;
  }
  let answer = role.tone(s);
  if (!role.background || !role.contrastCurve) return answer;
  const bgTone = toneOf(role.background(s), s);
  const desired = curve(role.contrastCurve, s.contrast);
  if (ratioOfTones(bgTone, answer) < desired) answer = foregroundTone(bgTone, desired);
  if (decreasing) answer = foregroundTone(bgTone, desired);
  if (role.isBackground && answer >= 50 && answer < 60) answer = ratioOfTones(49, bgTone) >= desired ? 49 : 60;
  return answer;
}

// ───────────────────────── Схема для CSS ─────────────────────────

const ROLE_NAMES = [
  ['primary', 'primary'],
  ['on-primary', 'onPrimary'],
  ['primary-container', 'primaryContainer'],
  ['on-primary-container', 'onPrimaryContainer'],
  ['secondary', 'secondary'],
  ['on-secondary', 'onSecondary'],
  ['secondary-container', 'secondaryContainer'],
  ['on-secondary-container', 'onSecondaryContainer'],
  ['tertiary', 'tertiary'],
  ['on-tertiary', 'onTertiary'],
  ['tertiary-container', 'tertiaryContainer'],
  ['on-tertiary-container', 'onTertiaryContainer'],
  ['error', 'error'],
  ['on-error', 'onError'],
  ['error-container', 'errorContainer'],
  ['on-error-container', 'onErrorContainer'],
  ['surface', 'surface'],
  ['surface-dim', 'surfaceDim'],
  ['surface-bright', 'surfaceBright'],
  ['surface-container-lowest', 'surfaceContainerLowest'],
  ['surface-container-low', 'surfaceContainerLow'],
  ['surface-container', 'surfaceContainer'],
  ['surface-container-high', 'surfaceContainerHigh'],
  ['surface-container-highest', 'surfaceContainerHighest'],
  ['surface-variant', 'surfaceVariant'],
  ['surface-tint', 'surfaceTint'],
  ['on-surface', 'onSurface'],
  ['on-surface-variant', 'onSurfaceVariant'],
  ['outline', 'outline'],
  ['outline-variant', 'outlineVariant'],
  ['inverse-surface', 'inverseSurface'],
  ['inverse-on-surface', 'inverseOnSurface'],
  ['inverse-primary', 'inversePrimary'],
] as const;

export type SchemeRole = (typeof ROLE_NAMES)[number][0] | 'scrim' | 'shadow';
export type Scheme = Record<SchemeRole, string>;

const schemeCache = new Map<string, Scheme>();

/**
 * Схема Material 3 из цвета-источника.
 * style — вариант динамической палитры, contrast — уровень контраста (стандартный, средний, высокий).
 */
export function schemeFromSeed(
  seedHex: string,
  dark: boolean,
  style: SchemeStyle = 'tonalSpot',
  contrast: ContrastLevel = 'standard',
): Scheme {
  const key = `${seedHex.toLowerCase()}|${dark ? 1 : 0}|${style}|${contrast}`;
  const hit = schemeCache.get(key);
  if (hit) return hit;
  const source = hctFromHex(seedHex);
  // Почти серый источник (чёрно-белая обложка, «Графит»): спокойные варианты остаются нейтральными,
  // иначе Tonal Spot придумал бы синий оттенок, которого на обложке нет.
  const calm = style === 'tonalSpot' || style === 'fidelity' || style === 'content';
  const effective: SchemeStyle = source[1] < 6 && calm ? 'neutral' : style;
  const ctx: Ctx = { ...palettesFor(effective, source), dark, contrast: CONTRAST_VALUES[contrast] ?? 0, style: effective, source };
  const out = { scrim: '#000000', shadow: '#000000' } as Scheme;
  for (const [css, name] of ROLE_NAMES) {
    const role = R[name];
    out[css] = role.palette(ctx).tone(toneOf(role, ctx));
  }
  if (schemeCache.size > 96) schemeCache.clear();
  schemeCache.set(key, out);
  return out;
}

/** Записывает схему в CSS-переменные `--md-*` и `--md-*-rgb` (для полупрозрачных поверхностей). */
export function applyScheme(scheme: Scheme, root: HTMLElement = document.documentElement) {
  for (const [role, hex] of Object.entries(scheme)) {
    const [r, g, b] = hexToRgb(hex);
    root.style.setProperty(`--md-${role}`, hex);
    root.style.setProperty(`--md-${role}-rgb`, `${r} ${g} ${b}`);
  }
}

/** Базовый цвет Material You (как у Google), если обложки нет. */
export const BASELINE_SEED = '#6750a4';

/** Готовые сиды для ручного выбора в настройках. */
export const SEED_PRESETS: { name: string; color: string }[] = [
  { name: 'Сирень', color: '#6750a4' },
  { name: 'Океан', color: '#0061a4' },
  { name: 'Мята', color: '#006a60' },
  { name: 'Лес', color: '#386a20' },
  { name: 'Янтарь', color: '#8b5000' },
  { name: 'Коралл', color: '#a73a37' },
  { name: 'Роза', color: '#984061' },
  { name: 'Графит', color: '#5f6368' },
];
