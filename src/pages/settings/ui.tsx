import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

/** Строительные блоки страницы настроек (Material 3). */

export function Group({ icon, title, subtitle, children }: { icon: ReactNode; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="settings-group">
      <header className="settings-group__head">
        <span className="settings-group__icon">{icon}</span>
        <span>
          <h2 className="settings-group__title">{title}</h2>
          {subtitle && <p className="settings-group__subtitle">{subtitle}</p>}
        </span>
      </header>
      <div className="settings-group__body">{children}</div>
    </section>
  );
}

export function Row({
  label,
  description,
  children,
  stacked = false,
}: {
  label: string;
  description?: ReactNode;
  children?: ReactNode;
  stacked?: boolean;
}) {
  return (
    <div className={`setting-row ${stacked ? 'setting-row--stacked' : ''}`}>
      <span className="setting-row__text">
        <span className="setting-row__label">{label}</span>
        {description && <span className="setting-row__desc">{description}</span>}
      </span>
      {children}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(([id, text]) => {
        const on = value === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            className={`segmented__item ${on ? 'segmented__item--on' : ''}`}
            onClick={() => onChange(id)}
          >
            {on && <Check size={16} className="segmented__check" />}
            {text}
          </button>
        );
      })}
    </div>
  );
}

export function RadioList<T extends string>({
  value,
  options,
  onChange,
  disabled,
  badge,
}: {
  value: T;
  options: { id: T; label: string; hint: string }[];
  onChange: (v: T) => void;
  disabled?: (id: T) => string | null;
  badge?: (id: T) => ReactNode;
}) {
  return (
    <div className="radio-list" role="radiogroup">
      {options.map((o) => {
        const reason = disabled?.(o.id) ?? null;
        const on = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={!!reason}
            className={`radio-item ${on ? 'radio-item--on' : ''}`}
            onClick={() => onChange(o.id)}
          >
            <span className="radio-item__dot" aria-hidden />
            <span className="radio-item__text">
              <span className="radio-item__label">
                {o.label}
                {badge?.(o.id)}
              </span>
              <span className="radio-item__hint">{reason ?? o.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
