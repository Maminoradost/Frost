import Hls from 'hls.js';
import type { ResolvedStream } from '../lib/types';

/** Полосы 10-полосного эквалайзера (Гц). */
export const EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export interface EngineEvents {
  onPlaying: () => void;
  onPause: () => void;
  onWaiting: () => void;
  onEnded: () => void;
  onDuration: (duration: number) => void;
  onError: (message: string) => void;
}

function mediaErrorText(err: MediaError | null): string {
  switch (err?.code) {
    case 1:
      return 'загрузка прервана';
    case 2:
      return 'сетевая ошибка';
    case 3:
      return 'ошибка декодирования';
    case 4:
      return 'формат не поддерживается или поток недоступен';
    default:
      return 'неизвестная ошибка';
  }
}

interface Deck {
  audio: HTMLAudioElement;
  hls: Hls | null;
  hlsRetries: number;
  pendingSeek: number;
  gain: GainNode | null;
}

type SinkTarget = { setSinkId?: (id: string) => Promise<void> };

const dbToGain = (db: number) => Math.pow(10, db / 20);

/**
 * Аудиодвижок: две «деки» HTMLAudioElement (+ hls.js) и граф WebAudio
 * (дека A/B → микшер → 10×Biquad EQ → analyser → выравнивание громкости → [лимитер] → выход).
 * Вторая дека нужна для плавного перехода между треками. Все потоки идут через frost://
 * или asset:// с CORS-заголовками, поэтому граф «видит» звук.
 */
class AudioEngine {
  events: Partial<EngineEvents> = {};

  private decks: [Deck, Deck];
  private active = 0;
  private ctx: AudioContext | null = null;
  private filters: BiquadFilterNode[] = [];
  private analyser: AnalyserNode | null = null;
  private norm: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private eqEnabled = false;
  private eqGains: number[] = EQ_BANDS.map(() => 0);
  private loadToken = 0;
  private sinkId = '';
  private normalizeOn = false;
  private normTimer = 0;
  private loudness: number | null = null;
  private loudSamples = 0;
  private fadeTimer = 0;

  /** Поток, который сейчас загружен (для автосинхронизации текста по вокалу). */

  source: ResolvedStream | null = null;


  constructor() {
    this.decks = [this.createDeck(), this.createDeck()];
  }

  private createDeck(): Deck {
    const a = new Audio();
    a.crossOrigin = 'anonymous';
    a.preload = 'auto';
    const deck: Deck = { audio: a, hls: null, hlsRetries: 0, pendingSeek: 0, gain: null };
    const mine = () => this.decks[this.active] === deck;
    a.addEventListener('playing', () => mine() && this.events.onPlaying?.());
    a.addEventListener('pause', () => mine() && this.events.onPause?.());
    a.addEventListener('waiting', () => mine() && this.events.onWaiting?.());
    a.addEventListener('ended', () => mine() && this.events.onEnded?.());
    a.addEventListener('durationchange', () => {
      if (mine() && Number.isFinite(a.duration)) this.events.onDuration?.(a.duration);
    });
    a.addEventListener('loadedmetadata', () => {
      if (deck.pendingSeek > 0) {
        a.currentTime = deck.pendingSeek;
        deck.pendingSeek = 0;
      }
    });
    a.addEventListener('error', () => {
      // Сброс src тоже порождает error: игнорируем, если источника нет.
      if (!mine() || !a.currentSrc || deck.hls) return;
      this.events.onError?.(mediaErrorText(a.error));
    });
    return deck;
  }

  /** Текущая (слышимая) дека. */
  private get deck(): Deck {
    return this.decks[this.active];
  }

  get audio(): HTMLAudioElement {
    return this.deck.audio;
  }

