import type { ReactNode } from 'react';
import { create } from 'zustand';
import type { Provider, Track, SearchSource } from '../lib/types';
import { DEFAULT_ACCENT } from '../lib/color';

export type LibraryTab = 'playlists' | 'artists' | 'history';
export type LocalTab = 'tracks' | 'albums' | 'artists';

export type Route =
  | { name: 'home' }
  | { name: 'search' }
  | { name: 'library'; tab?: LibraryTab }
  | { name: 'liked' }
  | { name: 'local-playlist'; id: string }
  | { name: 'playlist'; provider: Provider; id: string }
  | { name: 'artist'; provider: Provider; id: string }
  | { name: 'genre'; provider: Provider; id: string; title?: string }
  | { name: 'local'; tab?: LocalTab }
  | { name: 'wrapped' }
  | { name: 'settings' };

export type MenuItem =
  | {
      label: string;
      icon?: ReactNode;
      onClick?: () => void;
      danger?: boolean;
      disabled?: boolean;
    }
  | { separator: true };

export interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

export type ModalState =
  | {
      kind: 'prompt';
      title: string;
      placeholder?: string;
      initial?: string;
      confirm: string;
      onSubmit: (value: string) => void;
    }
  | { kind: 'add-to-playlist'; tracks: Track[] }
  | {
      kind: 'confirm';
      title: string;
      message: string;
      confirm: string;
      danger?: boolean;
      onConfirm: () => void;
    };

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'success';
  /** Необязательная кнопка действия («Скачать», «Повторить»). */
  action?: ToastAction;
}

export type SidePanel = 'queue' | 'lyrics' | null;

interface UiState {
  route: Route;
  back: Route[];
  forward: Route[];
  navigate: (route: Route) => void;
  goBack: () => void;
  goForward: () => void;

  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchProvider: SearchSource;
  setSearchProvider: (p: SearchSource) => void;

  panel: SidePanel;
  togglePanel: (panel: Exclude<SidePanel, null>) => void;
  closePanel: () => void;
  nowPlaying: boolean;
  setNowPlaying: (open: boolean) => void;

  toasts: Toast[];
  pushToast: (text: string, kind?: Toast['kind'], action?: ToastAction) => void;
  dismissToast: (id: number) => void;

  menu: MenuState | null;
  openMenu: (x: number, y: number, items: MenuItem[]) => void;
  closeMenu: () => void;

  modal: ModalState | null;
  openModal: (modal: ModalState) => void;
  closeModal: () => void;

  accent: string;
  /** Цвет-источник текущей схемы Material You (обложка или выбранный сид). */
  seed: string;
  setSeed: (seed: string) => void;
  setAccent: (color: string) => void;
}

const sameRoute = (a: Route, b: Route) => JSON.stringify(a) === JSON.stringify(b);
let toastSeq = 0;

export const useUi = create<UiState>()((set, get) => ({
  route: { name: 'home' },
  back: [],
  forward: [],
  navigate: (route) => {
    const { route: current, back } = get();
    if (sameRoute(current, route)) return;
    set({ route, back: [...back, current].slice(-50), forward: [], nowPlaying: false });
  },
  goBack: () => {
    const { back, route, forward } = get();
    const prev = back[back.length - 1];
    if (!prev) return;
    set({ route: prev, back: back.slice(0, -1), forward: [route, ...forward] });
  },
  goForward: () => {
    const { back, route, forward } = get();
    const next = forward[0];
    if (!next) return;
    set({ route: next, back: [...back, route], forward: forward.slice(1) });
  },

  searchQuery: '',
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  searchProvider: 'all',
  setSearchProvider: (searchProvider) => set({ searchProvider }),

  panel: null,
  togglePanel: (panel) => set({ panel: get().panel === panel ? null : panel }),
  closePanel: () => set({ panel: null }),
  nowPlaying: false,
  setNowPlaying: (nowPlaying) => set({ nowPlaying }),

  toasts: [],
  pushToast: (text, kind = 'info', action) => {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts.slice(-3), { id, text, kind, action }] });
    window.setTimeout(() => get().dismissToast(id), action ? 9000 : kind === 'error' ? 5000 : 2800);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  menu: null,
  openMenu: (x, y, items) => set({ menu: { x, y, items } }),
  closeMenu: () => set({ menu: null }),

  modal: null,
  openModal: (modal) => set({ modal, menu: null }),
  closeModal: () => set({ modal: null }),

  accent: DEFAULT_ACCENT,
  setAccent: (accent) => set({ accent }),
  seed: '#6750a4',
  setSeed: (seed) => set((st) => (st.seed === seed ? st : { seed })),
}));

export const toast = (text: string, kind: Toast['kind'] = 'info', action?: ToastAction) =>
  useUi.getState().pushToast(text, kind, action);
export const navigate = (route: Route) => useUi.getState().navigate(route);
