import { ExternalLink, ListMusic, ListPlus, Pencil, Trash2 } from 'lucide-react';
import { Artwork } from '../components/Artwork';
import { CollectionHeader } from '../components/CollectionHeader';
import { Mosaic } from '../components/Mosaic';
import { EmptyState, ErrorState, SkeletonRows } from '../components/States';
import { TrackList } from '../components/TrackList';
import { useAsync } from '../hooks/useAsync';
import { api } from '../lib/api';
import { totalDuration, tracksLabel } from '../lib/format';
import { providerMeta } from '../lib/providers';
import type { Provider } from '../lib/types';
import { openExternal } from '../lib/window';
import { useLibrary } from '../store/library';
import { usePlayer } from '../store/player';
import { toast, useUi } from '../store/ui';

export function LocalPlaylistPage({ id }: { id: string }) {
  const playlist = useLibrary((s) => s.playlists.find((p) => p.id === id));
  const navigate = useUi((s) => s.navigate);

  if (!playlist) {
    return (
      <div className="page">
        <EmptyState
          icon={<ListMusic size={28} />}
          title="Плейлист не найден"
          action={
            <button className="btn btn--ghost" onClick={() => navigate({ name: 'library' })}>
              В медиатеку
            </button>
          }
        />
      </div>
    );
  }

  const { name, tracks } = playlist;
  const rename = () =>
    useUi.getState().openModal({
      kind: 'prompt',
      title: 'Переименовать плейлист',
      initial: name,
      confirm: 'Сохранить',
      onSubmit: (value) => useLibrary.getState().renamePlaylist(id, value),
    });
  const remove = () =>
    useUi.getState().openModal({
      kind: 'confirm',
      title: 'Удалить плейлист?',
      message: `«${name}» будет удалён без возможности восстановления.`,
      confirm: 'Удалить',
      danger: true,
      onConfirm: () => {
        useLibrary.getState().deletePlaylist(id);
        navigate({ name: 'library' });
      },
    });

  return (
    <div className="page">
      <CollectionHeader
        kind="Плейлист"
        title={name}
        art={<Mosaic tracks={tracks} className="collection-art" />}
        meta={
          tracks.length ? (
            <>
              <span>{tracksLabel(tracks.length)}</span>
              <span>{totalDuration(tracks)}</span>
            </>
          ) : (
            <span>Пустой плейлист</span>
          )
        }
        onPlay={tracks.length ? () => usePlayer.getState().playList(tracks, 0, name) : undefined}
        onShuffle={tracks.length ? () => usePlayer.getState().playShuffled(tracks, name) : undefined}
        actions={
          <>
            <button className="icon-btn" onClick={rename} title="Переименовать">
              <Pencil size={17} />
            </button>
            <button className="icon-btn" onClick={remove} title="Удалить плейлист">
              <Trash2 size={17} />
            </button>
          </>
        }
      />
      {tracks.length ? (
        <TrackList
          tracks={tracks}
          source={name}
          localPlaylistId={id}
          showHeader
          onReorder={(from, to) => useLibrary.getState().movePlaylistTrack(id, from, to)}
        />
      ) : (
        <EmptyState
          icon={<ListMusic size={28} />}
          title="Пока пусто"
          text="Добавляйте треки через меню «…» → «Добавить в плейлист»"
        />
      )}
    </div>
  );
}

export function RemotePlaylistPage({ provider, id }: { provider: Provider; id: string }) {
  const { data, loading, error, reload } = useAsync(`playlist:${provider}:${id}`, () => api.playlist(provider, id));

  if (loading) {
    return (
      <div className="page">
        <div className="collection-header collection-header--skeleton">
          <div className="skeleton collection-art" />
          <div className="collection-header__info">
            <div className="skeleton skeleton--line" style={{ width: 120 }} />
            <div className="skeleton skeleton--title" />
          </div>
        </div>
        <SkeletonRows count={10} />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="page">
        <ErrorState message={error ?? 'Плейлист не найден'} onRetry={reload} />
      </div>
    );
  }

  const { playlist, tracks } = data;
  const permalink = playlist.permalink;
  const save = () => {
    const newId = useLibrary.getState().createPlaylist(playlist.title, tracks);
    toast('Плейлист сохранён в медиатеку', 'success');
    useUi.getState().navigate({ name: 'local-playlist', id: newId });
  };

  return (
    <div className="page">
      <CollectionHeader
        kind={`${playlist.kind === 'album' ? 'Альбом' : playlist.kind === 'single' ? 'Сингл' : playlist.kind === 'ep' ? 'EP' : 'Плейлист'}${playlist.year ? ` · ${playlist.year}` : ''} · ${providerMeta(provider).label}`}
        title={playlist.title}
        description={playlist.description}
        art={<Artwork src={playlist.artwork ?? tracks[0]?.artwork} radius={14} className="collection-art" />}
        meta={
          <>
            {playlist.owner &&
              (playlist.ownerId ? (
                <button className="link" onClick={() => useUi.getState().navigate({ name: 'artist', provider, id: playlist.ownerId as string })}>
                  <strong>{playlist.owner}</strong>
                </button>
              ) : (
                <strong>{playlist.owner}</strong>
              ))}
            <span>{tracksLabel(tracks.length)}</span>
            <span>{totalDuration(tracks)}</span>
          </>
        }
        onPlay={tracks.length ? () => usePlayer.getState().playList(tracks, 0, playlist.title) : undefined}
        onShuffle={tracks.length ? () => usePlayer.getState().playShuffled(tracks, playlist.title) : undefined}
        actions={
          <>
            <button className="btn btn--ghost" onClick={save} disabled={!tracks.length}>
              <ListPlus size={16} /> Сохранить
            </button>
            {permalink && (
              <button className="icon-btn" onClick={() => void openExternal(permalink)} title="Открыть в браузере">
                <ExternalLink size={17} />
              </button>
            )}
          </>
        }
      />
      {tracks.length ? (
        <TrackList tracks={tracks} source={playlist.title} showHeader />
      ) : (
        <EmptyState title="В плейлисте нет доступных треков" />
      )}
    </div>
  );
}
