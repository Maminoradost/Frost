import { useEffect } from 'react';
import { usePlayer } from '../store/player';
import { useLibrary } from '../store/library';
import { useUi } from '../store/ui';

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

export function focusSearch() {
  const ui = useUi.getState();
  if (ui.route.name !== 'search') ui.navigate({ name: 'search' });
  window.setTimeout(() => {
    const input = document.getElementById('global-search') as HTMLInputElement | null;
    input?.focus();
    input?.select();
  }, 0);
}

/** Горячие клавиши (список дублируется в «Настройки → Горячие клавиши»). */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      const player = usePlayer.getState();

      if (e.key === 'Escape') {
        if (ui.menu) ui.closeMenu();
        else if (ui.modal) ui.closeModal();
        else if (ui.nowPlaying) ui.setNowPlaying(false);
        else if (isTyping(e.target)) (e.target as HTMLElement).blur();
        return;
      }
      if ((e.ctrlKey && (e.key === 'k' || e.key === 'K' || e.key === 'f' || e.key === 'F')) || (!isTyping(e.target) && e.key === '/')) {
        e.preventDefault();
        focusSearch();
        return;
      }
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        ui.goBack();
        return;
      }
      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        ui.goForward();
        return;
      }
      if (isTyping(e.target) || ui.modal) return;

      if (e.code === 'Space') {
        e.preventDefault();
        player.togglePlay();
      } else if (e.ctrlKey && e.key === 'ArrowRight') {
        e.preventDefault();
        void player.next();
      } else if (e.ctrlKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        player.prev();
      } else if (e.shiftKey && e.key === 'ArrowRight') {
        e.preventDefault();
        player.seekBy(5);
      } else if (e.shiftKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        player.seekBy(-5);
      } else if (e.ctrlKey && e.key === 'ArrowUp') {
        e.preventDefault();
        player.setVolume(player.volume + 0.05);
      } else if (e.ctrlKey && e.key === 'ArrowDown') {
        e.preventDefault();
        player.setVolume(player.volume - 0.05);
      } else if (!e.ctrlKey && !e.altKey && !e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'm':
          case 'ь':
            player.toggleMute();
            break;
          case 's':
          case 'ы':
            player.toggleShuffle();
            break;
          case 'r':
          case 'к':
            player.cycleRepeat();
            break;
          case 'l':
          case 'д':
            if (player.current) useLibrary.getState().toggleLike(player.current);
            break;
          case 'q':
          case 'й':
            ui.togglePanel('queue');
            break;
          case 'f':
          case 'а':
            if (player.current) ui.setNowPlaying(!ui.nowPlaying);
            break;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
