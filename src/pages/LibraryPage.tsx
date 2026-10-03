import { Clock, FileUp, Heart, Plus, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ImportPanel } from '../components/ImportPanel';
import { MediaCard } from '../components/MediaCard';
import { Mosaic } from '../components/Mosaic';
import { promptCreatePlaylist } from '../components/Sidebar';
import { EmptyState } from '../components/States';
import { TrackList } from '../components/TrackList';
import { timeAgo, tracksLabel } from '../lib/format';
import { providerMeta } from '../lib/providers';
import { useLibrary } from '../store/library';
import { usePlayer } from '../store/player';
import { useUi, type LibraryTab } from '../store/ui';

const TABS: [LibraryTab, string][] = [
  ['playlists', 'Плейлисты'],
  ['artists', 'Исполнители'],
  ['history', 'История'],
];

export function LibraryPage({ tab }: { tab: LibraryTab }) {
  const navigate = useUi((s) => s.navigate);
  const playlists = useLibrary((s) => s.playlists);
  const followed = useLibrary((s) => s.followed);
  const history = useLibrary((s) => s.history);
  const liked = useLibrary((s) => s.liked);
  const historyTracks = useMemo(() => history.map((h) => h.track), [history]);
  const [importing, setImporting] = useState(false);

  const clearHistory = () =>
    useUi.getState().openModal({
      kind: 'confirm',
      title: 'Очистить историю?',
      message: 'Список прослушанных треков будет удалён.',
      confirm: 'Очистить',
      danger: true,
      onConfirm: () => useLibrary.getState().clearHistory(),
    });

  return (
    <div className="page">
      <div className="page-head page-head--row">
        <h1 className="page-title">Медиатека</h1>
        {tab === 'playlists' && !importing && (
          <button className="btn btn--ghost btn--sm" onClick={() => setImporting(true)}>
            <FileUp size={15} /> Импорт плейлиста
          </button>
        )}
      </div>
      <div className="tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`tab ${tab === id ? 'is-active' : ''}`}
            onClick={() => navigate({ name: 'library', tab: id })}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'playlists' && importing && <ImportPanel onClose={() => setImporting(false)} />}
      {tab === 'playlists' && (
        <div className="card-grid">
          <MediaCard
            title="Любимые треки"
            subtitle={tracksLabel(liked.length)}
            art={
              <div className="liked-art card__img">
                <Heart size={40} fill="currentColor" />
              </div>
            }
            onClick={() => navigate({ name: 'liked' })}
            onPlay={liked.length ? () => usePlayer.getState().playList(liked, 0, 'Любимые треки') : undefined}
          />
          {playlists.map((p) => (
            <MediaCard
              key={p.id}
              title={p.name}
              subtitle={tracksLabel(p.tracks.length)}
              art={<Mosaic tracks={p.tracks} className="card__img" />}
              onClick={() => navigate({ name: 'local-playlist', id: p.id })}
              onPlay={p.tracks.length ? () => usePlayer.getState().playList(p.tracks, 0, p.name) : undefined}
            />
          ))}
          <button className="card card--new" onClick={promptCreatePlaylist}>
            <div className="card__art">
              <div className="card__img card__new-art">
                <Plus size={34} />
              </div>
            </div>
            <div className="card__title">Новый плейлист</div>
          </button>
        </div>
      )}

      {tab === 'artists' &&
        (followed.length ? (
          <div className="card-grid">
            {followed.map((a) => (
              <MediaCard
                key={`${a.provider}:${a.id}`}
                title={a.name}
                subtitle={providerMeta(a.provider).label}
                image={a.avatar}
                round
                onClick={() => navigate({ name: 'artist', provider: a.provider, id: a.id })}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Users size={28} />}
            title="Вы ни на кого не подписаны"
            text="Откройте страницу исполнителя и нажмите «Подписаться»"
          />
        ))}

      {tab === 'history' &&
        (history.length ? (
          <>
            <div className="toolbar">
              <span className="muted">
                {tracksLabel(history.length)} · последний {timeAgo(history[0].playedAt)}
              </span>
              <button className="btn btn--ghost btn--sm" onClick={clearHistory}>
                Очистить историю
              </button>
            </div>
            <TrackList tracks={historyTracks} source="История" />
          </>
        ) : (
          <EmptyState icon={<Clock size={28} />} title="История пуста" text="Здесь появятся треки, которые вы слушали" />
        ))}
    </div>
  );
}
