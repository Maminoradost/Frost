import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, errorText } from '../lib/api';
import { BASELINE_SEED, type ContrastLevel, type SchemeStyle } from '../lib/material';
import { DEFAULT_CONFIG } from '../lib/types';
import type { AppConfig, BackdropEffect, SearchSource, SourceProvider, ThemeMode } from '../lib/types';
import { EQ_BANDS } from '../audio/engine';
import { lang, type UiLanguage } from '../lib/i18n';
import { toast } from './ui';

export const EQ_PRESETS: Record<string, number[]> = {
  'Ровно': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Бас': [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  'Вокал': [-2, -2, -1, 1, 3, 3, 2, 1, 0, -1],
  'Высокие': [0, 0, 0, 0, 0, 1, 2, 4, 5, 6],
  'Электроника': [5, 4, 1, 0, -2, 1, 0, 1, 4, 5],
  'Акустика': [4, 4, 3, 1, 1, 1, 2, 3, 3, 2],
  'Громкость': [6, 4, 0, 0, -2, 0, -1, -3, 5, 1],
};

export interface SettingsValues {
  backdrop: BackdropEffect;
  theme: ThemeMode;
  /** Material You: цвета интерфейса из обложки текущего трека. */
  dynamicAccent: boolean;
  /** Сид схемы, когда динамический цвет выключен. */
  seedColor: string;
  /** Вариант динамической палитры Material You. */
  materialStyle: SchemeStyle;
  /** Контраст ролей Material 3. */
  contrastLevel: ContrastLevel;
  /** Скругления поверхностей в процентах от канона M3. */
  cornerRadius: 'small' | 'medium' | 'large';
  /** Масштаб текста интерфейса. */
  textScale: 'small' | 'default' | 'large' | 'xlarge';
  /** Профиль движения интерфейса. */
  motionStyle: 'standard' | 'spring' | 'minimal';
  /** Уплотнить списки и карточки. */
  compactMode: boolean;
  /** Синхронизировать текст без таймкодов автоматически (по вокалу трека). */
  lyricsAutoSync: boolean;
  /** Караоке-заливка активной строки. */
  lyricsKaraoke: boolean;
  /** Плотность поверхностей над стеклом окна, 0.15…0.95. */
  surfaceOpacity: number;
  reduceTransparency: boolean;
  showVisualizer: boolean;
  autoplayRadio: boolean;
  /** Играть полную версию из другого источника вместо 30-секундного превью/недоступного трека. */
  smartFallback: boolean;
  searchSource: SearchSource;
  /** Порядок источников для подмены и радио. */
  sourceOrder: SourceProvider[];
  chartCountry: string;
  eqEnabled: boolean;
  eqPreset: string;
  eqGains: number[];
  /** Обучение при первом запуске пройдено (или пропущено). */
  onboardingDone: boolean;
  /** Пользователь скрыл карточку Telegram-канала в боковой панели. */
  hideTelegramCard: boolean;
  /** Закрытие окна прячет Frost в трей (музыка продолжает играть). */
  closeToTray: boolean;
  /** При автозапуске с Windows сразу прятаться в трей. */
  startMinimized: boolean;
  /** Глобальные горячие клавиши (работают, когда Frost свёрнут). */
  globalKeys: boolean;
  /** Свои сочетания для глобальных клавиш: действие → ускоритель Tauri. */
  globalKeyMap: Record<string, string>;
  /** Устройство вывода звука ('' — по умолчанию в Windows). */
  outputDevice: string;
  /** Выравнивание громкости между треками. */
  normalize: boolean;
  /** Плавный переход между треками, секунды (0 — выключен). */
  crossfade: number;
  /** Папки с музыкой на компьютере. */
  localFolders: string[];
  /** Статус «Слушает» в Discord. */
  discordEnabled: boolean;
  /** Application ID из Discord Developer Portal (если пусто, берётся из links.ts). */
  discordAppId: string;
  /** Токен пользователя ListenBrainz для скробблинга. */
  listenbrainzToken: string;
  /** Сессия Last.fm (после входа) и имя пользователя. */
  lastfmSession: string;
  lastfmUser: string;
  /** Имя пользователя ListenBrainz (после проверки токена). */
  listenbrainzUser: string;
  /** Язык интерфейса. */
  uiLanguage: UiLanguage;
  /** Свои пресеты эквалайзера. */
  eqCustom: Record<string, number[]>;
}

