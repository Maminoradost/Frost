import { Disc3, Flame, Earth, Music2, Sparkles } from 'lucide-react';
import { useMemo } from 'react';
import { GenreTile, MediaCard, QuickTile } from '../components/MediaCard';
import { EmptyState, ErrorState, Section, SkeletonCards, SkeletonRows } from '../components/States';
import { TrackList } from '../components/TrackList';
import { useAsync } from '../hooks/useAsync';
import { playRemotePlaylist } from '../lib/actions';
import { api } from '../lib/api';
import { greeting } from '../lib/format';
import { loadFollowedReleases } from '../lib/releases';
import { countryName, CHART_COUNTRIES } from '../lib/providers';
import { SC_GENRES } from '../lib/soundcloud';
import type { Charts, Track } from '../lib/types';
import { DEFAULT_CONFIG, uniqueTracks } from '../lib/types';
import { useLibrary } from '../store/library';
import { usePlayer } from '../store/player';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';

export function HomePage() {
  const config = useSettings((s) => s.config) ?? DEFAULT_CONFIG;
  const history = useLibrary((s) => s.history);
  const recent = useMemo(() => uniqueTracks(history.map((h) => h.track)).slice(0, 6), [history]);

  return (
    <div className="page page--home">
      <header className="home-head">
        <div>
          <h1 className="home-head__title">{greeting()}</h1>
          <p className="home-head__sub">Музыка из YouTube Music и SoundCloud. Без регистрации и ключей.</p>
        </div>
      </header>

      {recent.length > 0 && (
        <Section title="Недавно слушали">
          <div className="quick-grid">
            {recent.map((t) => (
              <QuickTile key={`${t.provider}:${t.id}`} track={t} onPlay={() => usePlayer.getState().playList(recent, recent.indexOf(t), 'Недавно слушали')} />
            ))}
          </div>
        </Section>
      )}

      {config.youtube && <FollowedReleases />}
      {config.youtube && <ChartsBlock />}
      {config.soundcloud && <ScTrending />}
      {config.youtube && <NewReleases />}
      <GenresBlock youtube={config.youtube} soundcloud={config.soundcloud} />
      {config.soundcloud && <ScShelves />}
    </div>
  );
}

interface ChartView {
  tracks: Track[];
  trending: Track[];
  countries: string[];
  note: string | null;
}

/**
 * Чарт страны с запасными вариантами: YouTube публикует чарты не для всех стран
 * (для некоторых возвращает пустой список без ошибки). Порядок: топ треков → плейлист
 * чарта → «в тренде» → мировой чарт с пояснением.
 */
async function loadChart(country: string): Promise<ChartView> {
  const code = country === 'ZZ' ? null : country;
  let charts: Charts | null = null;
  try {
    charts = await api.charts(code);
  } catch (e) {
    if (!code) throw e;
  }
  let tracks = charts?.top ?? [];
  if (!tracks.length && charts && charts.playlists.length) {
    const pl = charts.playlists.find((p) => /top|топ|100/i.test(p.title)) ?? charts.playlists[0];
    try {
      tracks = (await api.playlist(pl.provider, pl.id)).tracks.slice(0, 20);
    } catch {
      /* ниже есть другие варианты */
    }
  }
  if (!tracks.length && charts && charts.trending.length) tracks = charts.trending;
  if (!tracks.length && code) {
    const world = await api.charts(null);
    return {
      tracks: world.top.length ? world.top : world.trending,
      trending: world.top.length ? world.trending : [],
      countries: charts?.countries.length ? charts.countries : world.countries,
      note: `YouTube не публикует чарт для страны «${countryName(country)}», поэтому показываем мировой`,
    };
  }
  return { tracks, trending: charts?.top.length ? charts.trending : [], countries: charts?.countries ?? [], note: null };
}

