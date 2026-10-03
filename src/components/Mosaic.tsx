import { ListMusic } from 'lucide-react';
import { useMemo } from 'react';
import type { Track } from '../lib/types';
import { Artwork } from './Artwork';

/** Обложка локального плейлиста: сетка 2×2 из первых обложек. */
export function Mosaic({ tracks, size, className = '' }: { tracks: Track[]; size?: number; className?: string }) {
  const arts = useMemo(() => {
    const out: string[] = [];
    for (const t of tracks) {
      const a = t.artworkSmall ?? t.artwork;
      if (a && !out.includes(a)) out.push(a);
      if (out.length === 4) break;
    }
    return out;
  }, [tracks]);

  const style = size ? { width: size, height: size } : undefined;
  const small = !!size && size < 64;

  if (arts.length === 0) {
    return (
      <div className={`mosaic mosaic--empty ${small ? 'mosaic--small' : ''} ${className}`} style={style}>
        <ListMusic size={size ? Math.round(size * 0.42) : 48} strokeWidth={1.5} />
      </div>
    );
  }
  if (arts.length < 4) {
    return <Artwork src={arts[0]} size={size} radius={small ? 6 : 14} className={`mosaic ${className}`} />;
  }
  return (
    <div className={`mosaic mosaic--grid ${small ? 'mosaic--small' : ''} ${className}`} style={style}>
      {arts.map((a) => (
        <img key={a} src={a} alt="" loading="lazy" draggable={false} />
      ))}
    </div>
  );
}
