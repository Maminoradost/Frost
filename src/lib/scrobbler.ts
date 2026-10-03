/**
 * Отправка прослушиваний в подключённые сервисы (ListenBrainz, Last.fm) с очередью
 * на случай, если сети нет. Неверный токен или отозванная сессия отключают сервис
 * с понятным сообщением, остальные ошибки просто откладывают отправку.
 */
import {
  lastfmAvailable,
  lastfmNowPlaying,
  lastfmScrobble,
  listenbrainzSubmit,
  loadQueue,
  saveQueue,
  ScrobbleError,
  toScrobble,
  type PendingScrobble,
  type ScrobbleTrack,
} from './scrobble';
import { logEntry } from './diagnostics';
import type { Track } from './types';
import { useSettings } from '../store/settings';
import { toast } from '../store/ui';

type Service = PendingScrobble['service'];
const NAMES: Record<Service, string> = { listenbrainz: 'ListenBrainz', lastfm: 'Last.fm' };

export function activeServices(): Service[] {
  const s = useSettings.getState();
  const list: Service[] = [];
  if (s.listenbrainzToken) list.push('listenbrainz');
  if (s.lastfmSession && lastfmAvailable()) list.push('lastfm');
  return list;
}

async function submit(service: Service, kind: 'now' | 'scrobble', t: ScrobbleTrack, at = 0) {
  const s = useSettings.getState();
  if (service === 'listenbrainz') {
    await listenbrainzSubmit(s.listenbrainzToken, kind === 'now' ? 'playing_now' : 'single', t, kind === 'now' ? undefined : at);
  } else if (kind === 'now') {
    await lastfmNowPlaying(s.lastfmSession, t);
  } else {
    await lastfmScrobble(s.lastfmSession, t, at);
  }
}

function disconnect(service: Service, e: unknown) {
  const update = useSettings.getState().update;
  if (service === 'listenbrainz') update({ listenbrainzToken: '', listenbrainzUser: '' });
  else update({ lastfmSession: '', lastfmUser: '' });
  const reason = e instanceof Error ? e.message : String(e);
  toast(`${NAMES[service]} отключён: ${reason}. Подключите его заново в настройках`, 'error');
  saveQueue(loadQueue().filter((p) => p.service !== service));
}

const isFatal = (e: unknown) => e instanceof ScrobbleError && e.fatal;

export async function sendNowPlaying(track: Track) {
  const t = toScrobble(track);
  for (const service of activeServices()) {
    try {
      await submit(service, 'now', t);
    } catch (e) {
      if (isFatal(e)) disconnect(service, e);
    }
  }
}

export async function sendScrobble(track: Track, startedAt: number) {
  const t = toScrobble(track);
  const pending: PendingScrobble[] = [];
  for (const service of activeServices()) {
    try {
      await submit(service, 'scrobble', t, startedAt);
    } catch (e) {
      if (isFatal(e)) disconnect(service, e);
      else pending.push({ service, track: t, at: startedAt });
    }
  }
  if (pending.length) {
    saveQueue([...loadQueue(), ...pending]);
    logEntry('warn', `Скробблинг отложен (${pending.map((p) => NAMES[p.service]).join(', ')})`);
  } else {
    void flushScrobbles();
  }
}

let flushing = false;

/** Отправляет накопленное. Останавливается на первой сетевой ошибке. */
export async function flushScrobbles() {
  if (flushing) return;
  const queue = loadQueue();
  if (!queue.length) return;
  flushing = true;
  const services = activeServices();
  const rest: PendingScrobble[] = [];
  let offline = false;
  try {
    for (const p of queue) {
      if (!services.includes(p.service)) continue;
      if (offline) {
        rest.push(p);
        continue;
      }
      try {
        await submit(p.service, 'scrobble', p.track, p.at);
      } catch (e) {
        if (isFatal(e)) {
          disconnect(p.service, e);
          services.splice(services.indexOf(p.service), 1);
        } else {
          offline = true;
          rest.push(p);
        }
      }
    }
  } finally {
    saveQueue(rest);
    flushing = false;
  }
}