interface SettingsState extends SettingsValues {
  /** Настройки ядра (Rust, config.json): сеть и источники. */
  config: AppConfig | null;
  update: (patch: Partial<SettingsValues>) => void;
  setEqBand: (index: number, gain: number) => void;
  applyPreset: (name: string) => void;
  saveEqPreset: (name: string) => void;
  deleteEqPreset: (name: string) => void;
  loadConfig: () => Promise<void>;
  saveConfig: (config: AppConfig) => Promise<boolean>;
  patchConfig: (patch: Partial<AppConfig>) => Promise<boolean>;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      backdrop: 'glass',
      theme: 'dark',
      dynamicAccent: true,
      seedColor: BASELINE_SEED,
      materialStyle: 'tonalSpot',
      contrastLevel: 'standard',
      cornerRadius: 'medium',
      textScale: 'default',
      motionStyle: 'standard',
      compactMode: false,
      lyricsAutoSync: true,
      lyricsKaraoke: true,
      surfaceOpacity: 0.55,
      reduceTransparency: false,
      showVisualizer: true,
      autoplayRadio: true,
      smartFallback: true,
      searchSource: 'all',
      sourceOrder: ['youtube', 'soundcloud'],
      chartCountry: 'RU',
      eqEnabled: false,
      onboardingDone: false,
      hideTelegramCard: false,
      closeToTray: true,
      startMinimized: true,
      globalKeys: false,
      globalKeyMap: {},
      outputDevice: '',
      normalize: false,
      crossfade: 0,
      localFolders: [],
      discordEnabled: false,
      discordAppId: '',
      listenbrainzToken: '',
      lastfmSession: '',
      lastfmUser: '',
      listenbrainzUser: '',
      uiLanguage: lang,
      eqCustom: {},
      eqPreset: 'Ровно',
      eqGains: EQ_BANDS.map(() => 0),
      config: null,

      update: (patch) => set(patch),
      setEqBand: (index, gain) => {
        const eqGains = get().eqGains.slice();
        eqGains[index] = gain;
        set({ eqGains, eqPreset: 'Своя' });
      },
      applyPreset: (name) => {
        const gains = EQ_PRESETS[name] ?? get().eqCustom[name];
        if (gains) set({ eqGains: gains.slice(), eqPreset: name });
      },
      saveEqPreset: (name) => {
        const key = name.trim().slice(0, 32);
        if (!key || EQ_PRESETS[key]) return;
        set({ eqCustom: { ...get().eqCustom, [key]: get().eqGains.slice() }, eqPreset: key });
      },
      deleteEqPreset: (name) => {
        const eqCustom = { ...get().eqCustom };
        delete eqCustom[name];
        set({ eqCustom, eqPreset: get().eqPreset === name ? 'Своя' : get().eqPreset });
      },
      loadConfig: async () => {
        try {
          set({ config: { ...DEFAULT_CONFIG, ...(await api.getConfig()) } });
        } catch (e) {
          console.warn('get_config failed', e);
          set({ config: { ...DEFAULT_CONFIG } });
        }
      },
      saveConfig: async (config) => {
        try {
          await api.setConfig(config);
          set({ config });
          return true;
        } catch (e) {
          toast(`Не удалось сохранить: ${errorText(e)}`, 'error');
          return false;
        }
      },
      patchConfig: async (patch) => {
        const current = get().config ?? DEFAULT_CONFIG;
        return get().saveConfig({ ...current, ...patch });
      },
    }),
    {
      name: 'frost.settings',
      version: 2,
      migrate: (persisted, version) => {
        const old = (persisted ?? {}) as Record<string, unknown>;
        if (version < 2) {
          // v0.1 → v0.2: новые источники, «Стекло» по умолчанию, Material You.
          delete old.defaultProvider;
          old.backdrop = 'glass';
        }
        return old as unknown as SettingsState;
      },
      partialize: (s) => ({
        backdrop: s.backdrop,
        theme: s.theme,
        dynamicAccent: s.dynamicAccent,
        seedColor: s.seedColor,
        materialStyle: s.materialStyle,
        contrastLevel: s.contrastLevel,
        cornerRadius: s.cornerRadius,
        textScale: s.textScale,
        motionStyle: s.motionStyle,
        compactMode: s.compactMode,
        lyricsAutoSync: s.lyricsAutoSync,
        lyricsKaraoke: s.lyricsKaraoke,
        surfaceOpacity: s.surfaceOpacity,
        reduceTransparency: s.reduceTransparency,
        showVisualizer: s.showVisualizer,
        autoplayRadio: s.autoplayRadio,
        smartFallback: s.smartFallback,
        searchSource: s.searchSource,
        sourceOrder: s.sourceOrder,
        chartCountry: s.chartCountry,
        eqEnabled: s.eqEnabled,
        eqPreset: s.eqPreset,
        eqGains: s.eqGains,
        onboardingDone: s.onboardingDone,
        hideTelegramCard: s.hideTelegramCard,
        closeToTray: s.closeToTray,
        startMinimized: s.startMinimized,
        globalKeys: s.globalKeys,
        globalKeyMap: s.globalKeyMap,
        outputDevice: s.outputDevice,
        normalize: s.normalize,
        crossfade: s.crossfade,
        localFolders: s.localFolders,
        discordEnabled: s.discordEnabled,
        discordAppId: s.discordAppId,
        listenbrainzToken: s.listenbrainzToken,
        lastfmSession: s.lastfmSession,
        lastfmUser: s.lastfmUser,
        listenbrainzUser: s.listenbrainzUser,
        uiLanguage: s.uiLanguage,
        eqCustom: s.eqCustom,
      }),
    },
  ),
);

/** Включённые в ядре источники в порядке приоритета. */
export function enabledSources(): SourceProvider[] {
  const s = useSettings.getState();
  const cfg = s.config ?? DEFAULT_CONFIG;
  return s.sourceOrder.filter((p) => (p === 'youtube' ? cfg.youtube : cfg.soundcloud));
}
