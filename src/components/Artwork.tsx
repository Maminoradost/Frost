import { Music } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';

interface ArtworkProps {
  src: string | null | undefined;
  size?: number;
  radius?: number;
  round?: boolean;
  className?: string;
  alt?: string;
}

export function Artwork({ src, size, radius = 8, round = false, className = '', alt = '' }: ArtworkProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [src]);

  const style: CSSProperties = { borderRadius: round ? '50%' : radius };
  if (size) {
    style.width = size;
    style.height = size;
  }

  if (!src || failed) {
    return (
      <div className={`artwork artwork--empty ${className}`} style={style} aria-hidden>
        <Music size={size ? Math.max(14, Math.round(size * 0.38)) : 32} strokeWidth={1.6} />
      </div>
    );
  }
  return (
    <img
      className={`artwork ${className}`}
      style={style}
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}
