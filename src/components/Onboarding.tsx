import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { SEED_PRESETS } from '../lib/material';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';
import { Logo } from './Logo';
import { TelegramIcon, openTelegram } from './Telegram';

/**
 * Знакомство при первом запуске: приветствие, затем «прожектор», который плавно
 * перелетает между настоящими элементами интерфейса (якоря data-tour), и финал с
 * выбором цвета и ссылкой на канал. Повторить можно из Настроек.
 */

interface Step {
  target?: string;
  title: string;
  text: string;
  placement?: 'right' | 'top' | 'bottom';
}

const STEPS: Step[] = [
  {
    title: 'Добро пожаловать во Frost',
    text: 'Музыка из YouTube Music и SoundCloud без регистрации, ключей и рекламы. Покажу, где что находится: это займёт полминуты.',
  },
  {
    target: 'search',
    title: 'Поиск',
    text: 'Треки, артисты и альбомы сразу в YouTube Music и SoundCloud. Откройте его из любого места клавишами Ctrl + K. Сюда же можно вставить ссылку на трек или плейлист.',
    placement: 'bottom',
  },
  {
    target: 'nav',
    title: 'Навигация',
    text: 'На главной чарты, жанры и новинки. Медиатека собирает всё, что вы сохранили.',
    placement: 'right',
  },
  {
    target: 'library',
    title: 'Ваша музыка',
    text: 'Любимые треки, история и плейлисты хранятся на этом компьютере. Аккаунт не нужен.',
    placement: 'right',
  },
  {
    target: 'player',
    title: 'Плеер',
    text: 'Пробел ставит паузу, Ctrl + ← / → переключают треки. Метка SC или YT показывает источник, а пометка «через…» появляется, когда Frost сам нашёл полную версию трека в другом месте.',
    placement: 'top',
  },
  {
    target: 'player-side',
    title: 'Тексты, очередь и таймер сна',
    text: 'Синхронизированные тексты из LRCLIB и Genius, очередь, таймер сна, громкость и экран «Сейчас играет».',
    placement: 'top',
  },
  {
    target: 'settings',
    title: 'Настройки',
    text: 'Оформление Material You, фон окна, эквалайзер, источники и сеть. Там же можно пройти это знакомство ещё раз.',
    placement: 'right',
  },
  { title: 'Всё готово!', text: 'Выберите цвет интерфейса. Когда заиграет музыка, палитра подстроится под обложку.' },
];

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
  radius: number;
}

const CARD_W = 360;
const PAD = 6;

function measure(target?: string): Rect | null {
  if (!target) return null;
  const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return null;
  const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 16;
  return {
    top: r.top - PAD,
    left: r.left - PAD,
    width: r.width + PAD * 2,
    height: r.height + PAD * 2,
    radius: Math.min(radius + PAD, 36),
  };
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

function cardPosition(rect: Rect, placement: Step['placement']): CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const gap = 18;
  let place = placement ?? 'bottom';
  if (place === 'right' && rect.left + rect.width + gap + CARD_W > vw - 16) place = 'bottom';
  if (place === 'bottom' && rect.top + rect.height + gap + 230 > vh) place = 'top';
  if (place === 'top' && rect.top - gap - 230 < 0) place = 'bottom';
  if (place === 'right') {
    return { left: rect.left + rect.width + gap, top: clamp(rect.top, 16, vh - 280) };
  }
  const left = clamp(rect.left + rect.width / 2 - CARD_W / 2, 16, vw - CARD_W - 16);
  return place === 'bottom' ? { left, top: rect.top + rect.height + gap } : { left, bottom: vh - rect.top + gap };
}

