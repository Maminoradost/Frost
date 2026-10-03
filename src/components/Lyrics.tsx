import { Check, ExternalLink, Hand, Maximize2, MicVocal, Minimize2, RotateCcw, Search, Sparkles, Timer, Undo2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { engine } from '../audio/engine';
import { useAsync } from '../hooks/useAsync';
import { usePlaybackTime } from '../hooks/usePlaybackTime';
import { autoSync } from '../lib/autosync';
import { activeLineIndex, estimateWords, parseLrc, syncableLines, timedLrc, wordProgress, type LrcLine } from '../lib/lrc';
import { findLyrics, type LyricsOption } from '../lib/lyrics';
import type { LyricsQuery } from '../lib/lyricsMatch';
import { loadOverride, saveOverride, type LyricsOverride } from '../lib/lyricsStore';
import type { Track } from '../lib/types';
import { trackKey } from '../lib/types';
import { openExternal } from '../lib/window';
import { usePlayer } from '../store/player';
import { useSettings } from '../store/settings';
import { toast } from '../store/ui';
import { EmptyState, Spinner } from './States';

/** Ключ варианта «моя синхронизация» (авто или вручную). */
const OWN = 'own';

type SyncState = { status: 'idle' } | { status: 'running' } | { status: 'error'; message: string };
interface TapState {
  lines: string[];
  times: number[];
}

/** Поток именно этого трека, если он уже загружен в плеер. */
function loadedStream(key: string) {
  const st = usePlayer.getState();
  if (!st.loaded || !st.current || trackKey(st.current) !== key) return null;
  return engine.source;
}

const fmtOffset = (v: number) => `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} с`;
const seekTo = (t: number) => usePlayer.getState().seek(Math.max(0, t));

/** Активная строка с караоке-заливкой: по словам (если есть разметка) или по оценке слогов. */
function KaraokeText({ line, next, offset }: { line: LrcLine; next?: LrcLine; offset: number }) {
  const time = usePlaybackTime(true, 30) - offset;
  const words = useMemo(() => line.words ?? estimateWords(line, next), [line, next]);
  if (!words.length) return <>{line.text}</>;
  return (
    <>
      {words.map((w, i) => (
        <span key={i} className="lyrics__word" style={{ '--fill': `${(wordProgress(w, time) * 100).toFixed(1)}%` } as CSSProperties}>
          {w.text}
        </span>
      ))}
    </>
  );
}

/** Синхронизированный текст с подсветкой строки, караоке, сдвигом, выбором источника и (авто)синхронизацией. */
export function LyricsView({ track, large = false }: { track: Track; large?: boolean }) {
  const key = trackKey(track);
  const [override, setOverride] = useState<LyricsOverride>(() => loadOverride(key));
  const update = useCallback((patch: Partial<LyricsOverride> | null) => setOverride(saveOverride(key, patch)), [key]);
  const query = override.query;
  const { data: result, loading, error } = useAsync(`lyrics:${key}:${query ? `${query.artist}|${query.title}` : ''}`, () =>
    findLyrics(track, query ? { query } : undefined),
  );
  const autoEnabled = useSettings((s) => s.lyricsAutoSync);
  const karaoke = useSettings((s) => s.lyricsKaraoke);
  const [fullScreen, setFullScreen] = useState(false);
  const [panel, setPanel] = useState<'none' | 'search' | 'offset'>('none');
  const [sync, setSync] = useState<SyncState>({ status: 'idle' });
  const [tap, setTap] = useState<TapState | null>(null);
  const [form, setForm] = useState<LyricsQuery>(() => query ?? { artist: track.artist, title: track.title });
  const triedAuto = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Варианты: моя синхронизация (если есть) + найденные источники.
  const options = useMemo<LyricsOption[]>(() => {
    const found = result?.options ?? [];
    if (!override.synced) return found;
    const own: LyricsOption = {
      key: OWN,
      kind: override.syncedBy === 'manual' ? 'manual' : 'auto',
      source: override.syncedBy === 'manual' ? 'Моя синхронизация' : 'Автосинхронизация',
      synced: override.synced,
      plain: null,
      instrumental: false,
      score: 1,
      tempo: 1,
    };
    return [own, ...found];
  }, [result, override.synced, override.syncedBy]);

  const data = useMemo(() => {
    if (!options.length) return null;
    const picked = override.pick ? options.find((o) => o.key === override.pick) : undefined;
    return picked ?? options.find((o) => o.synced) ?? options[0];
  }, [options, override.pick]);

  const offset = override.offset ?? 0;
  const lines = useMemo(() => (data?.synced ? parseLrc(data.synced) : []), [data]);
  const plainText = data?.plain ?? (lines.length ? lines.map((l) => l.text).join('\n') : '');
  const time = usePlaybackTime(lines.length > 0, 10) - offset;
  const active = lines.length ? activeLineIndex(lines, time) : -1;
  const hasSynced = options.some((o) => o.synced);
  const needsAuto = !!data && !hasSynced && !!data.plain && !data.instrumental;

  useEffect(() => {
    if (active < 0 || !boxRef.current || tap) return;
    const el = boxRef.current.querySelector<HTMLElement>(`[data-line="${active}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [active, tap]);

  useEffect(() => {
    if (!fullScreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullScreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullScreen]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const runAutoSync = useCallback(
    async (manual: boolean) => {
      const toSync = syncableLines(plainText);
      if (toSync.length < 2) {
        if (manual) toast('Слишком короткий текст для синхронизации');
        return;
      }
      const stream = loadedStream(key);
      if (!stream) {
        if (manual) toast('Включите этот трек: синхронизация идёт по его звуку');
        return;
      }
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setSync({ status: 'running' });
      try {
        const duration = usePlayer.getState().duration || track.duration || 0;
        const lrc = await autoSync(toSync, { url: stream.url, hls: stream.kind === 'hls' }, duration, ctrl.signal);
        if (ctrl.signal.aborted) return;
        update({ synced: lrc, syncedBy: 'auto', pick: OWN, offset: undefined });
        setSync({ status: 'idle' });
        if (manual) toast('Текст синхронизирован по вокалу');
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setSync({ status: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    },
    [key, plainText, track.duration, update],
  );

  // Текст без таймкодов: синхронизируем сами, как только звук трека загружен.
  useEffect(() => {
    if (!autoEnabled || !needsAuto || override.synced || triedAuto.current) return;
    let cancelled = false;
    let timer = 0;
    let attempts = 0;
    const attempt = () => {
      if (cancelled) return;
      if (!loadedStream(key)) {
        attempts += 1;
        if (attempts < 20) timer = window.setTimeout(attempt, 2000);
        return;
      }
      triedAuto.current = true;
      void runAutoSync(false);
    };
    timer = window.setTimeout(attempt, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [autoEnabled, key, needsAuto, override.synced, runAutoSync]);

  // ── Ручная синхронизация: Пробел в начале каждой строки ──
  const startTap = useCallback(() => {
    const list = syncableLines(plainText);
    if (list.length < 2) return;
    setPanel('none');
    setTap({ lines: list, times: [] });
  }, [plainText]);

  const mark = useCallback(() => {
    setTap((s) => (s && s.times.length < s.lines.length ? { ...s, times: [...s.times, engine.currentTime] } : s));
  }, []);
  const undo = useCallback(() => setTap((s) => (s ? { ...s, times: s.times.slice(0, -1) } : s)), []);
  const finishTap = useCallback(() => {
    if (!tap || tap.times.length < 2) return;
    update({ synced: timedLrc(tap.lines, tap.times), syncedBy: 'manual', pick: OWN, offset: undefined });
    setTap(null);
    toast('Своя синхронизация сохранена');
  }, [tap, update]);

  useEffect(() => {
    if (tap && tap.times.length === tap.lines.length) finishTap();
  }, [tap, finishTap]);

  useEffect(() => {
    if (!tap) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const handled = e.code === 'Space' || e.key === 'Enter' || e.key === 'Backspace' || e.key === 'Escape';
      if (!handled) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Backspace') undo();
      else if (e.key === 'Escape') setTap(null);
      else mark();
    };
    // В фазе перехвата, чтобы Пробел не ставил трек на паузу.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [tap, mark, undo]);

  useEffect(() => {
    if (!tap || !boxRef.current) return;
    boxRef.current.querySelector<HTMLElement>(`[data-line="${tap.times.length}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [tap]);

  const shift = (d: number) => update({ offset: Math.round((offset + d) * 10) / 10 || undefined });
  const resetAll = () => {
    abortRef.current?.abort();
    triedAuto.current = true;
    setSync({ status: 'idle' });
    setPanel('none');
    update(null);
  };
  const customized = !!(override.synced || override.offset || override.pick || override.query);

  const cls = `lyrics ${large ? 'lyrics--large' : ''} ${fullScreen ? 'lyrics--fullscreen' : ''}`;
  const fullScreenButton = (
    <button
      className="icon-btn icon-btn--xs lyrics__fs"
      onClick={() => setFullScreen((v) => !v)}
      title={fullScreen ? 'Свернуть (Esc)' : 'На весь экран'}
      aria-label={fullScreen ? 'Свернуть' : 'Текст на весь экран'}
    >
      {fullScreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
    </button>
  );

  const searchForm =
    panel === 'search' ? (
      <form
        className="lyrics__search"
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.title.trim()) return;
          triedAuto.current = false;
          update({ query: { artist: form.artist.trim(), title: form.title.trim() }, pick: undefined });
          setPanel('none');
        }}
      >
        <input className="input input--sm" value={form.artist} placeholder="Исполнитель" aria-label="Исполнитель" onChange={(e) => setForm({ ...form, artist: e.target.value })} />
        <input className="input input--sm" value={form.title} placeholder="Название" aria-label="Название" onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus />
        <button type="submit" className="btn btn--filled btn--sm">
          <Search size={14} /> Найти
        </button>
        {override.query && (
          <button
            type="button"
            className="btn btn--text btn--sm"
            onClick={() => {
              update({ query: undefined, pick: undefined });
              setForm({ artist: track.artist, title: track.title });
              setPanel('none');
            }}
          >
            Как было
          </button>
        )}
      </form>
    ) : null;

  const tools = (
    <span className="lyrics__tools">
      <button
        className={`icon-btn icon-btn--xs ${panel === 'search' ? 'is-on' : ''}`}
        onClick={() => setPanel((p) => (p === 'search' ? 'none' : 'search'))}
        title="Найти текст вручную"
        aria-label="Найти текст вручную"
      >
        <Search size={16} />
      </button>
      {lines.length > 0 && (
        <button
          className={`icon-btn icon-btn--xs ${panel === 'offset' || offset ? 'is-on' : ''}`}
          onClick={() => setPanel((p) => (p === 'offset' ? 'none' : 'offset'))}
          title="Сдвиг текста"
          aria-label="Сдвиг текста"
        >
          <Timer size={16} />
        </button>
      )}
      {plainText && (
        <button
          className="icon-btn icon-btn--xs"
          onClick={() => void runAutoSync(true)}
          disabled={sync.status === 'running'}
          title={lines.length ? 'Пересинхронизировать по вокалу' : 'Синхронизировать по вокалу'}
          aria-label="Синхронизировать по вокалу"
        >
          <Sparkles size={16} />
        </button>
      )}
      {plainText && (
        <button className="icon-btn icon-btn--xs" onClick={startTap} title="Синхронизировать вручную (Пробелом)" aria-label="Синхронизировать вручную">
          <Hand size={16} />
        </button>
      )}
      {customized && (
        <button className="icon-btn icon-btn--xs" onClick={resetAll} title="Сбросить мои настройки текста" aria-label="Сбросить настройки текста">
          <RotateCcw size={16} />
        </button>
      )}
      {fullScreenButton}
    </span>
  );

  const sources =
    options.length > 1 ? (
      <div className="lyrics__sources" role="tablist" aria-label="Источник текста">
        {options.map((o) => (
          <button
            key={o.key}
            role="tab"
            aria-selected={o.key === data?.key}
            className={`chip chip--sm ${o.key === data?.key ? 'is-active' : ''}`}
            onClick={() => update({ pick: o.key })}
            title={[
              o.matched ? `«${o.matched}»` : '',
              o.key === OWN ? '' : `совпадение ${Math.round(o.score * 100)}%`,
              o.tempo !== 1 ? `темп ×${o.tempo.toFixed(2)}` : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          >
            {o.source}
            {o.synced ? '' : ' · без синхр.'}
          </button>
        ))}
      </div>
    ) : (
      <span />
    );

  const offsetStrip =
    panel === 'offset' && lines.length ? (
      <div className="lyrics__adjust" role="group" aria-label="Сдвиг текста">
        <button className="chip chip--sm" onClick={() => shift(-0.5)} title="Текст раньше на 0.5 с">
          −0.5
        </button>
        <button className="chip chip--sm" onClick={() => shift(-0.1)} title="Текст раньше на 0.1 с">
          −0.1
        </button>
        <span className="lyrics__offset">{offset ? `${fmtOffset(offset)} · текст ${offset > 0 ? 'позже' : 'раньше'}` : 'Без сдвига'}</span>
        <button className="chip chip--sm" onClick={() => shift(0.1)} title="Текст позже на 0.1 с">
          +0.1
        </button>
        <button className="chip chip--sm" onClick={() => shift(0.5)} title="Текст позже на 0.5 с">
          +0.5
        </button>
        {offset !== 0 && (
          <button className="chip chip--sm" onClick={() => update({ offset: undefined })}>
            Сброс
          </button>
        )}
      </div>
    ) : null;

  const banner =
    sync.status === 'running' ? (
      <div className="lyrics__banner">
        <Spinner /> Синхронизируем текст по голосу…
      </div>
    ) : sync.status === 'error' ? (
      <div className="lyrics__banner lyrics__banner--error">
        Не удалось синхронизировать: {sync.message}
        <span className="lyrics__banner-actions">
          <button className="btn btn--text btn--sm" onClick={() => void runAutoSync(true)}>
            Повторить
          </button>
          <button className="btn btn--text btn--sm" onClick={startTap}>
            Вручную
          </button>
        </span>
      </div>
    ) : null;

  const footer = data ? (
    <div className="lyrics__source">
      {data.key === OWN
        ? override.syncedBy === 'manual'
          ? 'Синхронизация: ваша, вручную'
          : 'Синхронизация: автоматически по вокалу'
        : `Текст: ${data.source}${data.matched ? ` · «${data.matched}»` : ''}${data.score < 0.995 ? ` · совпадение ${Math.round(data.score * 100)}%` : ''}`}
      {data.tempo !== 1 && ` · подогнан под темп ×${data.tempo.toFixed(2)}`}
      {!data.synced && ' · без синхронизации'}
      {offset !== 0 && ` · сдвиг ${fmtOffset(offset)}`}
      {data.url && (
        <button className="link lyrics__link" onClick={() => void openExternal(data.url ?? '')}>
          открыть <ExternalLink size={12} />
        </button>
      )}
    </div>
  ) : null;

  // ── Режим ручной синхронизации ──
  if (tap) {
    return (
      <div className={`${cls} lyrics--tap`} ref={boxRef}>
        <div className="lyrics__toolbar">
          <span className="lyrics__tap-title">
            Ручная синхронизация · {tap.times.length}/{tap.lines.length}
          </span>
          <span className="lyrics__tools">
            <button className="btn btn--tonal btn--sm" onClick={mark}>
              <Hand size={14} /> Строка
            </button>
            <button className="icon-btn icon-btn--xs" onClick={undo} disabled={!tap.times.length} title="Отменить метку (Backspace)" aria-label="Отменить метку">
              <Undo2 size={16} />
            </button>
            <button className="icon-btn icon-btn--xs" onClick={finishTap} disabled={tap.times.length < 2} title="Сохранить" aria-label="Сохранить">
              <Check size={16} />
            </button>
            <button className="icon-btn icon-btn--xs" onClick={() => setTap(null)} title="Отмена (Esc)" aria-label="Отмена">
              <X size={16} />
            </button>
          </span>
        </div>
        <p className="lyrics__hint">Слушайте трек и жмите Пробел, когда начинается выделенная строка. Backspace отменяет метку, Esc выходит.</p>
        {tap.lines.map((l, i) => (
          <p
            key={i}
            data-line={i}
            className={`lyrics__line ${i === tap.times.length ? 'is-active' : ''} ${i < tap.times.length ? 'is-past' : ''}`}
            onClick={() => i < tap.times.length && seekTo(tap.times[i] - 1)}
          >
            {i < tap.times.length && <span className="lyrics__stamp">{fmtStamp(tap.times[i])}</span>}
            {l}
          </p>
        ))}
      </div>
    );
  }

  if (loading && !result) {
    return (
      <div className={`${cls} lyrics--state`}>
        <Spinner /> <span>Ищем текст…</span>
      </div>
    );
  }

  if (error || !data || (!lines.length && !data.plain)) {
    const instrumental = !!data?.instrumental;
    return (
      <div className={`${cls} lyrics--state`}>
        <div className="lyrics__empty">
          {searchForm}
          <EmptyState
            icon={<MicVocal size={36} />}
            title={instrumental ? 'Инструментальный трек' : query ? 'По этому запросу текста нет' : 'Текст не найден'}
            text={instrumental ? 'Здесь нет слов, только музыка.' : 'Искали в LRCLIB, NetEase, YouTube Music и Genius.'}
          />
          {panel !== 'search' && (
            <span className="lyrics__empty-actions">
              <button className="btn btn--tonal btn--sm" onClick={() => setPanel('search')}>
                <Search size={14} /> Искать вручную
              </button>
              {query && (
                <button className="btn btn--text btn--sm" onClick={() => update({ query: undefined, pick: undefined })}>
                  Как было
                </button>
              )}
            </span>
          )}
        </div>
      </div>
    );
  }

  if (!lines.length) {
    return (
      <div className={`${cls} lyrics--plain`} ref={boxRef}>
        <div className="lyrics__toolbar">
          {sources}
          {tools}
        </div>
        {searchForm}
        {banner}
        {!banner && !autoEnabled && (
          <div className="lyrics__banner">
            У этого текста нет таймкодов.
            <span className="lyrics__banner-actions">
              <button className="btn btn--text btn--sm" onClick={() => void runAutoSync(true)}>
                Синхронизировать
              </button>
            </span>
          </div>
        )}
        {(data.plain ?? '').split('\n').map((l, i) => (
          <p key={i} className="lyrics__line lyrics__line--plain">
            {l || '\u00a0'}
          </p>
        ))}
        {footer}
      </div>
    );
  }

  return (
    <div className={cls} ref={boxRef}>
      <div className="lyrics__toolbar">
        {sources}
        {tools}
      </div>
      {searchForm}
      {offsetStrip}
      {banner}
      {lines.map((line, i) => {
        const isActive = i === active;
        const sing = isActive && karaoke && !!line.text;
        return (
          <p
            key={`${line.time}-${i}`}
            data-line={i}
            className={`lyrics__line ${isActive ? 'is-active' : ''} ${i < active ? 'is-past' : ''} ${sing ? 'is-karaoke' : ''}`}
            onClick={() => seekTo(line.time + offset)}
          >
            {sing ? <KaraokeText line={line} next={lines[i + 1]} offset={offset} /> : line.text || '♪'}
          </p>
        );
      })}
      {footer}
    </div>
  );
}

function fmtStamp(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
