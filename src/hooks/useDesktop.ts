/**
 * Главное окно: трей, закрытие в трей, автозапуск в трее, глобальные клавиши
 * и мост для мини-плеера.
 */
import { useEffect } from 'react';
import { engine } from '../audio/engine';
import {
  applyGlobalShortcuts,
  closeMiniPlayer,
  hideMainWindow,
  launchedByAutostart,
  onMiniCommand,
  openMiniPlayer,
  sendMiniState,
  setupCloseBehavior,
  setupTray,
  showMainWindow,
  updateTray,
  type GlobalAction,
  type MiniCommand,
} from '../lib/desktop';
import { trackKey } from '../lib/types';
import { useLibrary } from '../store/library';
import { usePlayer } from '../store/player';
import { useSettings } from '../store/settings';
import { toast } from '../store/ui';

function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === 'string' ? e : JSON.stringify(e);
}

function runAction(action: GlobalAction | 'expand') {
  const player = usePlayer.getState();
  switch (action) {
    case 'toggle':
      player.togglePlay();
      break;
    case 'next':
      void player.next();
      break;
    case 'prev':
      player.prev();
      break;
    case 'volumeUp':
      player.setVolume(Math.min(1, player.volume + 0.05));
      break;
    case 'volumeDown':
      player.setVolume(Math.max(0, player.volume - 0.05));
      break;
    case 'like':
      if (player.current) useLibrary.getState().toggleLike(player.current);
      break;
    case 'mini':
      openMiniPlayer().catch((e: unknown) => toast(`Мини-плеер не открылся: ${errorText(e)}`, 'error'));
      break;
    case 'show':
      void showMainWindow();
      break;
    case 'expand':
      void showMainWindow().then(() => closeMiniPlayer());
      break;
  }
}

function miniSnapshot() {
  const p = usePlayer.getState();
  const t = p.current;
  return {
    title: t?.title ?? null,
    artist: t?.artist ?? null,
    artwork: t?.artwork ?? t?.artworkSmall ?? null,
    isPlaying: p.isPlaying,
    position: engine.currentTime || 0,
    duration: p.duration || t?.duration || 0,
    liked: t ? Boolean(useLibrary.getState().likedKeys[trackKey(t)]) : false,
    loading: p.isLoading,
  };
}

export function useDesktop() {
  // Трей, поведение крестика, запуск в трее
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await setupTray({
        toggle: () => runAction('toggle'),
        next: () => runAction('next'),
        prev: () => runAction('prev'),
        mini: () => runAction('mini'),
      });
      if (cancelled) return;
      await setupCloseBehavior(
        () => useSettings.getState().closeToTray,
        () => undefined,
      );
      const s = useSettings.getState();
      if (s.startMinimized && s.closeToTray && (await launchedByAutostart())) await hideMainWindow();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Подсказка трея и пункт «Пауза/Играть»
  useEffect(() => {
    const sync = () => {
      const p = usePlayer.getState();
      const title = p.current ? `${p.current.artist} — ${p.current.title}` : null;
      void updateTray(title, p.isPlaying);
    };
    sync();
    return usePlayer.subscribe(sync);
  }, []);

  // Глобальные горячие клавиши
  const globalKeys = useSettings((s) => s.globalKeys);
  const globalKeyMap = useSettings((s) => s.globalKeyMap);
  useEffect(() => {
    let alive = true;
    void applyGlobalShortcuts(globalKeys, globalKeyMap, (a) => runAction(a)).then((busy) => {
      if (alive && busy.length) toast(`Сочетания заняты другой программой: ${busy.join(', ')}`, 'error');
    });
    return () => {
      alive = false;
    };
  }, [globalKeys, globalKeyMap]);

  // Мост мини-плеера: состояние туда, команды оттуда
  useEffect(() => {
    let last = '';
    const push = (force = false) => {
      const snap = miniSnapshot();
      const key = JSON.stringify({ ...snap, position: Math.floor(snap.position) });
      if (!force && key === last) return;
      last = key;
      sendMiniState(snap);
    };
    const unsubPlayer = usePlayer.subscribe(() => push());
    const unsubLib = useLibrary.subscribe(() => push());
    const timer = window.setInterval(() => push(), 1000);
    const unlisten = onMiniCommand((cmd: MiniCommand) => {
      if (cmd === 'hello') push(true);
      else if (typeof cmd === 'object') usePlayer.getState().seek(cmd.seek);
      else runAction(cmd);
    });
    return () => {
      unsubPlayer();
      unsubLib();
      window.clearInterval(timer);
      void unlisten.then((off) => off());
    };
  }, []);
}