  /** Граф WebAudio создаётся лениво, после первого жеста пользователя. */
  private ensureGraph() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const ctx = new AudioContext({ latencyHint: 'playback' });
      const mix = ctx.createGain();
      this.decks.forEach((deck, i) => {
        const source = ctx.createMediaElementSource(deck.audio);
        const gain = ctx.createGain();
        gain.gain.value = i === this.active ? 1 : 0;
        source.connect(gain);
        gain.connect(mix);
        deck.gain = gain;
      });
      const last = EQ_BANDS.length - 1;
      this.filters = EQ_BANDS.map((freq, i) => {
        const f = ctx.createBiquadFilter();
        f.type = i === 0 ? 'lowshelf' : i === last ? 'highshelf' : 'peaking';
        f.frequency.value = freq;
        f.Q.value = 1.05;
        f.gain.value = this.eqEnabled ? this.eqGains[i] ?? 0 : 0;
        return f;
      });
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.78;
      let node: AudioNode = mix;
      for (const f of this.filters) {
        node.connect(f);
        node = f;
      }
      node.connect(analyser);
      const norm = ctx.createGain();
      analyser.connect(norm);
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -1.5;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.12;
      limiter.connect(ctx.destination);
      this.ctx = ctx;
      this.analyser = analyser;
      this.norm = norm;
      this.limiter = limiter;
      this.routeOutput();
      if (this.sinkId) void this.applySink();
    } catch (e) {
      console.warn('WebAudio недоступен, EQ и визуализатор отключены', e);
    }
  }

  /** Лимитер включается только вместе с выравниванием: при усилении он не даёт звуку перегрузиться. */
  private routeOutput() {
    if (!this.ctx || !this.norm || !this.limiter) return;
    this.norm.disconnect();
    this.norm.connect(this.normalizeOn ? this.limiter : this.ctx.destination);
    if (!this.normalizeOn) this.norm.gain.setTargetAtTime(1, this.ctx.currentTime, 0.3);
  }

  private resetDeck(deck: Deck) {
    if (deck.hls) {
      deck.hls.destroy();
      deck.hls = null;
    }
    deck.audio.pause();
    deck.audio.removeAttribute('src');
    deck.audio.load();
    deck.hlsRetries = 0;
    deck.pendingSeek = 0;
  }

  private setDeckGain(deck: Deck, value: number) {
    if (!deck.gain || !this.ctx) return;
    const g = deck.gain.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setValueAtTime(value, this.ctx.currentTime);
  }

  /** Отменяет незаконченный переход: слышна только текущая дека. */
  private settleDecks() {
    window.clearTimeout(this.fadeTimer);
    const other = this.decks[1 - this.active];
    if (other.audio.currentSrc) this.resetDeck(other);
    this.setDeckGain(other, 0);
    this.setDeckGain(this.deck, 1);
  }

  private attach(deck: Deck, stream: ResolvedStream, startAt: number, token: number) {

    this.source = stream;
    const a = deck.audio;
    if (stream.kind === 'hls' && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        startPosition: startAt > 0 ? startAt : -1,
        maxBufferLength: 60,
        backBufferLength: 30,
      });
      deck.hls = hls;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal || token !== this.loadToken || this.deck !== deck) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && deck.hlsRetries < 2) {
          deck.hlsRetries += 1;
          hls.startLoad();
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && deck.hlsRetries < 2) {
          deck.hlsRetries += 1;
          hls.recoverMediaError();
          return;
        }
        this.events.onError?.(`HLS: ${data.details}`);
      });
      hls.loadSource(stream.url);
      hls.attachMedia(a);
    } else {
      deck.pendingSeek = startAt;
      a.src = stream.url;
    }
  }

  async load(stream: ResolvedStream, autoplay: boolean, startAt = 0): Promise<void> {
    const token = ++this.loadToken;
    this.settleDecks();
    const deck = this.deck;
    this.resetDeck(deck);
    this.resetLoudness();
    this.attach(deck, stream, startAt, token);
    if (autoplay && token === this.loadToken) await this.play();
  }

  /**
   * Плавный переход: следующий трек стартует на второй деке, громкости меняются
   * по равномощным кривым за `seconds` секунд. Без WebAudio — обычная смена трека.
   */
  async crossfadeTo(stream: ResolvedStream, seconds: number): Promise<void> {
    this.ensureGraph();
    const ctx = this.ctx;
    const from = this.deck;
    const to = this.decks[1 - this.active];
    if (!ctx || !from.gain || !to.gain || from.audio.paused || seconds <= 0) {
      await this.load(stream, true);
      return;
    }
    const token = ++this.loadToken;
    window.clearTimeout(this.fadeTimer);
    this.resetDeck(to);
    this.setDeckGain(to, 0);
    this.attach(to, stream, 0, token);
    this.active = 1 - this.active;
    this.resetLoudness();
    try {
      await to.audio.play();
    } catch (e) {
      const name = (e as DOMException | undefined)?.name;
      if (token === this.loadToken && name !== 'AbortError') {
        this.events.onError?.(`не удалось начать воспроизведение (${name ?? 'error'})`);
      }
      return;
    }
    if (token !== this.loadToken) return;
    const steps = 48;
    const up = new Float32Array(steps);
    const down = new Float32Array(steps);
    const startLevel = from.gain.gain.value;
    for (let i = 0; i < steps; i++) {
      const x = i / (steps - 1);
      up[i] = Math.sin((x * Math.PI) / 2);
      down[i] = Math.cos((x * Math.PI) / 2) * startLevel;
    }
    const now = ctx.currentTime;
    to.gain.gain.cancelScheduledValues(now);
    to.gain.gain.setValueCurveAtTime(up, now, seconds);
    from.gain.gain.cancelScheduledValues(now);
    from.gain.gain.setValueCurveAtTime(down, now, seconds);
    this.fadeTimer = window.setTimeout(() => {
      if (this.deck !== from) {
        this.resetDeck(from);
        this.setDeckGain(from, 0);
      }
    }, seconds * 1000 + 250);
  }

  async play(): Promise<void> {
    this.ensureGraph();
    try {
      await this.audio.play();
    } catch (e) {
      const name = (e as DOMException | undefined)?.name;
      if (name !== 'AbortError') this.events.onError?.(`не удалось начать воспроизведение (${name ?? 'error'})`);
    }
  }

  pause() {
    // Пауза посреди перехода: заканчиваем его сразу, чтобы не осталось «хвоста» старого трека
    if (this.decks[1 - this.active].audio.currentSrc) this.settleDecks();
    this.audio.pause();
  }

  stop() {
    this.loadToken++;
    this.settleDecks();
    this.resetDeck(this.deck);
  }

  seek(time: number) {
    const d = this.duration;
    const t = Math.max(0, d > 0 ? Math.min(time, d - 0.25) : time);
    if (Number.isFinite(t)) this.audio.currentTime = t;
  }

  get paused(): boolean {
    return this.audio.paused;
  }

  get currentTime(): number {
    return this.audio.currentTime || 0;
  }

  get duration(): number {
    const d = this.audio.duration;
    return Number.isFinite(d) ? d : 0;
  }

  get bufferedEnd(): number {
    const b = this.audio.buffered;
    const t = this.audio.currentTime;
    for (let i = 0; i < b.length; i++) {
      if (b.start(i) <= t + 0.5 && b.end(i) >= t) return b.end(i);
    }
    return 0;
  }

  /** Перцептивная громкость: квадратичная кривая. Одинаковая на обеих деках. */
  setVolume(volume: number, muted: boolean) {
    const v = Math.min(1, Math.max(0, volume));
    for (const deck of this.decks) {
      deck.audio.volume = v * v;
      deck.audio.muted = muted;
    }
  }

  setEq(enabled: boolean, gains: number[]) {
    this.eqEnabled = enabled;
    this.eqGains = gains.slice();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.filters.forEach((f, i) => {
      f.gain.setTargetAtTime(enabled ? gains[i] ?? 0 : 0, now, 0.05);
    });
  }

  // --- Устройство вывода ---------------------------------------------------

  /** '' — устройство Windows по умолчанию. Возвращает false, если сменить не вышло. */
  async setOutputDevice(id: string): Promise<boolean> {
    this.sinkId = id;
    return this.applySink();
  }

  private async applySink(): Promise<boolean> {
    try {
      const ctx = this.ctx as (AudioContext & SinkTarget) | null;
      if (ctx) {
        if (!ctx.setSinkId) return false;
        await ctx.setSinkId(this.sinkId);
        return true;
      }
      for (const deck of this.decks) {
        const el = deck.audio as HTMLAudioElement & SinkTarget;
        if (el.setSinkId) await el.setSinkId(this.sinkId);
      }
      return true;
    } catch (e) {
      console.warn('Не удалось сменить устройство вывода', e);
      return false;
    }
  }

  // --- Выравнивание громкости ----------------------------------------------

  setNormalize(on: boolean) {
    this.normalizeOn = on;
    window.clearInterval(this.normTimer);
    this.normTimer = 0;
    this.resetLoudness();
    this.routeOutput();
    if (on) this.normTimer = window.setInterval(() => this.measure(), 250);
  }

  private resetLoudness() {
    this.loudness = null;
    this.loudSamples = 0;
  }

  private measureBuf: Float32Array<ArrayBuffer> | null = null;

  /**
   * Мягкая автоматическая регулировка: средняя громкость (RMS) за последние секунды
   * подтягивается к целевой, от −10 до +6 дБ. Громкость плеера в расчёт не входит.
   */
  private measure() {
    const ctx = this.ctx;
    const analyser = this.analyser;
    const norm = this.norm;
    const a = this.audio;
    if (!ctx || !analyser || !norm || a.paused || a.muted || a.volume < 0.01) return;
    this.measureBuf ??= new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(this.measureBuf);
    let sum = 0;
    for (const x of this.measureBuf) sum += x * x;
    const rms = Math.sqrt(sum / this.measureBuf.length);
    const db = 20 * Math.log10(rms + 1e-9) - 20 * Math.log10(a.volume);
    if (db < -55) return; // тишина между треками и паузы не считаем
    this.loudSamples += 1;
    const alpha = this.loudSamples < 8 ? 0.35 : 0.06;
    this.loudness = this.loudness === null ? db : this.loudness + (db - this.loudness) * alpha;
    const target = -19;
    const gainDb = Math.max(-10, Math.min(6, target - this.loudness));
    norm.gain.setTargetAtTime(dbToGain(gainDb), ctx.currentTime, this.loudSamples < 8 ? 0.4 : 1.5);
  }

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 48000;
  }

  get binCount(): number {
    return this.analyser?.frequencyBinCount ?? 1024;
  }

  /** Заполняет массив спектром; false, если анализатора ещё нет. */
  getFrequencyData(target: Uint8Array<ArrayBuffer>): boolean {
    if (!this.analyser) return false;
    this.analyser.getByteFrequencyData(target);
    return true;
  }
}

export const engine = new AudioEngine();
