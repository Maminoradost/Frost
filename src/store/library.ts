import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Artist, HistoryEntry, LocalPlaylist, Track } from '../lib/types';
import { trackKey } from '../lib/types';
import { uid } from '../lib/format';
import { toast } from './ui';

interface LibraryState {
  liked: Track[];
  likedKeys: Record<string, true>;
  playlists: LocalPlaylist[];
  history: HistoryEntry[];
  followed: Artist[];

  toggleLike: (track: Track) => void;
  createPlaylist: (name: string, tracks?: Track[]) => string;
  renamePlaylist: (id: string, name: string) => void;
  deletePlaylist: (id: string) => void;
  addToPlaylist: (id: string, tracks: Track[]) => number;
  removeFromPlaylist: (id: string, index: number) => void;
  movePlaylistTrack: (id: string, from: number, to: number) => void;
  addHistory: (track: Track) => void;
  clearHistory: () => void;
  toggleFollow: (artist: Artist) => void;
}

const artistKey = (a: Artist) => `${a.provider}:${a.id}`;

export const useLibrary = create<LibraryState>()(
  persist(
    (set, get) => ({
      liked: [],
      likedKeys: {},
      playlists: [],
      history: [],
      followed: [],

      toggleLike: (track) => {
        const key = trackKey(track);
        const { liked, likedKeys } = get();
        if (likedKeys[key]) {
          const next = { ...likedKeys };
          delete next[key];
          set({ liked: liked.filter((t) => trackKey(t) !== key), likedKeys: next });
          toast('Удалено из любимых');
        } else {
          set({ liked: [track, ...liked], likedKeys: { ...likedKeys, [key]: true } });
          toast('Добавлено в любимые', 'success');
        }
      },

      createPlaylist: (name, tracks = []) => {
        const id = uid();
        const now = Date.now();
        const playlist: LocalPlaylist = {
          id,
          name: name.trim() || 'Новый плейлист',
          description: '',
          tracks,
          createdAt: now,
          updatedAt: now,
        };
        set({ playlists: [playlist, ...get().playlists] });
        return id;
      },

      renamePlaylist: (id, name) =>
        set({
          playlists: get().playlists.map((p) =>
            p.id === id ? { ...p, name: name.trim() || p.name, updatedAt: Date.now() } : p,
          ),
        }),

      deletePlaylist: (id) => set({ playlists: get().playlists.filter((p) => p.id !== id) }),

      addToPlaylist: (id, tracks) => {
        let added = 0;
        set({
          playlists: get().playlists.map((p) => {
            if (p.id !== id) return p;
            const existing = new Set(p.tracks.map(trackKey));
            const fresh = tracks.filter((t) => !existing.has(trackKey(t)));
            added = fresh.length;
            return fresh.length ? { ...p, tracks: [...p.tracks, ...fresh], updatedAt: Date.now() } : p;
          }),
        });
        return added;
      },

      movePlaylistTrack: (id, from, to) =>
        set({
          playlists: get().playlists.map((p) => {
            if (p.id !== id || from === to || from < 0 || to < 0 || from >= p.tracks.length || to >= p.tracks.length) return p;
            const tracks = p.tracks.slice();
            const [moved] = tracks.splice(from, 1);
            tracks.splice(to, 0, moved);
            return { ...p, tracks, updatedAt: Date.now() };
          }),
        }),

      removeFromPlaylist: (id, index) =>
        set({
          playlists: get().playlists.map((p) =>
            p.id === id
              ? { ...p, tracks: p.tracks.filter((_, i) => i !== index), updatedAt: Date.now() }
              : p,
          ),
        }),

      addHistory: (track) => {
        const key = trackKey(track);
        const rest = get().history.filter((h) => trackKey(h.track) !== key);
        set({ history: [{ track, playedAt: Date.now() }, ...rest].slice(0, 300) });
      },

      clearHistory: () => set({ history: [] }),

      toggleFollow: (artist) => {
        const key = artistKey(artist);
        const followed = get().followed;
        if (followed.some((a) => artistKey(a) === key)) {
          set({ followed: followed.filter((a) => artistKey(a) !== key) });
          toast(`Вы отписались от ${artist.name}`);
        } else {
          set({ followed: [artist, ...followed] });
          toast(`Вы подписаны на ${artist.name}`, 'success');
        }
      },
    }),
    { name: 'frost.library', version: 1 },
  ),
);

export const isFollowing = (followed: Artist[], artist: { provider: string; id: string }) =>
  followed.some((a) => a.provider === artist.provider && a.id === artist.id);
