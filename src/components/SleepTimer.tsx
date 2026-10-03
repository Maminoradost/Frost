import { Check, Moon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { sleepLeft, useSleep } from '../store/sleep';

const OPTIONS = [15, 30, 45, 60, 90];

/** Кнопка таймера сна в плеере с выпадающим меню. */
export function SleepTimer() {
  const mode = useSleep((s) => s.mode);
  const [open, setOpen] = useState(false);
  const [, setNow] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Обновляем остаток раз в 15 секунд, пока таймер активен
  useEffect(() => {
    if (mode?.kind !== 'time') return;
    const t = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, [mode]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !btnRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const rect = open ? btnRef.current?.getBoundingClientRect() : null;
  const s = useSleep.getState();
  const pick = (fn: () => void) => {
    fn();
    setOpen(false);
  };
  const left = sleepLeft(mode);

  return (
    <>
      <button
        ref={btnRef}
        className={`icon-btn sleep-btn ${mode ? 'is-on' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={mode ? `Таймер сна: ${left}` : 'Таймер сна'}
        aria-label="Таймер сна"
        aria-expanded={open}
      >
        <Moon size={17} />
        {mode?.kind === 'time' && <span className="sleep-btn__badge">{Math.max(1, Math.ceil((mode.endsAt - Date.now()) / 60_000))}</span>}
      </button>
      {open &&
        rect &&
        // Портал: у панели плеера есть backdrop-filter, внутри него position: fixed
        // считается от панели, а не от окна, и меню уезжало бы не туда
        createPortal(
          <div
            ref={menuRef}
            className="menu sleep-menu"
            role="menu"
            style={{ left: Math.min(rect.left + rect.width / 2 - 120, window.innerWidth - 256), bottom: window.innerHeight - rect.top + 12 }}
          >
            <div className="menu__label">{mode ? `Остановится: ${left}` : 'Остановить музыку через…'}</div>
            {OPTIONS.map((m) => (
              <button key={m} className="menu__item" role="menuitem" onClick={() => pick(() => s.setMinutes(m))}>
                {mode?.kind === 'time' && mode.minutes === m ? <Check size={16} /> : <span className="menu__gap" />}
                {m} минут
              </button>
            ))}
            <button className="menu__item" role="menuitem" onClick={() => pick(s.setEndOfTrack)}>
              {mode?.kind === 'track' ? <Check size={16} /> : <span className="menu__gap" />}
              В конце трека
            </button>
            {mode && (
              <>
                <div className="menu__sep" />
                <button className="menu__item menu__item--danger" role="menuitem" onClick={() => pick(s.cancel)}>
                  <span className="menu__gap" />
                  Выключить таймер
                </button>
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
