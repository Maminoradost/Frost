import { Clock, Ellipsis, Heart, Pause, Play } from 'lucide-react';
import { memo, useEffect, useRef, useState, type MouseEvent } from 'react';
import { useDragSort, type DragItemProps } from '../hooks/useDragSort';
import { formatCount, formatTime } from '../lib/format';
import type { Track } from '../lib/types';
import { trackKey } from '../lib/types';
import { useLibrary } from '../store/library';
import { usePlayer } from '../store/player';
import { useUi } from '../store/ui';
import { Artwork } from './Artwork';
import { EqBars } from './EqBars';
import { trackMenuItems } from './menus';
import { ProviderBadge } from './ProviderBadge';

interface TrackListProps {
  tracks: Track[];
  /** Подпись контекста для очереди («Плейлист X», «Поиск: Y»). */
  source?: string;
  showHeader?: boolean;
  showArtwork?: boolean;
  showPlays?: boolean;
  localPlaylistId?: string;
  onPlay?: (index: number) => void;
  /** Перестановка перетаскиванием (локальные плейлисты). */
  onReorder?: (from: number, to: number) => void;
}

/** Длинные списки дорисовываются порциями по мере прокрутки. */
const STEP = 200;

export function TrackList({
  tracks,
  source,
  showHeader = false,
  showArtwork = true,
  showPlays = true,
  localPlaylistId,
  onPlay,
  onReorder,
}: TrackListProps) {
  const [limit, setLimit] = useState(STEP);
  const sentinel = useRef<HTMLDivElement>(null);
  const { itemProps } = useDragSort(tracks.length, (from, to) => onReorder?.(from, to));
  useEffect(() => {
    const el = sentinel.current;
    if (!el || tracks.length <= limit) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setLimit((l) => l + STEP * 2), {
      rootMargin: '1500px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [tracks.length, limit]);
  const visible = tracks.length > limit ? tracks.slice(0, limit) : tracks;
  const currentKey = usePlayer((s) => (s.current ? trackKey(s.current) : null));
  const isPlaying = usePlayer((s) => s.isPlaying);
  const likedKeys = useLibrary((s) => s.likedKeys);

  const play = (index: number) => {
    if (onPlay) onPlay(index);
    else usePlayer.getState().playList(tracks, index, source ?? null);
  };

  return (
    <div className="tracklist" role="list">
      {showHeader && (
        <div className="track-row track-row--header" aria-hidden>
          <span className="track-row__index">#</span>
          <span>Название</span>
          <span className="track-row__meta">Источник</span>
          <span />
          <span className="track-row__duration">
            <Clock size={15} />
          </span>
          <span />
        </div>
      )}
      {visible.map((t, i) => {
        const key = trackKey(t);
        return (
          <TrackRow
            key={`${key}:${i}`}
            track={t}
            index={i}
            active={key === currentKey}
            playing={isPlaying}
            liked={!!likedKeys[key]}
            showArtwork={showArtwork}
            showPlays={showPlays}
            localPlaylistId={localPlaylistId}
            onPlay={play}
            drag={onReorder ? itemProps(i) : undefined}
          />
        );
      })}
      {visible.length < tracks.length && <div ref={sentinel} className="tracklist__more" aria-hidden />}
    </div>
  );
}

interface RowProps {
  track: Track;
  index: number;
  active: boolean;
  playing: boolean;
  liked: boolean;
  showArtwork: boolean;
  showPlays: boolean;
  localPlaylistId?: string;
  onPlay: (index: number) => void;
  drag?: DragItemProps;
}

const TrackRow = memo(function TrackRow({
  track,
  index,
  active,
  playing,
  liked,
  showArtwork,
  showPlays,
  localPlaylistId,
  onPlay,
  drag,
}: RowProps) {
  const handlePlay = () => {
    if (active) usePlayer.getState().togglePlay();
    else onPlay(index);
  };
  const openMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    useUi.getState().openMenu(e.clientX, e.clientY, trackMenuItems(track, { localPlaylistId, index }));
  };
  const artistId = track.artistId;

  return (
    <div
      className={`track-row ${active ? 'is-active' : ''} ${track.streamable ? '' : 'is-disabled'} ${drag?.dragClass ?? ''}`}
      role="listitem"
      onDoubleClick={() => onPlay(index)}
      onContextMenu={openMenu}
      draggable={drag?.draggable}
      onDragStart={drag?.onDragStart}
      onDragOver={drag?.onDragOver}
      onDrop={drag?.onDrop}
      onDragEnd={drag?.onDragEnd}
      onKeyDown={drag?.onKeyDown}
      aria-label={drag ? `${track.title}. Alt и стрелки меняют порядок` : undefined}
    >
      <div className="track-row__index">
        <span className="track-row__num">{active ? <EqBars paused={!playing} /> : index + 1}</span>
        <button className="track-row__play" onClick={handlePlay} aria-label={active && playing ? 'Пауза' : `Воспроизвести ${track.title}`}>
          {active && playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
        </button>
      </div>

      <div className="track-row__main">
        {showArtwork && <Artwork src={track.artworkSmall ?? track.artwork} size={42} radius={6} />}
        <div className="track-row__text">
          <div className="track-row__title" title={track.title}>
            {track.title}
            {track.previewOnly && <span className="tag">30 сек</span>}
          </div>
          <div className="track-row__artist">
            {artistId ? (
              <button
                className="link"
                onClick={(e) => {
                  e.stopPropagation();
                  useUi.getState().navigate({ name: 'artist', provider: track.provider, id: artistId });
                }}
              >
                {track.artist}
              </button>
            ) : (
              track.artist
            )}
          </div>
        </div>
      </div>

      <div className="track-row__meta">
        <ProviderBadge provider={track.provider} />
        {showPlays && track.plays != null && <span className="track-row__plays">{formatCount(track.plays)}</span>}
      </div>

      <button
        className={`icon-btn icon-btn--sm like ${liked ? 'is-liked' : ''}`}
        onClick={() => useLibrary.getState().toggleLike(track)}
        title={liked ? 'Убрать из любимых' : 'В любимые'}
      >
        <Heart size={16} fill={liked ? 'currentColor' : 'none'} />
      </button>
      <div className="track-row__duration">{formatTime(track.duration)}</div>
      <button className="icon-btn icon-btn--sm track-row__more" onClick={openMenu} title="Ещё">
        <Ellipsis size={16} />
      </button>
    </div>
  );
});
