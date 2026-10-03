export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="logo">
      <defs>
        <linearGradient id="frost-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9fb4ff" />
          <stop offset="1" stopColor="#c69bff" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="22" height="22" rx="7" fill="url(#frost-logo)" />
      <circle cx="12" cy="12" r="5.4" fill="none" stroke="#fff" strokeOpacity="0.92" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="1.7" fill="#fff" />
    </svg>
  );
}
