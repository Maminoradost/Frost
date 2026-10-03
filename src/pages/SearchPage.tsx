import { Link2, Music2, SearchX, Sparkles } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { GenreTile, MediaCard } from '../components/MediaCard';
import { EmptyState, ErrorState, LoadMore, Section, SkeletonCards, SkeletonRows } from '../components/States';
import { TrackList } from '../components/TrackList';
import { useAsync, usePaged } from '../hooks/useAsync';
import { useDebounce } from '../hooks/useDebounce';
import { followersLabel, playRemotePlaylist } from '../lib/actions';
import { api } from '../lib/api';
import { providerMeta } from '../lib/providers';
import { SC_GENRES } from '../lib/soundcloud';
import type { Artist, Playlist, SearchResults, SearchSource, SourceProvider, Track } from '../lib/types';
import { DEFAULT_CONFIG } from '../lib/types';
import { usePlayer } from '../store/player';
import { useSettings } from '../store/settings';
import { navigate, useUi } from '../store/ui';

type Tab = 'all' | 'tracks' | 'artists' | 'albums' | 'playlists';
const TABS: [Tab, string][] = [
  ['all', 'Всё'],
  ['tracks', 'Треки'],
  ['artists', 'Исполнители'],
  ['albums', 'Альбомы'],
  ['playlists', 'Плейлисты'],
];

const SOURCES: [SearchSource, string][] = [
  ['all', 'Все источники'],
  ['youtube', 'YouTube Music'],
  ['soundcloud', 'SoundCloud'],
];

const isLink = (q: string) => /^https?:\/\//i.test(q.trim());

/** Чередует выдачу двух источников: лучшие результаты обоих вверху. */
function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

