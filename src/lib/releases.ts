/**
 * «Новое у ваших артистов»: свежие альбомы и синглы тех, на кого вы подписаны.
 * Страницы артистов запрашиваются по три одновременно, результат кэшируется на 6 часов.
 */
import { api } from './api';
import type { Artist, Playlist } from './types';

export interface Release extends Playlist {
  artistName: string;
}

const KEY = 'frost.followed-releases';
const TTL = 6 * 3600_000;
const MAX_ARTISTS = 24;

interface Cache {
  at: number;
  ids: string;
  items: Release[];
}

/** Релизы этого и прошлого года, самые новые первыми. */
export function pickReleases(pages: { artist: Artist; albums: Playlist[]; singles: Playlist[] }[], now = new Date()): Release[] {
  const minYear = now.getFullYear() - 1;
  const out: Release[] = [];
  const seen = new Set<string>();
  for (const { artist, albums, singles } of pages) {
    for (const p of [...singles.slice(0, 4), ...albums.slice(0, 4)]) {
      if (!p.year || p.year < minYear || seen.has(p.id)) continue;
      seen.add(p.id);
      out.push({ ...p, artistName: artist.name });
    }
  }
  return out.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
}

export async function loadFollowedReleases(followed: Artist[], force = false): Promise<Release[]> {
  const list = followed.filter((a) => a.provider === 'youtube').slice(0, MAX_ARTISTS);
  const ids = list.map((a) => a.id).join(',');
  if (!force) {
    try {
      const cache = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Cache | null;
      if (cache && cache.ids === ids && Date.now() - cache.at < TTL) return cache.items;
    } catch {
      /* пусто */
    }
  }
  const pages: { artist: Artist; albums: Playlist[]; singles: Playlist[] }[] = [];
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const artist = list[next++];
      try {
        const page = await api.artistPage(artist.provider, artist.id);
        pages.push({ artist, albums: page.albums, singles: page.singles });
      } catch {
        /* один артист не открылся: не страшно */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, list.length) }, worker));
  const order = new Map(list.map((a, i) => [a.id, i]));
  pages.sort((a, b) => (order.get(a.artist.id) ?? 0) - (order.get(b.artist.id) ?? 0));
  const items = pickReleases(pages).slice(0, 18);
  try {
    localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), ids, items } satisfies Cache));
  } catch {
    /* переполнено */
  }
  return items;
}
