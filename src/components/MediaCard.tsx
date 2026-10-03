import { Play } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import type { Track } from '../lib/types';
import { usePlayer } from '../store/player';
import { Artwork } from './Artwork';
import { EqBars } from './EqBars';

interface MediaCardProps {
  title: string;
  subtitle?: ReactNode;
  image?: string | null;
  art?: ReactNode;
  round?: boolean;
  onClick?: () => void;
  onPlay?: () => void;
}

/** Карточка плейлиста/исполнителя в сетке. */
export function MediaCard({ title, subtitle, image, art, round = false, onClick, onPlay }: MediaCardProps) {
  return (
    <div
      className={`card ${round ? 'card--round' : ''}`}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onClick?.();
      }}
    >
      <div className="card__art">
        {art ?? <Artwork src={image} round={round} radius={12} className="card__img" />}
        {onPlay && (
          <button
            className="card__play"
            onClick={(e) => {
              e.stopPropagation();
              onPlay();
            }}
            aria-label="Слушать"
          >
            <Play size={20} fill="currentColor" />
          </button>
        )}
      </div>
      <div className="card__title" title={title}>
        {title}
      </div>
      {subtitle && <div className="card__subtitle">{subtitle}</div>}
    </div>
  );
}

/** Плитка «Недавнее» на главной (как быстрые подборки у Spotify). */
export function QuickTile({ track, onPlay }: { track: Track; onPlay: () => void }) {
  const active = usePlayer((s) => s.current?.id === track.id && s.current?.provider === track.provider);
  const playing = usePlayer((s) => s.isPlaying);
  return (
    <button className={`quick-tile ${active ? 'is-active' : ''}`} onClick={onPlay} title={`${track.title} · ${track.artist}`}>
      <Artwork src={track.artworkSmall ?? track.artwork} size={56} radius={0} className="quick-tile__art" />
      <span className="quick-tile__text">
        <span className="quick-tile__title">{track.title}</span>
        <span className="quick-tile__artist">{track.artist}</span>
      </span>
      {active ? (
        <span className="quick-tile__eq">
          <EqBars paused={!playing} />
        </span>
      ) : (
        <span className="quick-tile__play">
          <Play size={16} fill="currentColor" />
        </span>
      )}
    </button>
  );
}

interface GenreTileProps {
  label: string;
  /** Цвет жанра: только лёгкий тональный оттенок плитки и точка. */
  color?: string | null;
  subtitle?: string;
  icon?: ReactNode;
  onClick: () => void;
}

/** Плитка жанра в стиле Material You: тональная поверхность, иконка в «пилюле», без градиентов. */
export function GenreTile({ label, color, subtitle, icon, onClick }: GenreTileProps) {
  return (
    <button className="genre-tile" style={{ '--tile': color ?? 'var(--md-primary)' } as CSSProperties} onClick={onClick}>
      <span className="genre-tile__icon" aria-hidden>
        {icon ?? <span className="genre-tile__dot" />}
      </span>
      <span className="genre-tile__text">
        <span className="genre-tile__label">{label}</span>
        {subtitle && <span className="genre-tile__sub">{subtitle}</span>}
      </span>
    </button>
  );
}
