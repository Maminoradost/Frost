import { ArrowLeft, FolderPlus, HardDrive, RefreshCw, Search, X } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { Artwork } from '../components/Artwork';
import { CollectionHeader } from '../components/CollectionHeader';
import { MediaCard } from '../components/MediaCard';
import { EmptyState, Spinner } from '../components/States';
import { TrackList } from '../components/TrackList';
import { plural, totalDuration, tracksLabel } from '../lib/format';
import type { Track } from '../lib/types';
import { isTauri } from '../lib/window';
import { useLocal } from '../store/local';
import { usePlayer } from '../store/player';
import { useSettings } from '../store/settings';
import { useUi, type LocalTab } from '../store/ui';

const TABS: [LocalTab, string][] = [
  ['tracks', 'Треки'],
  ['albums', 'Альбомы'],
  ['artists', 'Артисты'],
];

const folderName = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;

const matches = (t: Track, q: string) =>
  t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q) || (t.album ?? '').toLowerCase().includes(q);

export function LocalPage({ tab }: { tab: LocalTab }) {
  const navigate = useUi((s) => s.navigate);
  const folders = useSettings((s) => s.localFolders);
  const tracks = useLocal((s) => s.tracks);
  const albums = useLocal((s) => s.albums);
  const artists = useLocal((s) => s.artists);
  const scanning = useLocal((s) => s.scanning);
  const loaded = useLocal((s) => s.loaded);
  const [query, setQuery] = useState('');
  const [albumKey, setAlbumKey] = useState<string | null>(null);
  const [artistName, setArtistName] = useState<string | null>(null);
  const q = useDeferredValue(query.trim().toLowerCase());

  const shownTracks = useMemo(() => (q ? tracks.filter((t) => matches(t, q)) : tracks), [tracks, q]);
  const shownAlbums = useMemo(
    () => (q ? albums.filter((a) => a.title.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q)) : albums),
    [albums, q],
  );
  const shownArtists = useMemo(() => (q ? artists.filter((a) => a.name.toLowerCase().includes(q)) : artists), [artists, q]);

  const { addFolder, removeFolder, scan } = useLocal.getState();
  const play = (list: Track[], title: string) => list.length && usePlayer.getState().playList(list, 0, title);
  const shuffle = (list: Track[], title: string) => list.length && usePlayer.getState().playShuffled(list, title);

  if (!isTauri) {
    return (
      <div className="page">
        <EmptyState icon={<HardDrive size={30} />} title="Доступно в приложении" text="Музыка с компьютера работает только в установленном Frost." />
      </div>
    );
  }

  if (!folders.length) {
    return (
      <div className="page">
        <div className="page-head">
          <h1 className="page-title">На компьютере</h1>
        </div>
        <EmptyState
          icon={<HardDrive size={30} />}
          title="Добавьте папку с музыкой"
          text="Frost прочитает теги и обложки файлов MP3, FLAC, OGG, Opus, M4A и WAV. Файлы остаются на месте и никуда не загружаются."
          action={
            <button className="btn btn--primary" onClick={() => void addFolder()}>
              <FolderPlus size={17} /> Выбрать папку
            </button>
          }
        />
      </div>
    );
  }

  const album = albumKey ? albums.find((a) => a.key === albumKey) : undefined;
  if (album) {
    return (
      <div className="page">
        <button className="btn btn--ghost btn--sm local-back" onClick={() => setAlbumKey(null)}>
          <ArrowLeft size={16} /> Все альбомы
        </button>
        <CollectionHeader
          kind="Альбом с компьютера"
          title={album.title}
          art={<Artwork src={album.artwork} radius={16} />}
          meta={
            <>
              <button className="link" onClick={() => setArtistName(album.artist)}>
                {album.artist}
              </button>
              {album.year && <span> · {album.year}</span>}
              <span> · {tracksLabel(album.tracks.length)}</span>
              <span> · {totalDuration(album.tracks)}</span>
            </>
          }
          onPlay={() => play(album.tracks, album.title)}
          onShuffle={() => shuffle(album.tracks, album.title)}
        />
        <TrackList tracks={album.tracks} source={album.title} showArtwork={false} showPlays={false} />
      </div>
    );
  }

  const artist = artistName ? artists.find((a) => a.name === artistName) : undefined;
  if (artist) {
    return (
      <div className="page">
        <button className="btn btn--ghost btn--sm local-back" onClick={() => setArtistName(null)}>
          <ArrowLeft size={16} /> Назад
        </button>
        <CollectionHeader
          kind="Артист с компьютера"
          title={artist.name}
          art={<Artwork src={artist.artwork} round />}
          meta={
            <>
              <span>{tracksLabel(artist.tracks.length)}</span>
              {artist.albums > 0 && <span> · {artist.albums} {plural(artist.albums, 'альбом', 'альбома', 'альбомов')}</span>}
            </>
          }
          onPlay={() => play(artist.tracks, artist.name)}
          onShuffle={() => shuffle(artist.tracks, artist.name)}
        />
        <TrackList tracks={artist.tracks} source={artist.name} showPlays={false} />
      </div>
    );
  }

  return (
    <div className="page page--local">
      <div className="page-head local-head">
        <div>
          <h1 className="page-title">На компьютере</h1>
          <div className="page-subtitle">
            {tracksLabel(tracks.length)} · {albums.length} {plural(albums.length, 'альбом', 'альбома', 'альбомов')}
            {tracks.length > 0 && ` · ${totalDuration(tracks)}`}
          </div>
        </div>
        <div className="local-head__actions">
          <button className="btn btn--primary" disabled={!tracks.length} onClick={() => play(tracks, 'На компьютере')}>
            Слушать
          </button>
          <button className="btn btn--ghost" disabled={!tracks.length} onClick={() => shuffle(tracks, 'На компьютере')}>
            Перемешать
          </button>
          <button className="btn btn--ghost" onClick={() => void addFolder()}>
            <FolderPlus size={16} /> Папка
          </button>
          <button
            className="icon-btn"
            onClick={() => void scan()}
            disabled={!!scanning}
            aria-label="Проверить папки ещё раз"
            title="Проверить папки ещё раз"
          >
            {scanning ? <Spinner size={18} /> : <RefreshCw size={18} />}
          </button>
        </div>
      </div>

      <div className="local-folders" aria-label="Папки с музыкой">
        {folders.map((f) => (
          <span key={f} className="chip chip--sm local-folder" title={f}>
            {folderName(f)}
            <button className="local-folder__remove" onClick={() => removeFolder(f)} aria-label={`Убрать папку ${folderName(f)}`}>
              <X size={13} />
            </button>
          </span>
        ))}
      </div>

      {scanning && (
        <div className="scan-progress" role="status">
          <div className="scan-progress__bar">
            <div style={{ width: `${scanning.total ? Math.round((scanning.done / scanning.total) * 100) : 4}%` }} />
          </div>
          <span>{scanning.total ? `Читаю теги: ${scanning.done} из ${scanning.total}` : 'Ищу файлы…'}</span>
        </div>
      )}

      <div className="local-toolbar">
        <div className="tabs" role="tablist">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={`tab ${tab === id ? 'is-active' : ''}`}
              onClick={() => navigate({ name: 'local', tab: id })}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="local-filter">
          <Search size={16} aria-hidden />
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Фильтр по названию, артисту, альбому"
            aria-label="Фильтр"
          />
        </label>
      </div>

      {loaded && !tracks.length && !scanning && (
        <EmptyState
          icon={<HardDrive size={30} />}
          title="Музыки пока нет"
          text="В выбранных папках не нашлось поддерживаемых файлов. Добавьте другую папку или проверьте эту ещё раз."
          action={
            <button className="btn btn--ghost" onClick={() => void scan()}>
              <RefreshCw size={16} /> Проверить
            </button>
          }
        />
      )}

      {tab === 'tracks' && shownTracks.length > 0 && <TrackList tracks={shownTracks} source="На компьютере" showHeader showPlays={false} />}

      {tab === 'albums' && (
        <div className="card-grid">
          {shownAlbums.map((a) => (
            <MediaCard
              key={a.key}
              title={a.title}
              subtitle={a.year ? `${a.artist} · ${a.year}` : a.artist}
              image={a.artwork}
              onClick={() => setAlbumKey(a.key)}
              onPlay={() => play(a.tracks, a.title)}
            />
          ))}
        </div>
      )}

      {tab === 'artists' && (
        <div className="card-grid">
          {shownArtists.map((a) => (
            <MediaCard
              key={a.name}
              round
              title={a.name}
              subtitle={tracksLabel(a.tracks.length)}
              image={a.artwork}
              onClick={() => setArtistName(a.name)}
              onPlay={() => play(a.tracks, a.name)}
            />
          ))}
        </div>
      )}

      {q && !shownTracks.length && !shownAlbums.length && !shownArtists.length && (
        <EmptyState icon={<Search size={28} />} title="Ничего не нашлось" text={`По запросу «${query.trim()}» совпадений нет.`} />
      )}
    </div>
  );
}
