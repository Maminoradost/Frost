/**
 * Учёт прослушиваний (журнал «Итогов» и скробблинг) и статус в Discord.
 * Время считается по реально звучавшим секундам: перемотка и пауза не накручивают.
 */
import { invoke } from '@tauri-apps/api/core';
import { useEffect } from 'react';
import { engine } from '../audio/engine';
import { discordActivity } from '../lib/discord';
import { logEntry } from '../lib/diagnostics';
import { flushJournal, recordListen } from '../lib/journal';
import { DISCORD_APP_ID } from '../lib/links';
import { scrobbleThreshold } from '../lib/scrobble';
import { flushScrobbles, sendNowPlaying, sendScrobble } from '../lib/scrobbler';
import type { Track } from '../lib/types';
import { trackKey } from '../lib/types';
import { isTauri } from '../lib/window';
import { usePlayer } from '../store/player';
import { useSettings } from '../store/settings';

/** Меньше этого запуск в журнал не попадает (пролистали). */
const MIN_JOURNAL_SECONDS = 5;

export function useListening() {
  useEffect(() => {
    let playId = -1;
    let track: Track | null = null;
    let startedAt = 0;
    let listened = 0;
    let saved = 0;
    let nowSent = false;
    let scrobbled = false;
    let lastTick = performance.now();

    const finish = () => {
      if (track && listened >= MIN_JOURNAL_SECONDS && listened !== saved) {
        saved = listened;
        void recordListen(track, startedAt, listened);
      }
    };

    const tick = () => {
      const now = performance.now();
      const dt = Math.min(2.5, Math.max(0, (now - lastTick) / 1000));
      lastTick = now;
      const p = usePlayer.getState();
      if (p.playId !== playId || (p.current && track && trackKey(p.current) !== trackKey(track))) {
        finish();
        playId = p.playId;
        track = p.current;
        startedAt = Date.now();
        listened = 0;
        saved = 0;
        nowSent = false;
        scrobbled = false;
      }
      if (!track || !p.isPlaying || p.isLoading || engine.paused) return;
      listened += dt;
      if (!nowSent && listened >= 3) {
        nowSent = true;
        void sendNowPlaying(track);
      }
      const threshold = scrobbleThreshold(p.duration || track.duration);
      if (!scrobbled && !p.isPreview && threshold !== null && listened >= threshold) {
        scrobbled = true;
        void sendScrobble(track, Math.floor(startedAt / 1000));
      }
      if (listened - saved >= 30) {
        saved = listened;
        void recordListen(track, startedAt, listened);
      }
    };

    const timer = window.setInterval(tick, 1000);
    const onHide = () => {
      finish();
      void flushJournal();
    };
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onHide);
    // Неотправленные скробблы: при запуске и раз в 10 минут
    const first = window.setTimeout(() => void flushScrobbles(), 20_000);
    const retry = window.setInterval(() => void flushScrobbles(), 10 * 60_000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(first);
      window.clearInterval(retry);
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('beforeunload', onHide);
      onHide();
    };
  }, []);
}

/** Не чаще одного обновления в 5 секунд: у Discord жёсткий лимит. */
const DISCORD_GAP = 5000;

export function useDiscordPresence() {
  const enabled = useSettings((s) => s.discordEnabled);
  const appId = useSettings((s) => s.discordAppId.trim() || DISCORD_APP_ID);
  useEffect(() => {
    if (!isTauri || !enabled || !/^\d{15,22}$/.test(appId)) return;
    let alive = true;
    let timer = 0;
    let lastSent = 0;
    let sentKey = '';
    let sentStart = 0;
    let failures = 0;
    let active = false;

    const snapshot = () => {
      const p = usePlayer.getState();
      const t = p.current;
      if (!t || !p.isPlaying) return null;
      const duration = p.duration || t.duration || 0;
      return { t, duration, start: Date.now() - (engine.currentTime || 0) * 1000 };
    };

    const send = async () => {
      timer = 0;
      if (!alive) return;
      const snap = snapshot();
      lastSent = Date.now();
      if (!snap) {
        sentKey = '';
        if (active) {
          active = false;
          await invoke('discord_clear').catch(() => undefined);
        }
        return;
      }
      sentKey = trackKey(snap.t);
      sentStart = snap.start;
      try {
        await invoke('discord_set', { clientId: appId, activity: discordActivity(snap.t, snap.start, snap.duration) });
        active = true;
        failures = 0;
      } catch (e) {
        // Discord не запущен: попробуем снова на следующем треке, без потока ошибок
        if (failures++ === 0) logEntry('info', 'Discord:', e);
      }
    };

    const schedule = () => {
      const snap = snapshot();
      const key = snap ? trackKey(snap.t) : '';
      const seeked = snap !== null && Math.abs(snap.start - sentStart) > 3000;
      if (key === sentKey && !seeked) return;
      if (!key && !active && !sentKey) return;
      if (timer) return;
      timer = window.setTimeout(() => void send(), Math.max(300, DISCORD_GAP - (Date.now() - lastSent)));
    };

    schedule();
    const unsub = usePlayer.subscribe(schedule);
    const poll = window.setInterval(schedule, 2000);
    return () => {
      alive = false;
      unsub();
      window.clearInterval(poll);
      window.clearTimeout(timer);
      void invoke('discord_clear').catch(() => undefined);
    };
  }, [enabled, appId]);
}
