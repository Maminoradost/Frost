export function EqBars({ paused = false }: { paused?: boolean }) {
  return (
    <span className={`eq-bars ${paused ? 'is-paused' : ''}`} aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}
