import { useEffect } from 'react';
import { engine } from '../audio/engine';
import { extractAccent } from '../lib/color';
import { applyScheme, hexToRgb, schemeFromSeed } from '../lib/material';
import { applyLookAttributes } from '../lib/look';
import { applyBackdrop, applyWindowTheme } from '../lib/window';
import { usePlayer } from '../store/player';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';
import { useEffectiveTheme } from './useSystemTheme';

/**
 * Оформление: фон окна (стекло/акрил/Mica), тема, схема Material You из обложки,
 * форма, размер текста, движение, плотность и эквалайзер.
 */
export function useAppearance() {
  const backdrop = useSettings((s) => s.backdrop);
  const theme = useSettings((s) => s.theme);
  const reduce = useSettings((s) => s.reduceTransparency);
  const dynamic = useSettings((s) => s.dynamicAccent);
  const seedColor = useSettings((s) => s.seedColor);
  const materialStyle = useSettings((s) => s.materialStyle);
  const contrastLevel = useSettings((s) => s.contrastLevel);
  const cornerRadius = useSettings((s) => s.cornerRadius);
  const textScale = useSettings((s) => s.textScale);
  const motionStyle = useSettings((s) => s.motionStyle);
  const compactMode = useSettings((s) => s.compactMode);
  const surfaceOpacity = useSettings((s) => s.surfaceOpacity);
  const eqEnabled = useSettings((s) => s.eqEnabled);
  const eqGains = useSettings((s) => s.eqGains);
  const art = usePlayer((s) => s.current?.artworkSmall ?? s.current?.artwork ?? null);
  const effective = useEffectiveTheme(theme);

  useEffect(() => {
    const effect = reduce ? 'none' : backdrop;
    document.documentElement.dataset.backdrop = effect;
    void applyBackdrop(effect);
  }, [backdrop, reduce]);

  useEffect(() => {
    applyLookAttributes(document.documentElement, {
      theme: effective,
      corner: cornerRadius,
      textScale,
      motion: motionStyle,
      compact: compactMode,
    });
  }, [compactMode, cornerRadius, effective, motionStyle, textScale]);

  useEffect(() => {
    // «Как в Windows»: окно следует системной теме, тогда и prefers-color-scheme в WebView честный.
    void applyWindowTheme(theme === 'system' ? null : theme);
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    const alpha = reduce ? 1 : Math.min(0.95, Math.max(0.15, surfaceOpacity));
    root.style.setProperty('--surface-alpha', alpha.toFixed(2));
  }, [surfaceOpacity, reduce]);

  useEffect(() => {
    let alive = true;
    const apply = (seed: string) => {
      if (!alive) return;
      const scheme = schemeFromSeed(seed, effective === 'dark', materialStyle, contrastLevel);
      applyScheme(scheme);
      // Совместимость со стилями v0.1: акцент = primary.
      const [r, g, b] = hexToRgb(scheme.primary);
      const root = document.documentElement;
      root.style.setProperty('--accent', scheme.primary);
      root.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
      const ui = useUi.getState();
      ui.setAccent(scheme.primary);
      ui.setSeed(seed);
    };
    if (!dynamic || !art) apply(seedColor);
    else void extractAccent(art, effective).then(apply, () => apply(seedColor));
    return () => {
      alive = false;
    };
  }, [art, contrastLevel, dynamic, effective, materialStyle, seedColor]);

  useEffect(() => {
    engine.setEq(eqEnabled, eqGains);
  }, [eqEnabled, eqGains]);
}
