/**
 * Автосинхронизация обычного текста по звуку.
 *
 * Трек скачивается и раскодируется (16 кГц), затем считается «огибающая голоса»:
 * энергия середины стереобазы в полосе речи (голос обычно стоит по центру, а часть
 * инструментов разнесена по краям) минус энергия краёв. По ней находятся участки,
 * где поют, и строки раскладываются по этим участкам пропорционально числу слогов,
 * с привязкой начала строки к ближайшему вступлению голоса.
 *
 * Это оценка, а не распознавание речи: строки попадают примерно, сдвиг и ручная
 * синхронизация в панели помогают довести.
 */
import { formatStamp } from './lyricsMatch';

/** Шаг огибающей, секунды. */
export const HOP = 0.05;

export interface Envelope {
  env: Float32Array;
  hop: number;
  duration: number;
}

/** Слоги строки: гласные кириллицы и латиницы (минимум один для непустой строки). */
export function syllables(line: string): number {
  const n = (line.toLowerCase().match(/[аеёиоуыэюяіїєaeiouyáéíóúàèìòùäöüæøå]/giu) ?? []).length;
  return line.trim() ? Math.max(1, n) : 0;
}

function percentile(values: Float32Array, p: number): number {
  const arr = Array.from(values).filter((v) => v > 0).sort((a, b) => a - b);
  if (!arr.length) return 0;
  return arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
}

function smooth(env: Float32Array, radius: number): Float32Array {
  const out = new Float32Array(env.length);
  let acc = 0;
  const w = radius * 2 + 1;
  for (let i = -radius; i < env.length + radius; i += 1) {
    const add = env[Math.min(env.length - 1, Math.max(0, i + radius))];
    acc += add;
    const drop = i - radius - 1;
    if (drop >= -radius) acc -= env[Math.min(env.length - 1, Math.max(0, drop))];
    if (i >= 0 && i < env.length) out[i] = acc / w;
  }
  return out;
}

export interface Segment {
  start: number;
  end: number;
}

/** Участки, где поют (секунды). */
export function voicedSegments(e: Envelope): Segment[] {
  const sm = smooth(e.env, 3);
  const hi = percentile(sm, 0.9);
  const lo = percentile(sm, 0.2);
  const thr = lo + (hi - lo) * 0.33;
  const segs: Segment[] = [];
  let start = -1;
  for (let i = 0; i <= sm.length; i += 1) {
    const on = i < sm.length && sm[i] > thr;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      segs.push({ start: start * e.hop, end: i * e.hop });
      start = -1;
    }
  }
  // Склеиваем короткие паузы (вдох между словами) и выкидываем всплески.
  const merged: Segment[] = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (last && s.start - last.end < 0.35) last.end = s.end;
    else merged.push({ ...s });
  }
  return merged.filter((s) => s.end - s.start >= 0.3);
}

/**
 * Начала строк. Строки раскладываются по «спетому» времени пропорционально слогам,
 * затем каждое начало подтягивается к ближайшему вступлению голоса (±1.5 с).
 */
export function alignLines(lines: string[], segs: Segment[], duration: number): number[] {
  const weights = lines.map(syllables);
  const totalW = weights.reduce((a, b) => a + b, 0);
  if (!lines.length) return [];
  let voiced = segs.reduce((a, s) => a + (s.end - s.start), 0);
  let segments = segs;
  if (voiced < 5 || !totalW) {
    // Голоса не нашли: раскладываем равномерно по всей длительности.
    const from = Math.min(10, duration * 0.08);
    segments = [{ start: from, end: Math.max(from + 1, duration - Math.min(10, duration * 0.06)) }];
    voiced = segments[0].end - segments[0].start;
  }
  // Время на «спетой» оси -> реальное время.
  const toReal = (v: number): number => {
    let left = v;
    for (const s of segments) {
      const len = s.end - s.start;
      if (left <= len) return s.start + left;
      left -= len;
    }
    return segments[segments.length - 1].end;
  };
  const onsets = segments.map((s) => s.start);
  const times: number[] = [];
  let acc = 0;
  let prev = -Infinity;
  for (let i = 0; i < lines.length; i += 1) {
    let t = toReal((acc / Math.max(1, totalW)) * voiced);
    acc += weights[i];
    // Ближайшее вступление голоса.
    let best = t;
    let bestD = 1.5;
    for (const o of onsets) {
      const d = Math.abs(o - t);
      if (d < bestD && o > prev + 0.6) {
        best = o;
        bestD = d;
      }
    }
    t = Math.max(best, prev + 0.4);
    times.push(Math.min(t, Math.max(0, duration - 0.5)));
    prev = t;
  }
  return times;
}

