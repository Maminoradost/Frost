import { ChevronDown, ListMusic, MicVocal } from 'lucide-react';
import { useState } from 'react';
import { trackKey } from '../lib/types';
import { usePlayer } from '../store/player';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';
import { Artwork } from './Artwork';
import { LyricsView } from './Lyrics';
import { Controls, SeekBar } from './PlayerBar';
import { QueueList } from './SidePanel';
import { Visualizer } from './Visualizer';

/** Полноэкранный режим «Сейчас играет»: размытая обложка, текст, визуализатор. */
export function NowPlaying() {
  const open = useUi((s) => s.nowPlaying);
  const setOpen = useUi((s) => s.setNowPlaying);
  const track = usePlayer((s) => s.current);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const source = usePlayer((s) => s.source);
  const showVisualizer = useSettings((s) => s.showVisualizer);
  const [tab, setTab] = useState<'lyrics' | 'queue'>('lyrics');

  if (!open || !track) return null;
  const artistId = track.artistId;

  return (
    <div className={`np ${isPlaying ? 'is-playing' : ''}`} role="dialog" aria-label="Сейчас играет">
      <div className="np__bg" aria-hidden>
        {track.artwork && <img key={track.artwork} src={track.artwork} alt="" />}
      </div>

      <div className="np__top">
        <button className="icon-btn" onClick={() => setOpen(false)} title="Свернуть (Esc)">
          <ChevronDown size={22} />
        </button>
        <div className="np__source">
          <span className="eyebrow">Сейчас играет</span>
          <span className="np__source-name">{source ?? 'Frost'}</span>
        </div>
        <div className="segmented segmented--small">
          <button className={tab === 'lyrics' ? 'is-active' : ''} onClick={() => setTab('lyrics')}>
            <MicVocal size={14} /> Текст
          </button>
          <button className={tab === 'queue' ? 'is-active' : ''} onClick={() => setTab('queue')}>
            <ListMusic size={14} /> Очередь
          </button>
        </div>
      </div>

      <div className="np__content">
        <div className="np__left">
          <Artwork key={trackKey(track)} src={track.artwork ?? track.artworkSmall} radius={20} className="np__art" />
          <div className="np__meta">
            <h1 className="np__title">{track.title}</h1>
            {artistId ? (
              <button
                className="link np__artist"
                onClick={() => useUi.getState().navigate({ name: 'artist', provider: track.provider, id: artistId })}
              >
                {track.artist}
              </button>
            ) : (
              <span className="np__artist">{track.artist}</span>
            )}
          </div>
          <SeekBar large />
          <Controls large />
        </div>
        <div className="np__right">
          {tab === 'lyrics' ? <LyricsView key={trackKey(track)} track={track} large /> : <QueueList />}
        </div>
      </div>

      {showVisualizer && <Visualizer className="np__vis" bars={96} />}
    </div>
  );
}