export function Onboarding() {
  const done = useSettings((s) => s.onboardingDone);
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  // Старт: после заставки (и сразу, если знакомство запустили из настроек)
  useEffect(() => {
    if (done) {
      setActive(false);
      return;
    }
    // Сразу после запуска ждём, пока уйдёт заставка; из настроек стартуем почти сразу
    const delay = performance.now() < 10_000 ? 1600 : 250;
    const t = window.setTimeout(() => {
      setStep(0);
      setActive(true);
    }, delay);
    return () => window.clearTimeout(t);
  }, [done]);

  const current = STEPS[step];

  // Замер цели: сразу, после анимаций раскладки и при изменении размера окна
  useEffect(() => {
    if (!active) return;
    const update = () => setRect(measure(current.target));
    update();
    const t1 = window.setTimeout(update, 120);
    const t2 = window.setTimeout(update, 420);
    window.addEventListener('resize', update);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener('resize', update);
    };
  }, [active, current]);

  const finish = useCallback(() => {
    setActive(false);
    useSettings.getState().update({ onboardingDone: true });
  }, []);

  const next = useCallback(() => {
    if (step >= STEPS.length - 1) finish();
    else setStep(step + 1);
  }, [step, finish]);

  const back = useCallback(() => setStep((s) => Math.max(0, s - 1)), []);

  // Клавиатура: перехватываем до глобальных горячих клавиш (пробел не должен ставить паузу)
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const handled = ['ArrowRight', 'ArrowLeft', 'Enter', 'Escape', ' '].includes(e.key);
      if (!handled) return;
      e.stopImmediatePropagation();
      // Enter и пробел на кнопке карточки («Назад», «Пропустить», цвет) нажимают саму кнопку
      const onButton = e.target instanceof Element && e.target.closest('.tour button') !== null;
      if ((e.key === 'Enter' || e.key === ' ') && onButton) return;
      e.preventDefault();
      if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') next();
      else if (e.key === 'ArrowLeft') back();
      else finish();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [active, next, back, finish]);

  // Во время знакомства всегда на главной: там все якоря на месте
  useEffect(() => {
    if (active) useUi.getState().navigate({ name: 'home' });
  }, [active]);

  if (!active) return null;

  const centered = !rect;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const hole: CSSProperties = rect
    ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height, borderRadius: rect.radius }
    : { top: vh / 2, left: vw / 2, width: 0, height: 0, borderRadius: 999 };
  const isFirst = step === 0;
  const isLast = step === STEPS.length - 1;

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <div className={`tour__hole ${centered ? 'tour__hole--none' : ''}`} style={hole} />
      <div
        key={step}
        className={`tour__card ${centered ? 'tour__card--center' : ''} ${isFirst || isLast ? 'tour__card--hero' : ''}`}
        style={rect ? cardPosition(rect, current.placement) : undefined}
      >
        {(isFirst || isLast) && (
          <div className="tour__logo">
            <Logo size={72} />
          </div>
        )}
        {!isFirst && !isLast && (
          <div className="tour__count">
            Шаг {step} из {STEPS.length - 2}
          </div>
        )}
        <h2 id="tour-title" className="tour__title">
          {current.title}
        </h2>
        <p className="tour__text" aria-live="polite">
          {current.text}
        </p>

        {isLast && <FinalExtras />}

        <div className="tour__dots" aria-hidden>
          {STEPS.map((_, i) => (
            <span key={i} className={`tour__dot ${i === step ? 'is-on' : ''} ${i < step ? 'is-past' : ''}`} />
          ))}
        </div>

        <div className="tour__actions">
          {isFirst ? (
            <button className="btn btn--text" onClick={finish}>
              Пропустить
            </button>
          ) : !isLast ? (
            <button className="btn btn--text" onClick={back}>
              <ArrowLeft size={16} /> Назад
            </button>
          ) : (
            <span />
          )}
          <button className="btn btn--filled" onClick={next} autoFocus>
            {isFirst ? 'Показать' : isLast ? 'Начать слушать' : 'Далее'}
            {isLast ? <Check size={16} /> : <ArrowRight size={16} />}
          </button>
        </div>
        {!isFirst && !isLast && (
          <button className="tour__skip" onClick={finish}>
            Пропустить
          </button>
        )}
      </div>
    </div>
  );
}

function FinalExtras() {
  const seed = useSettings((s) => s.seedColor).toLowerCase();
  return (
    <>
      <div className="seed-row tour__seeds">
        {SEED_PRESETS.map((p) => {
          const on = seed === p.color.toLowerCase();
          return (
            <button
              key={p.color}
              className={`seed ${on ? 'seed--on' : ''}`}
              style={{ '--seed': p.color } as CSSProperties}
              title={p.name}
              aria-label={p.name}
              aria-pressed={on}
              onClick={() => useSettings.getState().update({ seedColor: p.color })}
            >
              {on && <Check size={16} />}
            </button>
          );
        })}
      </div>
      <button className="tour__tg" onClick={openTelegram}>
        <TelegramIcon size={32} />
        <span>
          <strong>Канал Frost в Telegram</strong>
          <span>Новости, обновления и место, где можно предложить идею</span>
        </span>
        <ArrowRight size={16} />
      </button>
    </>
  );
}
