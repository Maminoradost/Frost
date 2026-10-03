import {
  Heart,
  ListMusic,
  LoaderCircle,
  Maximize2,
  MicVocal,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useState } from 'react';
import { engine } from '../audio/engine';
import { usePlaybackTime } from '../hooks/usePlaybackTime';
import { formatTime } from '../lib/format';
import { providerMeta } from '../lib/providers';
import { trackKey } from '../lib/types';
import { openExternal } from '../lib/window';
import { useLibrary } from '../store/library';
import { usePlayer } from '../store/player';
import { useUi } from '../store/ui';
import { Artwork } from './Artwork';
import { Logo } from './Logo';
import { SleepTimer } from './SleepTimer';
import { ProviderBadge } from './ProviderBadge';
import { Slider } from './Slider';

/** Плавающая панель плеера (Material You) внизу окна. */
export function PlayerBar() {
  const track = usePlayer((s) => s.current);
  const isPreview = usePlayer((s) => s.isPreview);
  const via = usePlayer((s) => s.via);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const panel = useUi((s) => s.panel);
  const togglePanel = useUi((s) => s.togglePanel);
  const setNowPlaying = useUi((s) => s.setNowPlaying);
  const liked = useLibrary((s) => (track ? !!s.likedKeys[trackKey(track)] : false));
  const artistId = track?.artistId ?? null;

  return (
    <footer className={`player glass ${isPlaying ? 'is-playing' : ''}`} data-tour="player">
      <div className="player__track">
        {track ? (
          <>
            <button className="player__art" onClick={() => setNowPlaying(true)} title="Сейчас играет (F)">
              <Artwork src={track.artworkSmall ?? track.artwork} size={56} radius={10} />
              <span className="player__art-hover">
                <Maximize2 size={16} />
              </span>
            </button>
            <div className="player__meta">
              <div className="player__title" title={track.title}>
                {track.title}
                {isPreview && <span className="tag">30 сек</span>}
                {via && (
                  <span className="tag tag--via" title={`Полная версия найдена в ${providerMeta(via.provider).label}`}>
                    из {providerMeta(via.provider).label}
                  </span>
                )}
              </div>
              <div className="player__artist">
                <button
                  className="player__source"
                  onClick={() => {
                    const link = via?.permalink ?? track.permalink;
                    if (link) void openExternal(link);
                  }}
                  title={`Открыть в ${providerMeta((via ?? track).provider).label}`}
                >
                  <ProviderBadge provider={(via ?? track).provider} />
                </button>
                {artistId ? (
                  <button
                    className="link"
                    onClick={() => useUi.getState().navigate({ name: 'artist', provider: track.provider, id: artistId })}
                  >
                    {track.artist}
                  </button>
                ) : (
                  track.artist
                )}
              </div>
            </div>
            <button
              className={`icon-btn like ${liked ? 'is-liked' : ''}`}
              onClick={() => useLibrary.getState().toggleLike(track)}
              title={liked ? 'Убрать из любимых' : 'В любимые (L)'}
            >
              <Heart size={18} fill={liked ? 'currentColor' : 'none'} />
            </button>
          </>
        ) : (
          <div className="player__empty">
            <Logo size={30} />
            <span>Выберите трек, чтобы начать</span>
          </div>
        )}
      </div>

      <div className="player__center">
        <Controls />
        <SeekBar />
      </div>

      <div className="player__side" data-tour="player-side">
        <button
          className={`icon-btn ${panel === 'lyrics' ? 'is-on' : ''}`}
          onClick={() => togglePanel('lyrics')}
          title="Текст песни"
        >
          <MicVocal size={18} />
        </button>
        <button
          className={`icon-btn ${panel === 'queue' ? 'is-on' : ''}`}
          onClick={() => togglePanel('queue')}
          title="Очередь (Q)"
        >
          <ListMusic size={18} />
        </button>
        <SleepTimer />
        <VolumeControl />
        <button className="icon-btn" disabled={!track} onClick={() => setNowPlaying(true)} title="Сейчас играет (F)">
          <Maximize2 size={17} />
        </button>
      </div>
    </footer>
  );
}

