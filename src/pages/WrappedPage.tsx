import { BarChart3, Flame, ListMusic, Moon, Play, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Artwork } from '../components/Artwork';
import { EmptyState, Spinner } from '../components/States';
import { plural } from '../lib/format';
import { loadJournal, type JournalData } from '../lib/journal';
import { computeWrapped, listenerType, periodRange, type WrappedPeriod } from '../lib/wrapped';
import { useLibrary } from '../store/library';
import { usePlayer } from '../store/player';
import { toast, useUi } from '../store/ui';

const PERIODS: [WrappedPeriod, string][] = [
  ['month', '30 дней'],
  ['year', 'Этот год'],
  ['last-year', 'Прошлый год'],
  ['all', 'Всё время'],
];

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function minutesLabel(seconds: number): string {
  const m = Math.round(seconds / 60);
  return `${m.toLocaleString('ru-RU')} ${plural(m, 'минута', 'минуты', 'минут')}`;
}

function hoursLabel(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h} ч ${m} мин` : `${m} мин`;
}

function Bars({ values, labels, titles = labels, label }: { values: number[]; labels: string[]; titles?: string[]; label: string }) {
  const max = Math.max(1, ...values);
  return (
    <div className="wrapped-bars" role="img" aria-label={label}>
      {values.map((v, i) => (
        <div key={i} className="wrapped-bars__col" title={`${titles[i]}: ${hoursLabel(v)}`}>
          <div className="wrapped-bars__bar" style={{ height: `${Math.max(3, (v / max) * 100)}%` }} />
          <span className="wrapped-bars__label">{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

export function WrappedPage() {
  const [period, setPeriod] = useState<WrappedPeriod>('year');
  const [data, setData] = useState<JournalData | null>(null);
  const navigate = useUi((s) => s.navigate);

  useEffect(() => {
    let alive = true;
    void loadJournal().then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, []);

  const stats = useMemo(() => (data ? computeWrapped(data.entries, data.tracks, periodRange(period), 10) : null), [data, period]);
  const hasLastYear = useMemo(() => {
    if (!data) return false;
    const { from, to } = periodRange('last-year');
    return data.entries.some((e) => e[1] >= from && e[1] < to);
  }, [data]);
  const type = stats ? listenerType(stats.byHour) : null;

  if (!data || !stats) {
    return (
      <div className="page-loading" role="status" aria-label="Загрузка">
        <Spinner />
      </div>
    );
  }

  const playTop = (index: number) =>
    usePlayer.getState().playList(
      stats.topTracks.map((t) => t.track),
      index,
      'Итоги',
    );

  const saveTop = () => {
    const full = computeWrapped(data.entries, data.tracks, periodRange(period), 50);
    const title = `Итоги: ${PERIODS.find((p) => p[0] === period)?.[1].toLowerCase()}`;
    const id = useLibrary.getState().createPlaylist(title, full.topTracks.map((t) => t.track));
    toast(`Плейлист «${title}» создан`, 'success');
    navigate({ name: 'local-playlist', id });
  };

  return (
    <div className="page page--wrapped">
      <div className="page-head">
        <div>
          <h1 className="page-title">Итоги</h1>
          <div className="page-subtitle">Считаются только реально прозвучавшие минуты. Данные хранятся на этом компьютере.</div>
        </div>
      </div>

      <div className="chip-row" role="tablist" aria-label="Период">
        {PERIODS.filter(([id]) => id !== 'last-year' || hasLastYear).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={period === id} className={`chip ${period === id ? 'is-active' : ''}`} onClick={() => setPeriod(id)}>
            {label}
          </button>
        ))}
      </div>

      {stats.seconds < 60 ? (
        <EmptyState
          icon={<BarChart3 size={30} />}
          title="Пока мало данных"
          text="Слушайте музыку как обычно: Frost запишет, что звучало, и здесь появятся любимые треки, артисты и время прослушивания."
        />
      ) : (
        <>
          <section className="wrapped-hero" aria-label="Главное">
            <div className="wrapped-hero__big">
              <span className="wrapped-hero__value">{minutesLabel(stats.seconds)}</span>
              <span className="wrapped-hero__caption">музыки за период</span>
            </div>
            <div className="wrapped-stats">
              <div className="wrapped-stat">
                <b>{stats.plays.toLocaleString('ru-RU')}</b>
                <span>{plural(stats.plays, 'прослушивание', 'прослушивания', 'прослушиваний')}</span>
              </div>
              <div className="wrapped-stat">
                <b>{stats.tracks.toLocaleString('ru-RU')}</b>
                <span>{plural(stats.tracks, 'трек', 'трека', 'треков')}</span>
              </div>
              <div className="wrapped-stat">
                <b>{stats.artists.toLocaleString('ru-RU')}</b>
                <span>{plural(stats.artists, 'артист', 'артиста', 'артистов')}</span>
              </div>
              <div className="wrapped-stat">
                <b>{stats.days}</b>
                <span>{plural(stats.days, 'день', 'дня', 'дней')} с музыкой</span>
              </div>
            </div>
          </section>

          <div className="wrapped-facts">
            {stats.streak > 1 && (
              <div className="wrapped-fact">
                <Flame size={20} aria-hidden />
                <div>
                  <b>
                    {stats.streak} {plural(stats.streak, 'день', 'дня', 'дней')} подряд
                  </b>
                  <span>самая длинная серия</span>
                </div>
              </div>
            )}
            {type && (
              <div className="wrapped-fact">
                <Moon size={20} aria-hidden />
                <div>
                  <b>{type.title}</b>
                  <span>{type.text}</span>
                </div>
              </div>
            )}
            {stats.bestDay && (
              <div className="wrapped-fact">
                <Sparkles size={20} aria-hidden />
                <div>
                  <b>{new Date(stats.bestDay.at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</b>
                  <span>самый музыкальный день: {hoursLabel(stats.bestDay.seconds)}</span>
                </div>
              </div>
            )}
            {stats.discovered > 0 && (
              <div className="wrapped-fact">
                <ListMusic size={20} aria-hidden />
                <div>
                  <b>
                    {stats.discovered} {plural(stats.discovered, 'новый трек', 'новых трека', 'новых треков')}
                  </b>
                  <span>впервые за период</span>
                </div>
              </div>
            )}
          </div>

          <div className="wrapped-columns">
            <section className="wrapped-card" aria-labelledby="w-artists">
              <h2 id="w-artists" className="section__title">
                Артисты
              </h2>
              <ol className="wrapped-list">
                {stats.topArtists.map((a, i) => (
                  <li key={a.name}>
                    <button className="wrapped-row" onClick={() => usePlayer.getState().startRadio(a.track)} title="Радио по артисту">
                      <span className="wrapped-row__rank">{i + 1}</span>
                      <Artwork src={a.track.artworkSmall ?? a.track.artwork} size={44} round />
                      <span className="wrapped-row__text">
                        <b>{a.name}</b>
                        <span>{hoursLabel(a.seconds)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>

            <section className="wrapped-card" aria-labelledby="w-tracks">
              <div className="wrapped-card__head">
                <h2 id="w-tracks" className="section__title">
                  Треки
                </h2>
                <button className="btn btn--ghost btn--sm" onClick={saveTop}>
                  <ListMusic size={15} /> В плейлист
                </button>
              </div>
              <ol className="wrapped-list">
                {stats.topTracks.map((t, i) => (
                  <li key={`${t.track.provider}:${t.track.id}`}>
                    <button className="wrapped-row" onClick={() => playTop(i)}>
                      <span className="wrapped-row__rank">{i + 1}</span>
                      <Artwork src={t.track.artworkSmall ?? t.track.artwork} size={44} radius={8} />
                      <span className="wrapped-row__text">
                        <b>{t.track.title}</b>
                        <span>
                          {t.track.artist} · {t.plays} {plural(t.plays, 'раз', 'раза', 'раз')}
                        </span>
                      </span>
                      <Play size={16} className="wrapped-row__play" aria-hidden />
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <div className="wrapped-columns">
            <section className="wrapped-card">
              <h2 className="section__title">По времени суток</h2>
              <Bars
                values={stats.byHour}
                labels={stats.byHour.map((_, h) => (h % 6 === 0 ? String(h) : ''))}
                titles={stats.byHour.map((_, h) => `${h}:00`)}
                label="Время прослушивания по часам"
              />
            </section>
            <section className="wrapped-card">
              <h2 className="section__title">По дням недели</h2>
              <Bars values={stats.byWeekday} labels={WEEKDAYS} label="Время прослушивания по дням недели" />
            </section>
          </div>
        </>
      )}
    </div>
  );
}