/** LRC из строк и времён (пустые строки — паузы — пропускаются). */
export function buildLrc(lines: string[], times: number[]): string {
  return lines
    .map((line, i) => (line.trim() ? `[${formatStamp(times[i] ?? 0)}]${line.trim()}` : ''))
    .filter(Boolean)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Звук
// ---------------------------------------------------------------------------

const MAX_BYTES = 80 * 1024 * 1024;

/** Скачивает файл целиком кусками Range (прокси Frost отдаёт по 2-4 МБ за раз). */
async function fetchRanged(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let have = 0;
  let total = Infinity;
  while (have < total && have < MAX_BYTES) {
    const r = await fetch(url, { headers: { Range: `bytes=${have}-` }, signal });
    if (!r.ok && r.status !== 206) throw new Error(`HTTP ${r.status}`);
    const buf = new Uint8Array(await r.arrayBuffer());
    if (r.status === 200) return buf;
    const m = /\/(\d+)\s*$/.exec(r.headers.get('content-range') ?? '');
    if (m) total = parseInt(m[1], 10);
    if (!buf.length) break;
    parts.push(buf);
    have += buf.length;
    if (!m) break;
  }
  const out = new Uint8Array(have);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** HLS: плейлист и все сегменты подряд (с init-сегментом, если есть). */
async function fetchHls(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  const text = await (await fetch(url, { signal })).text();
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const nested = lines.find((l) => l && !l.startsWith('#') && /\.m3u8|\/p\//.test(l) && lines.some((x) => x.startsWith('#EXT-X-STREAM-INF')));
  if (nested) return fetchHls(new URL(nested, url).toString(), signal);
  const uris: string[] = [];
  for (const l of lines) {
    const map = /^#EXT-X-MAP:.*URI="([^"]+)"/.exec(l);
    if (map) uris.push(map[1]);
    else if (l && !l.startsWith('#')) uris.push(l);
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (const u of uris) {
    const b = new Uint8Array(await (await fetch(new URL(u, url).toString(), { signal })).arrayBuffer());
    chunks.push(b);
    size += b.length;
    if (size > MAX_BYTES) break;
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c.subarray(0, Math.min(c.length, size - at)), at);
    at += c.length;
    if (at >= size) break;
  }
  return out;
}

export async function fetchAudio(url: string, hls: boolean, signal?: AbortSignal): Promise<Uint8Array> {
  return hls ? fetchHls(url, signal) : fetchRanged(url, signal);
}

/** Огибающая голоса из закодированного файла. */
export async function vocalEnvelope(bytes: Uint8Array): Promise<Envelope> {
  const rate = 16000;
  const Ctx = (window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext);
  const ctx = new Ctx(2, rate, rate);
  const copy = bytes.slice().buffer as ArrayBuffer;
  const audio = await ctx.decodeAudioData(copy);
  const l = audio.getChannelData(0);
  const r = audio.numberOfChannels > 1 ? audio.getChannelData(1) : l;
  const sr = audio.sampleRate;
  const hop = Math.round(sr * HOP);
  const frames = Math.floor(l.length / hop);
  const env = new Float32Array(frames);
  // Полоса речи: однополюсные фильтры (ВЧ ~200 Гц, НЧ ~3200 Гц).
  const hpA = Math.exp((-2 * Math.PI * 200) / sr);
  const lpA = Math.exp((-2 * Math.PI * 3200) / sr);
  let hpM = 0, hpMx = 0, lpM = 0, hpS = 0, hpSx = 0, lpS = 0;
  for (let f = 0; f < frames; f += 1) {
    let em = 0;
    let es = 0;
    for (let i = f * hop, end = i + hop; i < end; i += 1) {
      const mid = (l[i] + r[i]) * 0.5;
      const side = (l[i] - r[i]) * 0.5;
      hpM = hpA * (hpM + mid - hpMx);
      hpMx = mid;
      lpM = lpM + (1 - lpA) * (hpM - lpM);
      hpS = hpA * (hpS + side - hpSx);
      hpSx = side;
      lpS = lpS + (1 - lpA) * (hpS - lpS);
      em += lpM * lpM;
      es += lpS * lpS;
    }
    env[f] = Math.max(0, Math.sqrt(em / hop) - 0.7 * Math.sqrt(es / hop));
  }
  return { env, hop: HOP, duration: audio.duration };
}

/** Полный цикл: звук -> огибающая -> LRC. */
export async function autoSync(
  lines: string[],
  source: { url: string; hls: boolean },
  duration: number,
  signal?: AbortSignal,
): Promise<string> {
  const bytes = await fetchAudio(source.url, source.hls, signal);
  const env = await vocalEnvelope(bytes);
  const times = alignLines(lines, voicedSegments(env), env.duration || duration);
  return buildLrc(lines, times);
}
