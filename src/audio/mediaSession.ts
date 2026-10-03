import type { Track } from '../lib/types';

/**
 * Media Session API → системная панель мультимедиа Windows (SMTC) и медиаклавиши.
 * WebView2 транслирует метаданные и действия в SMTC.
 */
const supported = typeof navigator !== 'undefined' && 'mediaSession' in navigator;

export function updateMediaMetadata(track: Track | null) {
  if (!supported) return;
  if (!track) {
    navigator.mediaSession.metadata = null;
    return;
  }
  const artwork: MediaImage[] = [];
  if (track.artworkSmall) artwork.push({ src: track.artworkSmall, sizes: '150x150' });
  if (track.artwork) artwork.push({ src: track.artwork, sizes: '500x500' });
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album ?? '',
    artwork,
  });
}

export function setPlaybackState(playing: boolean) {
  if (!supported) return;
  navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
}

export function setPositionState(position: number, duration: number) {
  if (!supported || !(duration > 0) || !Number.isFinite(duration)) return;
  try {
    navigator.mediaSession.setPositionState({
      duration,
      position: Math.min(Math.max(0, position), duration),
      playbackRate: 1,
    });
  } catch {
    /* игнорируем некорректные значения */
  }
}

export interface MediaHandlers {
  play: () => void;
  pause: () => void;
  next: () => void;
  prev: () => void;
  seekTo: (time: number) => void;
  seekBy: (delta: number) => void;
}

export function bindMediaActions(h: MediaHandlers) {
  if (!supported) return;
  const set = (action: MediaSessionAction, handler: MediaSessionActionHandler) => {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      /* действие не поддерживается */
    }
  };
  set('play', () => h.play());
  set('pause', () => h.pause());
  set('stop', () => h.pause());
  set('nexttrack', () => h.next());
  set('previoustrack', () => h.prev());
  set('seekto', (d) => {
    if (d.seekTime != null) h.seekTo(d.seekTime);
  });
  set('seekbackward', (d) => h.seekBy(-(d.seekOffset ?? 10)));
  set('seekforward', (d) => h.seekBy(d.seekOffset ?? 10));
}
