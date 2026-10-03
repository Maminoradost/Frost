import { BadgeCheck, ExternalLink, Play, Radio, Shuffle } from 'lucide-react';
import { Artwork } from '../components/Artwork';
import { MediaCard } from '../components/MediaCard';
import { ErrorState, LoadMore, Section, SkeletonRows } from '../components/States';
import { TrackList } from '../components/TrackList';
import { useAsync, usePaged } from '../hooks/useAsync';
import { followersLabel, playRemotePlaylist } from '../lib/actions';
import { api } from '../lib/api';
import { openExternal } from '../lib/window';
import { providerMeta } from '../lib/providers';
import type { Playlist, Provider } from '../lib/types';
import { usePlayer } from '../store/player';
import { navigate } from '../store/ui';

function PlaylistGrid({ items }: { items: Playlist[] }) {
  return (
    <div className="card-grid">
      {items.map((p) => (
        <MediaCard
          key={p.id}
          title={p.title}
          subtitle={[p.year, p.kind === 'single' ? 'Сингл' : p.kind === 'ep' ? 'EP' : p.kind === 'album' ? 'Альбом' : null].filter(Boolean).join(' · ')}
          image={p.artwork}
          onClick={() => navigate({ name: 'playlist', provider: p.provider, id: p.id })}
          onPlay={() => void playRemotePlaylist(p)}
        />
      ))}
    </div>
  );
}

export function ArtistPage({ provider, id }: { provider: Provider; id: string }) {
  const { data, error, loading, reload } = useAsync(`artist:${provider}:${id}`, () => api.artistPage(provider, id));
  const all = usePaged(provider === 'soundcloud' && data?.tracksNext !== undefined ? `artist-tracks:${provider}:${id}` : null, (cursor) =>
    api.artistTracks(provider, id, cursor),
  );

  if (loading && !data) return <div className="page"><SkeletonRows count={10} /></div>;
  if (error || !data) return <div className="page"><ErrorState message={error ?? 'Не удалось загрузить исполнителя'} onRetry={reload} /></div>;

  const { artist, topTracks } = data;
  const play = () => topTracks.length && usePlayer.getState().playList(topTracks, 0, artist.name);
  const shuffle = () => topTracks.length && usePlayer.getState().playShuffled(topTracks, artist.name);
  const radio = () => topTracks[0] && usePlayer.getState().startRadio(topTracks[0]);

  return (
    <div className="page page--artist">
      <header className="artist-hero" style={artist.cover ? { backgroundImage: `url("${artist.cover}")` } : undefined}>
        <div className="artist-hero__scrim" />
        <Artwork src={artist.avatar} size={168} round />
        <div className="artist-hero__info">
          <div className="eyebrow">Исполнитель · {providerMeta(provider).label}</div>
          <h1 className="artist-hero__name">
            {artist.name} {artist.verified && <BadgeCheck size={26} className="verified" />}
          </h1>
          <div className="artist-hero__meta">
            {artist.followers != null && <span>{followersLabel(artist.followers)}</span>}
            {artist.trackCount != null && <span>{artist.trackCount} треков</span>}
          </div>
          <div className="page-hero__actions">
            <button className="btn btn--filled" onClick={play} disabled={!topTracks.length}>
              <Play size={18} fill="currentColor" /> Слушать
            </button>
            <button className="btn btn--tonal" onClick={shuffle} disabled={!topTracks.length}>
              <Shuffle size={18} /> Перемешать
            </button>
            <button className="btn btn--outlined" onClick={radio} disabled={!topTracks.length}>
              <Radio size={18} /> Радио
            </button>
            {artist.permalink && (
              <button className="icon-btn" title={`Открыть в ${providerMeta(provider).label}`} onClick={() => void openExternal(artist.permalink as string)}>
                <ExternalLink size={18} />
              </button>
            )}
          </div>
        </div>
      </header>

      {topTracks.length > 0 && (
        <Section title="Популярные треки">
          <TrackList tracks={topTracks} source={artist.name} showPlays />
        </Section>
      )}
      {data.albums.length > 0 && (
        <Section title="Альбомы">
          <PlaylistGrid items={data.albums} />
        </Section>
      )}
      {data.singles.length > 0 && (
        <Section title="Синглы и EP">
          <PlaylistGrid items={data.singles} />
        </Section>
      )}
      {data.playlists.length > 0 && (
        <Section title="Плейлисты">
          <PlaylistGrid items={data.playlists} />
        </Section>
      )}
      {provider === 'soundcloud' && all.items.length > 0 && (
        <Section title="Все треки">
          <TrackList tracks={all.items} source={artist.name} showPlays />
          <LoadMore next={all.next} loading={all.loadingMore} onClick={() => void all.loadMore()} />
        </Section>
      )}
      {data.similar.length > 0 && (
        <Section title="Похожие исполнители">
          <div className="card-grid">
            {data.similar.map((a) => (
              <MediaCard
                key={a.id}
                round
                title={a.name}
                subtitle={a.followers != null ? followersLabel(a.followers) : providerMeta(a.provider).label}
                image={a.avatar}
                onClick={() => navigate({ name: 'artist', provider: a.provider, id: a.id })}
              />
            ))}
          </div>
        </Section>
      )}
      {artist.bio && (
        <Section title="Об исполнителе">
          <p className="artist-bio">{artist.bio}</p>
        </Section>
      )}
    </div>
  );
}
