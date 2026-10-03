import { ListMusic, X } from 'lucide-react';
import type { Track } from '../lib/types';
import { trackKey } from '../lib/types';
import { useDragSort, type DragItemProps } from '../hooks/useDragSort';
import { usePlayer } from '../store/player';
import { useUi } from '../store/ui';
import { Artwork } from './Artwork';
import { EqBars } from './EqBars';
import { LyricsView } from './Lyrics';
import { EmptyState } from './States';

/** Правая панель: очередь или текст песни. */
export function SidePanel() {
  const panel = useUi((s) => s.panel);
  const close = useUi((s) => s.closePanel);
  const track = usePlayer((s) => s.current);
  if (!panel) return null;

  return (
    <aside className="side-panel">
      <header className="side-panel__head">
        <h3>{panel === 'queue' ? 'Очередь' : 'Текст песни'}</h3>
        <button className="icon-btn icon-btn--sm" onClick={close} title="Закрыть">
          <X size={16} />
        </button>
      </header>
      <div className="side-panel__body">
        {panel === 'queue' ? (
          <QueueList />
        ) : track ? (
          <LyricsView key={trackKey(track)} track={track} />
        ) : (
          <EmptyState title="Ничего не играет" text="Включите трек, чтобы увидеть текст" />
        )}
      </div>
    </aside>
  );
}

export function QueueList() {
  const current = usePlayer((s) => s.current);
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const upNext = usePlayer((s) => s.upNext);
  const source = usePlayer((s) => s.source);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const rest = queue.slice(index + 1, index + 101);
  const { itemProps } = useDragSort(upNext.length, (from, to) => usePlayer.getState().moveUpNext(from, to));

  if (!current) {
    return <EmptyState icon={<ListMusic size={28} />} title="Очередь пуста" text="Включите трек или плейлист" />;
  }

  return (
    <div className="queue">
      <div className="queue__label">Сейчас играет</div>
      <QueueItem track={current} active playing={isPlaying} />

      {upNext.length > 0 && (
        <>
          <div className="queue__label">
            <span>Далее в очереди</span>
            <button className="link link--small" onClick={() => usePlayer.getState().clearUpNext()}>
              Очистить
            </button>
          </div>
          {upNext.map((t, i) => (
            <QueueItem
              key={`u:${trackKey(t)}:${i}`}
              track={t}
              onPlay={() => usePlayer.getState().jumpToUpNext(i)}
              onRemove={() => usePlayer.getState().removeFromUpNext(i)}
              drag={itemProps(i)}
            />
          ))}
        </>
      )}

      {rest.length > 0 && (
        <>
          <div className="queue__label">
            <span>Далее из: {source ?? 'текущего списка'}</span>
          </div>
          {rest.map((t, j) => (
            <QueueItem
              key={`q:${trackKey(t)}:${j}`}
              track={t}
              onPlay={() => usePlayer.getState().jumpToQueue(index + 1 + j)}
            />
          ))}
        </>
      )}
    </div>
  );
}

function QueueItem({
  track,
  active = false,
  playing = false,
  onPlay,
  onRemove,
  drag,
}: {
  track: Track;
  active?: boolean;
  playing?: boolean;
  onPlay?: () => void;
  onRemove?: () => void;
  drag?: DragItemProps;
}) {
  return (
    <div
      className={`queue-item ${active ? 'is-active' : ''} ${drag?.dragClass ?? ''}`}
      onDoubleClick={onPlay}
      draggable={drag?.draggable}
      onDragStart={drag?.onDragStart}
      onDragOver={drag?.onDragOver}
      onDrop={drag?.onDrop}
      onDragEnd={drag?.onDragEnd}
      onKeyDown={drag?.onKeyDown}
      title={drag ? 'Перетащите, чтобы изменить порядок (или Alt и стрелки)' : undefined}
    >
      <button className="queue-item__art" onClick={onPlay} disabled={!onPlay} aria-label={`Воспроизвести ${track.title}`}>
        <Artwork src={track.artworkSmall ?? track.artwork} size={40} radius={6} />
        {active && (
          <span className="queue-item__eq">
            <EqBars paused={!playing} />
          </span>
        )}
      </button>
      <div className="queue-item__text">
        <div className="queue-item__title">{track.title}</div>
        <div className="queue-item__artist">{track.artist}</div>
      </div>
      {onRemove && (
        <button className="icon-btn icon-btn--xs queue-item__remove" onClick={onRemove} title="Убрать из очереди" aria-label="Убрать из очереди">
          <X size={14} />
        </button>
      )}
    </div>
  );
}