function ChartsBlock() {
  const country = useSettings((s) => s.chartCountry);
  const setCountry = (c: string) => useSettings.getState().update({ chartCountry: c });
  const { data, error, loading, reload } = useAsync(`yt-charts:${country}`, () => loadChart(country));
  const countries = useMemo(() => {
    const available = data?.countries?.length ? new Set(data.countries) : null;
    return CHART_COUNTRIES.filter((c) => c === 'ZZ' || c === country || !available || available.has(c));
  }, [data, country]);
  const top = data?.tracks ?? [];
  const title = country === 'ZZ' ? 'Топ: весь мир' : `Топ: ${countryName(country)}`;

  return (
    <Section title={title} subtitle="YouTube Music · чарт недели">
      <div className="chip-row" role="tablist">
        <Earth size={16} className="chip-row__icon" />
        {countries.map((c) => (
          <button key={c} className={`chip ${c === country ? 'chip--on' : ''}`} onClick={() => setCountry(c)}>
            {countryName(c)}
          </button>
        ))}
      </div>
      {loading && !data ? (
        <SkeletonRows count={6} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !top.length ? (
        <EmptyState
          icon={<Music2 size={28} />}
          title="Чарт пока пуст"
          text="YouTube не вернул треки для этого региона. Попробуйте другую страну или «Весь мир»"
        />
      ) : (
        <>
          {data?.note && (
            <p className="search-hint chart-note">
              <Earth size={16} /> {data.note}
            </p>
          )}
          <TrackList tracks={top.slice(0, 10)} source={title} showPlays />
          {data && data.trending.length > 0 && (
            <div className="subsection">
              <h3 className="subsection__title">
                <Flame size={16} /> Набирают популярность
              </h3>
              <TrackList tracks={data.trending.slice(0, 5)} source="В тренде" showPlays={false} />
            </div>
          )}
        </>
      )}
    </Section>
  );
}

function ScTrending() {
  const { data, error, loading, reload } = useAsync('sc-trending', () => api.scCharts('all-music', 'trending'));
  return (
    <Section title="SoundCloud: новое и горячее" subtitle="Треки, которые сейчас слушают больше всего">
      {loading && !data ? (
        <SkeletonRows count={5} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <TrackList tracks={(data ?? []).slice(0, 10)} source="SoundCloud: в тренде" showPlays />
      )}
    </Section>
  );
}

function FollowedReleases() {
  const navigate = useUi((s) => s.navigate);
  const followed = useLibrary((s) => s.followed);
  const ids = followed.filter((a) => a.provider === 'youtube').map((a) => a.id).join(',');
  const { data } = useAsync(ids ? `followed-releases:${ids}` : null, () => loadFollowedReleases(followed));
  if (!data?.length) return null;
  return (
    <Section title="Новое у ваших артистов" subtitle="Свежие альбомы и синглы тех, на кого вы подписаны">
      <div className="card-grid">
        {data.slice(0, 12).map((p) => (
          <MediaCard
            key={p.id}
            title={p.title}
            subtitle={[p.artistName, p.kind === 'single' ? 'Сингл' : p.kind === 'ep' ? 'EP' : 'Альбом', p.year].filter(Boolean).join(' · ')}
            image={p.artwork}
            onClick={() => navigate({ name: 'playlist', provider: p.provider, id: p.id })}
            onPlay={() => void playRemotePlaylist(p)}
          />
        ))}
      </div>
    </Section>
  );
}

function NewReleases() {
  const navigate = useUi((s) => s.navigate);
  const { data, error, loading, reload } = useAsync('yt-new', () => api.newReleases());
  return (
    <Section title="Новые релизы" subtitle="Альбомы и синглы недели">
      {loading && !data ? (
        <SkeletonCards count={6} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <div className="card-grid">
          {(data ?? []).slice(0, 12).map((p) => (
            <MediaCard
              key={p.id}
              title={p.title}
              subtitle={[p.owner, p.kind === 'single' ? 'Сингл' : p.kind === 'ep' ? 'EP' : 'Альбом'].filter(Boolean).join(' · ')}
              image={p.artwork}
              onClick={() => navigate({ name: 'playlist', provider: p.provider, id: p.id })}
              onPlay={() => void playRemotePlaylist(p)}
            />
          ))}
        </div>
      )}
    </Section>
  );
}

function GenresBlock({ youtube, soundcloud }: { youtube: boolean; soundcloud: boolean }) {
  const navigate = useUi((s) => s.navigate);
  const { data } = useAsync(youtube ? 'yt-genres' : null, () => api.genres());
  const moods = (data ?? []).filter((g) => g.isMood).slice(0, 8);
  const genres = (data ?? []).filter((g) => !g.isMood).slice(0, 12);

  return (
    <>
      {moods.length > 0 && (
        <Section title="Настроения" subtitle="Подборки YouTube Music">
          <div className="genre-grid">
            {moods.map((g) => (
              <GenreTile
                key={g.id}
                label={g.name}
                color={g.color}
                icon={<Sparkles size={18} />}
                onClick={() => navigate({ name: 'genre', provider: 'youtube', id: g.id, title: g.name })}
              />
            ))}
          </div>
        </Section>
      )}
      <Section title="Жанры" subtitle={soundcloud ? 'Топ SoundCloud по жанрам' : 'YouTube Music'}>
        <div className="genre-grid">
          {soundcloud &&
            SC_GENRES.map((g) => (
              <GenreTile
                key={`sc-${g.id}`}
                label={g.name}
                color={g.color}
                subtitle="Топ-50 · SoundCloud"
                icon={<Music2 size={18} />}
                onClick={() => navigate({ name: 'genre', provider: 'soundcloud', id: g.id, title: g.name })}
              />
            ))}
          {!soundcloud &&
            genres.map((g) => (
              <GenreTile
                key={g.id}
                label={g.name}
                color={g.color}
                icon={<Disc3 size={18} />}
                onClick={() => navigate({ name: 'genre', provider: 'youtube', id: g.id, title: g.name })}
              />
            ))}
        </div>
      </Section>
    </>
  );
}

function ScShelves() {
  const navigate = useUi((s) => s.navigate);
  const { data } = useAsync('sc-shelves', () => api.scShelves());
  if (!data?.length) return null;
  return (
    <>
      {data.slice(0, 4).map((shelf) => (
        <Section key={shelf.id} title={shelf.title} subtitle="Подборка SoundCloud">
          <div className="card-grid">
            {shelf.playlists.slice(0, 6).map((p) => (
              <MediaCard
                key={p.id}
                title={p.title}
                subtitle={p.owner ?? 'SoundCloud'}
                image={p.artwork}
                onClick={() => navigate({ name: 'playlist', provider: p.provider, id: p.id })}
                onPlay={() => void playRemotePlaylist(p)}
              />
            ))}
          </div>
        </Section>
      ))}
    </>
  );
}
