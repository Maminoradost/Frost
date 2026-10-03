import { Play, Shuffle } from 'lucide-react';
import type { ReactNode } from 'react';

interface CollectionHeaderProps {
  kind: string;
  title: string;
  art: ReactNode;
  meta?: ReactNode;
  description?: string | null;
  onPlay?: () => void;
  onShuffle?: () => void;
  actions?: ReactNode;
}

export function CollectionHeader({ kind, title, art, meta, description, onPlay, onShuffle, actions }: CollectionHeaderProps) {
  return (
    <header className="collection-header">
      <div className="collection-header__art">{art}</div>
      <div className="collection-header__info">
        <div className="eyebrow">{kind}</div>
        <h1 className="collection-header__title">{title}</h1>
        {description && <p className="collection-header__desc">{description}</p>}
        {meta && <div className="collection-header__meta">{meta}</div>}
        <div className="collection-header__actions">
          {onPlay && (
            <button className="btn btn--primary" onClick={onPlay}>
              <Play size={17} fill="currentColor" /> Слушать
            </button>
          )}
          {onShuffle && (
            <button className="btn btn--ghost" onClick={onShuffle}>
              <Shuffle size={16} /> Перемешать
            </button>
          )}
          {actions}
        </div>
      </div>
    </header>
  );
}
