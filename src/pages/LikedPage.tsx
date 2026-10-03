import { Heart } from 'lucide-react';
import { CollectionHeader } from '../components/CollectionHeader';
import { EmptyState } from '../components/States';
import { TrackList } from '../components/TrackList';
import { totalDuration, tracksLabel } from '../lib/format';
import { useLibrary } from '../store/library';
import { usePlayer } from '../store/player';

export function LikedPage() {
  const liked = useLibrary((s) => s.liked);
  const has = liked.length > 0;
  return (
    <div className="page">
      <CollectionHeader
        kind="Коллекция"
        title="Любимые треки"
        art={
          <div className="liked-art collection-art">
            <Heart size={64} fill="currentColor" />
          </div>
        }
        meta={has ? <><span>{tracksLabel(liked.length)}</span><span>{totalDuration(liked)}</span></> : <span>Пока пусто</span>}
        onPlay={has ? () => usePlayer.getState().playList(liked, 0, 'Любимые треки') : undefined}
        onShuffle={has ? () => usePlayer.getState().playShuffled(liked, 'Любимые треки') : undefined}
      />
      {has ? (
        <TrackList tracks={liked} source="Любимые треки" showHeader />
      ) : (
        <EmptyState
          icon={<Heart size={28} />}
          title="Здесь будут любимые треки"
          text="Нажимайте ♥ рядом с треком или клавишу L во время воспроизведения"
        />
      )}
    </div>
  );
}
