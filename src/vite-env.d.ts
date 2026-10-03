/// <reference types="vite/client" />

interface Window {
  /** Убирает заставку из index.html (с учётом её минимальной длительности). */
  __frostSplashDone?: () => void;
}
