import { CircleAlert, LoaderCircle, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';

export function Spinner({ size = 18 }: { size?: number }) {
  return <LoaderCircle className="spin" size={size} />;
}

export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon?: ReactNode;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state__icon">{icon}</div>}
      <div className="empty-state__title">{title}</div>
      {text && <div className="empty-state__text">{text}</div>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-state">
      <CircleAlert size={18} />
      <span className="error-state__text">{message}</span>
      {onRetry && (
        <button className="btn btn--ghost btn--sm" onClick={onRetry}>
          <RefreshCw size={14} /> Повторить
        </button>
      )}
    </div>
  );
}

export function SkeletonRows({ count = 6 }: { count?: number }) {
  return (
    <div className="skeleton-list">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton-row">
          <div className="skeleton skeleton--art" />
          <div className="skeleton-row__lines">
            <div className="skeleton skeleton--line" style={{ width: `${38 + ((i * 17) % 34)}%` }} />
            <div className="skeleton skeleton--line skeleton--short" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 6 }: { count?: number }) {
  return (
    <div className="card-grid">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card card--skeleton">
          <div className="skeleton skeleton--card" />
          <div className="skeleton skeleton--line" style={{ width: '70%' }} />
          <div className="skeleton skeleton--line skeleton--short" />
        </div>
      ))}
    </div>
  );
}

export function Notice({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="notice">
      <CircleAlert size={18} className="notice__icon" />
      <div className="notice__text">{children}</div>
      {action}
    </div>
  );
}

export function Section({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section">
      <div className="section__head">
        <div>
          <h2 className="section__title">{title}</h2>
          {subtitle && <div className="section__subtitle">{subtitle}</div>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function LoadMore({ next, loading, onClick }: { next: string | null; loading: boolean; onClick: () => void }) {
  if (!next) return null;
  return (
    <div className="load-more">
      <button className="btn btn--ghost" onClick={onClick} disabled={loading}>
        {loading ? <Spinner size={16} /> : null} Показать ещё
      </button>
    </div>
  );
}