export function Controls({ large = false }: { large?: boolean }) {
  const isPlaying = usePlayer((s) => s.isPlaying);
  const isLoading = usePlayer((s) => s.isLoading);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const hasTrack = usePlayer((s) => s.current !== null);
  const size = large ? 24 : 18;
  const repeatTitle = repeat === 'off' ? 'Повтор выключен (R)' : repeat === 'all' ? 'Повтор списка (R)' : 'Повтор трека (R)';

  return (
    <div className={`controls ${large ? 'controls--large' : ''}`}>
      <button
        className={`icon-btn ${shuffle ? 'is-on' : ''}`}
        onClick={() => usePlayer.getState().toggleShuffle()}
        title="Перемешать (S)"
      >
        <Shuffle size={size - 2} />
      </button>
      <button className="icon-btn" disabled={!hasTrack} onClick={() => usePlayer.getState().prev()} title="Предыдущий (Ctrl+←)">
        <SkipBack size={size} fill="currentColor" />
      </button>
      <button
        className={`play-btn ${isPlaying ? 'is-playing' : ''}`}
        disabled={!hasTrack}
        onClick={() => usePlayer.getState().togglePlay()}
        title="Играть / пауза (Пробел)"
      >
        {isLoading && !isPlaying ? (
          <LoaderCircle className="spin" size={size + 2} />
        ) : isPlaying ? (
          <Pause size={size + 2} fill="currentColor" />
        ) : (
          <Play size={size + 2} fill="currentColor" className="play-icon" />
        )}
      </button>
      <button
        className="icon-btn"
        disabled={!hasTrack}
        onClick={() => void usePlayer.getState().next()}
        title="Следующий (Ctrl+→)"
      >
        <SkipForward size={size} fill="currentColor" />
      </button>
      <button
        className={`icon-btn ${repeat !== 'off' ? 'is-on' : ''}`}
        onClick={() => usePlayer.getState().cycleRepeat()}
        title={repeatTitle}
      >
        {repeat === 'one' ? <Repeat1 size={size - 2} /> : <Repeat size={size - 2} />}
      </button>
    </div>
  );
}

export function SeekBar({ large = false }: { large?: boolean }) {
  const duration = usePlayer((s) => s.duration);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const hasTrack = usePlayer((s) => s.current !== null);
  const time = usePlaybackTime(true, isPlaying ? 30 : 6);
  const [preview, setPreview] = useState<number | null>(null);

  return (
    <div className={`seek ${large ? 'seek--large' : ''}`}>
      <span className="seek__time">{formatTime(preview ?? (hasTrack ? time : 0))}</span>
      <Slider
        label="Позиция трека"
        value={hasTrack ? time : 0}
        max={duration || 1}
        buffered={hasTrack ? engine.bufferedEnd : 0}
        step={5}
        onPreview={setPreview}
        onCommit={(v) => usePlayer.getState().seek(v)}
        className="seek__slider"
      />
      <span className="seek__time seek__time--end">{formatTime(duration)}</span>
    </div>
  );
}

function VolumeControl() {
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const Icon = muted || volume === 0 ? VolumeX : volume < 0.34 ? Volume : volume < 0.67 ? Volume1 : Volume2;

  return (
    <div className="volume">
      <button className="icon-btn" onClick={() => usePlayer.getState().toggleMute()} title="Без звука (M)">
        <Icon size={18} />
      </button>
      <Slider
        label="Громкость"
        value={muted ? 0 : volume}
        max={1}
        step={0.05}
        wheelStep={0.05}
        onPreview={(v) => {
          if (v != null) usePlayer.getState().setVolume(v);
        }}
        onCommit={(v) => usePlayer.getState().setVolume(v)}
        className="volume__slider"
      />
    </div>
  );
}
