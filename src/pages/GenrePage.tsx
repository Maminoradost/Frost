import { Play, Shuffle } from 'lucide-react';
import { MediaCard } from '../components/MediaCard';
import { ErrorState, Section, SkeletonCards, SkeletonRows } from '../components/States';
import { TrackList } from '../components/TrackList';
import { useAsync } from '../hooks/useAsync';
import { playRemotePlaylist } from '../lib/actions';
import { api } from '../lib/api';
import { providerMeta } from '../lib/providers';
import type { Provider } from '../lib/types';
import { usePlayer } from '../store/player';
import { useUi } from '../store/ui';

export function GenrePage({ provider, id, title }: { provider: Provider; id: string; title?: string }) {
  const navigate = useUi((s) => s.navigate);
  const { data, error, loading, reload } = useAsync(`genre:${provider}:${id}`, () => api.genrePage(provider, id));
  const name = data?.title ?? title ?? 'Жанр';
  const tracks = data?.tracks ?? [];

  return (
    <div className="page">
      <header className="page-hero">
        <div className="eyebrow">Жанр · {providerMeta(provider).label}</div>
        <h1 className="page-hero__title">{name}</h1>
        {tracks.length > 0 && (
          <div className="page-hero__actions">
            <button className="btn btn--filled" onClick={() => usePlayer.getState().playList(tracks, 0, name)}>
              <Play size={18} fill="currentColor" /> Слушать
            </button>
            <button className="btn btn--tonal" onClick={() => usePlayer.getState().playShuffled(tracks, name)}>
              <Shuffle size={18} /> Перемешать
            </button>
          </div>
        )}
      </header>

      {loading && !data ? (
        provider === 'youtube' ? <SkeletonCards count={12} /> : <SkeletonRows count={12} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <>
          {tracks.length > 0 && (
            <Section title="Топ-50">
              <TrackList tracks={tracks} source={name} showHeader showPlays />
            </Section>
          )}
          {data?.sections.map((section) => (
            <Section key={section.title} title={section.title}>
              <div className="card-grid">
                {section.playlists.map((p) => (
                  <MediaCard
                    key={p.id}
                    title={p.title}
                    subtitle={p.owner ?? providerMeta(p.provider).label}
                    image={p.artwork}
                    onClick={() => navigate({ name: 'playlist', provider: p.provider, id: p.id })}
                    onPlay={() => void playRemotePlaylist(p)}
                  />
                ))}
              </div>
            </Section>
          ))}
        </>
      )}
    </div>
  );
}
