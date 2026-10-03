import { usePlayer } from '../store/player';
import { useSettings } from '../store/settings';

/** Мягкое свечение цвета обложки поверх системного акрила. */
export function Ambient() {
  const art = usePlayer((s) => s.current?.artworkSmall ?? s.current?.artwork ?? null);
  const reduce = useSettings((s) => s.reduceTransparency);
  return (
    <div className="ambient" aria-hidden>
      <div className="ambient__blob ambient__blob--a" />
      <div className="ambient__blob ambient__blob--b" />
      {art && !reduce && <img key={art} className="ambient__art" src={art} alt="" />}
    </div>
  );
}
