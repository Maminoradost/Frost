import { ExternalLink, Heart, ListMusic, ListPlus, ListStart, Play, Radio, Trash2, User } from 'lucide-react';
import { providerMeta } from '../lib/providers';
import type { Track } from '../lib/types';
import { trackKey } from '../lib/types';
import { openExternal } from '../lib/window';
import { useLibrary } from '../store/library';
import { usePlayer } from '../store/player';
import { useUi, type MenuItem } from '../store/ui';

/** Пункты контекстного меню трека (ПКМ по строке или кнопка «…»). */
export function trackMenuItems(track: Track, opts: { localPlaylistId?: string; index?: number } = {}): MenuItem[] {
  const player = usePlayer.getState();
  const lib = useLibrary.getState();
  const ui = useUi.getState();
  const liked = !!lib.likedKeys[trackKey(track)];

  const items: MenuItem[] = [
    { label: 'Воспроизвести', icon: <Play size={16} />, onClick: () => player.playTrack(track) },
    { label: 'Играть следующим', icon: <ListStart size={16} />, onClick: () => player.playNext(track) },
    { label: 'Добавить в очередь', icon: <ListPlus size={16} />, onClick: () => player.addToQueue(track) },
    { separator: true },
    {
      label: liked ? 'Убрать из любимых' : 'Добавить в любимые',
      icon: <Heart size={16} fill={liked ? 'currentColor' : 'none'} />,
      onClick: () => lib.toggleLike(track),
    },
    {
      label: 'Добавить в плейлист…',
      icon: <ListMusic size={16} />,
      onClick: () => ui.openModal({ kind: 'add-to-playlist', tracks: [track] }),
    },
    { label: 'Радио на основе трека', icon: <Radio size={16} />, onClick: () => void player.startRadio(track) },
  ];

  const artistId = track.artistId;
  if (artistId) {
    items.push({
      label: 'Перейти к исполнителю',
      icon: <User size={16} />,
      onClick: () => ui.navigate({ name: 'artist', provider: track.provider, id: artistId }),
    });
  }
  const permalink = track.permalink;
  if (permalink) {
    items.push({
      label: `Открыть в ${providerMeta(track.provider).label}`,
      icon: <ExternalLink size={16} />,
      onClick: () => void openExternal(permalink),
    });
  }
  const { localPlaylistId, index } = opts;
  if (localPlaylistId && index != null) {
    items.push(
      { separator: true },
      {
        label: 'Удалить из плейлиста',
        icon: <Trash2 size={16} />,
        danger: true,
        onClick: () => lib.removeFromPlaylist(localPlaylistId, index),
      },
    );
  }
  return items;
}