export function SearchPage() {
  const query = useUi((s) => s.searchQuery);
  const source = useUi((s) => s.searchProvider);
  const setSource = useUi((s) => s.setSearchProvider);
  const config = useSettings((s) => s.config) ?? DEFAULT_CONFIG;
  const [tab, setTab] = useState<Tab>('all');
  const q = useDebounce(query.trim(), 350);

  const enabled: SourceProvider[] = useMemo(
    () => (['youtube', 'soundcloud'] as SourceProvider[]).filter((p) => (p === 'youtube' ? config.youtube : config.soundcloud)),
    [config.youtube, config.soundcloud],
  );
  const active = source === 'all' ? enabled : enabled.filter((p) => p === source);

  if (!q) return <SearchHome />;
  if (isLink(q)) return <LinkResult link={q} />;

  return (
    <div className="page page--search">
      <div className="search-bar-row">
        <div className="segmented" role="tablist" aria-label="Источник">
          {SOURCES.filter(([s]) => s === 'all' || enabled.includes(s as SourceProvider)).map(([s, label]) => (
            <button key={s} className={`segmented__item ${source === s ? 'segmented__item--on' : ''}`} onClick={() => setSource(s)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map(([t, label]) => (
          <button key={t} className={`tab ${tab === t ? 'tab--on' : ''}`} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>

      {active.length === 0 ? (
        <EmptyState icon={<SearchX size={28} />} title="Все источники выключены" text="Включите SoundCloud или YouTube Music в настройках" />
      ) : tab === 'all' ? (
        <AllResults query={q} providers={active} onTab={setTab} />
      ) : tab === 'tracks' ? (
        active.map((p) => <TracksResults key={p} provider={p} query={q} titled={active.length > 1} />)
      ) : (
        <CollectionResults query={q} providers={active} tab={tab} />
      )}
    </div>
  );
}

function useSearchAll(provider: SourceProvider, query: string, on: boolean) {
  return useAsync(on ? `search:${provider}:${query}` : null, () => api.searchAll(provider, query));
}

function AllResults({ query, providers, onTab }: { query: string; providers: SourceProvider[]; onTab: (t: Tab) => void }) {
  const yt = useSearchAll('youtube', query, providers.includes('youtube'));
  const sc = useSearchAll('soundcloud', query, providers.includes('soundcloud'));
  const states = [providers.includes('youtube') ? yt : null, providers.includes('soundcloud') ? sc : null].filter(
    (s): s is typeof yt => s !== null,
  );
  const loading = states.every((s) => s.loading && !s.data);
  const errors = states.filter((s) => s.error).map((s) => s.error as string);
  const pick = (f: (r: SearchResults) => Track[] | Artist[] | Playlist[]) => [yt.data ? f(yt.data) : [], sc.data ? f(sc.data) : []];

  const [ytTracks, scTracks] = pick((r) => r.tracks) as [Track[], Track[]];
  const tracks = interleave(ytTracks.slice(0, 6), scTracks.slice(0, 6)).slice(0, 10);
  const [ytArtists, scArtists] = pick((r) => r.artists) as [Artist[], Artist[]];
  const artists = interleave(ytArtists.slice(0, 6), scArtists.slice(0, 6)).slice(0, 10);
  const [ytAlbums, scAlbums] = pick((r) => r.albums) as [Playlist[], Playlist[]];
  const albums = [...ytAlbums.slice(0, 8), ...scAlbums.slice(0, 4)].slice(0, 10);
  const [ytLists, scLists] = pick((r) => r.playlists) as [Playlist[], Playlist[]];
  const playlists = interleave(ytLists.slice(0, 5), scLists.slice(0, 5)).slice(0, 10);
  const corrected = yt.data?.corrected;
  const top = tracks[0];

  if (loading) return <SkeletonRows count={8} />;
  if (states.length && errors.length === states.length) {
    return <ErrorState message={errors[0]} onRetry={() => states.forEach((s) => s.reload())} />;
  }
  if (!tracks.length && !artists.length && !albums.length && !playlists.length) {
    return <EmptyState icon={<SearchX size={28} />} title="Ничего не найдено" text="Попробуйте написать иначе или выбрать другой источник" />;
  }

  return (
    <>
      {corrected && corrected.toLowerCase() !== query.toLowerCase() && (
        <p className="did-you-mean">
          Возможно, вы искали:{' '}
          <button className="link" onClick={() => useUi.getState().setSearchQuery(corrected)}>
            {corrected}
          </button>
        </p>
      )}
      {errors.length > 0 && <p className="soft-warning">Один из источников не ответил: {errors[0]}</p>}
      <div className="search-top">
        {top && (
          <div className="top-result">
            <div className="section__title">Лучший результат</div>
            <button className="top-result__card" onClick={() => usePlayer.getState().playList(tracks, 0, `Поиск: ${query}`)}>
              <img className="top-result__art" src={top.artwork ?? top.artworkSmall ?? ''} alt="" />
              <span className="top-result__title">{top.title}</span>
              <span className="top-result__meta">
                {top.artist} · {providerMeta(top.provider).label}
              </span>
            </button>
          </div>
        )}
        <div className="search-top__tracks">
          <div className="section__head">
            <div className="section__title">Треки</div>
            <button className="btn btn--text" onClick={() => onTab('tracks')}>
              Все треки
            </button>
          </div>
          <TrackList tracks={tracks} source={`Поиск: ${query}`} showPlays={false} />
        </div>
      </div>
      {artists.length > 0 && (
        <Section title="Исполнители" action={<button className="btn btn--text" onClick={() => onTab('artists')}>Все</button>}>
          <div className="card-grid">
            {artists.map((a) => (
              <ArtistCard key={`${a.provider}:${a.id}`} artist={a} />
            ))}
          </div>
        </Section>
      )}
      {albums.length > 0 && (
        <Section title="Альбомы и синглы" action={<button className="btn btn--text" onClick={() => onTab('albums')}>Все</button>}>
          <div className="card-grid">{albums.map((p) => <PlaylistCard key={`${p.provider}:${p.id}`} playlist={p} />)}</div>
        </Section>
      )}
      {playlists.length > 0 && (
        <Section title="Плейлисты" action={<button className="btn btn--text" onClick={() => onTab('playlists')}>Все</button>}>
          <div className="card-grid">{playlists.map((p) => <PlaylistCard key={`${p.provider}:${p.id}`} playlist={p} />)}</div>
        </Section>
      )}
    </>
  );
}

function TracksResults({ provider, query, titled }: { provider: SourceProvider; query: string; titled: boolean }) {
  const state = usePaged(`tracks:${provider}:${query}`, (cursor) => api.searchTracks(provider, query, cursor));
  const body: ReactNode = state.loading ? (
    <SkeletonRows count={8} />
  ) : state.error ? (
    <ErrorState message={state.error} onRetry={state.reload} />
  ) : !state.items.length ? (
    <EmptyState icon={<SearchX size={28} />} title="Треков не найдено" />
  ) : (
    <>
      <TrackList tracks={state.items} source={`Поиск: ${query}`} showHeader showPlays />
      <LoadMore next={state.next} loading={state.loadingMore} onClick={() => void state.loadMore()} />
    </>
  );
  return titled ? <Section title={providerMeta(provider).label}>{body}</Section> : <>{body}</>;
}

function CollectionResults({ query, providers, tab }: { query: string; providers: SourceProvider[]; tab: Tab }) {
  const yt = useSearchAll('youtube', query, providers.includes('youtube'));
  const sc = useSearchAll('soundcloud', query, providers.includes('soundcloud'));
  const lists = [yt, sc].filter((_, i) => providers.includes(i === 0 ? 'youtube' : 'soundcloud'));
  if (lists.every((s) => s.loading && !s.data)) return <SkeletonCards count={10} />;
  const errors = lists.filter((s) => s.error).map((s) => s.error as string);
  if (errors.length === lists.length && errors.length) return <ErrorState message={errors[0]} onRetry={() => lists.forEach((s) => s.reload())} />;

  const get = (r: SearchResults | undefined) =>
    !r ? [] : tab === 'artists' ? r.artists : tab === 'albums' ? r.albums : r.playlists;
  const ytItems = get(yt.data);
  const scItems = get(sc.data);
  const items = interleave<Artist | Playlist>(ytItems, scItems);
  if (!items.length) return <EmptyState icon={<SearchX size={28} />} title="Ничего не найдено" />;
  return (
    <div className="card-grid">
      {items.map((item) =>
        tab === 'artists' ? (
          <ArtistCard key={`${item.provider}:${item.id}`} artist={item as Artist} />
        ) : (
          <PlaylistCard key={`${item.provider}:${item.id}`} playlist={item as Playlist} />
        ),
      )}
    </div>
  );
}

function ArtistCard({ artist }: { artist: Artist }) {
  return (
    <MediaCard
      round
      title={artist.name}
      subtitle={artist.followers != null ? followersLabel(artist.followers) : providerMeta(artist.provider).label}
      image={artist.avatar}
      onClick={() => navigate({ name: 'artist', provider: artist.provider, id: artist.id })}
    />
  );
}

function PlaylistCard({ playlist }: { playlist: Playlist }) {
  const kind = playlist.kind === 'album' ? 'Альбом' : playlist.kind === 'single' ? 'Сингл' : playlist.kind === 'ep' ? 'EP' : 'Плейлист';
  return (
    <MediaCard
      title={playlist.title}
      subtitle={[kind, playlist.year, playlist.owner].filter(Boolean).join(' · ')}
      image={playlist.artwork}
      onClick={() => navigate({ name: 'playlist', provider: playlist.provider, id: playlist.id })}
      onPlay={() => void playRemotePlaylist(playlist)}
    />
  );
}

function LinkResult({ link }: { link: string }) {
  const { data, error, loading, reload } = useAsync(`link:${link}`, () => api.resolveUrl(link));
  if (loading) return <SkeletonRows count={2} />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <EmptyState icon={<Link2 size={28} />} title="Ссылка не распознана" text="Поддерживаются ссылки SoundCloud и YouTube / YouTube Music" />;
  return (
    <div className="page">
      <Section title="По ссылке">
        {data.track && <TrackList tracks={[data.track]} source="По ссылке" />}
        {data.artist && (
          <div className="card-grid">
            <ArtistCard artist={data.artist} />
          </div>
        )}
        {data.playlist && (
          <div className="card-grid">
            <PlaylistCard playlist={data.playlist} />
          </div>
        )}
      </Section>
    </div>
  );
}

function SearchHome() {
  const config = useSettings((s) => s.config) ?? DEFAULT_CONFIG;
  const { data } = useAsync(config.youtube ? 'yt-genres' : null, () => api.genres());
  return (
    <div className="page page--search">
      <div className="search-hint">
        <Sparkles size={18} />
        <span>
          Ищите треки, артистов и альбомы сразу в YouTube Music и SoundCloud. Можно вставить ссылку на трек или плейлист.
        </span>
      </div>
      {config.soundcloud && (
        <Section title="Жанры SoundCloud">
          <div className="genre-grid">
            {SC_GENRES.map((g) => (
              <GenreTile
                key={g.id}
                label={g.name}
                color={g.color}
                icon={<Music2 size={18} />}
                onClick={() => navigate({ name: 'genre', provider: 'soundcloud', id: g.id, title: g.name })}
              />
            ))}
          </div>
        </Section>
      )}
      {data && data.length > 0 && (
        <Section title="Настроения и жанры YouTube Music">
          <div className="genre-grid">
            {data.map((g) => (
              <GenreTile
                key={g.id}
                label={g.name}
                color={g.color}
                icon={g.isMood ? <Sparkles size={18} /> : <Music2 size={18} />}
                onClick={() => navigate({ name: 'genre', provider: 'youtube', id: g.id, title: g.name })}
              />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
