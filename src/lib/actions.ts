import { api, errorText } from './api';
import type { Playlist } from './types';
import { usePlayer } from '../store/player';
import { toast } from '../store/ui';
import { formatCount, plural } from './format';

/** Загрузить удалённый плейлист и сразу включить. */
export async function playRemotePlaylist(p: Playlist, shuffle = false) {
  try {
    const details = await api.playlist(p.provider, p.id);
    const player = usePlayer.getState();
    if (shuffle) player.playShuffled(details.tracks, details.playlist.title);
    else player.playList(details.tracks, 0, details.playlist.title);
  } catch (e) {
    toast(`Не удалось открыть плейлист: ${errorText(e)}`, 'error');
  }
}

export function followersLabel(n: number): string {
  if (n < 1000) return `${n} ${plural(n, 'подписчик', 'подписчика', 'подписчиков')}`;
  return `${formatCount(n)} подписчиков`;
}

export function formatHz(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}k` : String(hz);
}
