import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { appWindow } from '../lib/window';
import { useUi } from '../store/ui';
import { Logo } from './Logo';

/** Собственный заголовок окна: перетаскивание, навигация, поиск и кнопки окна в стиле Windows 11. */
export function TitleBar() {
  const canBack = useUi((s) => s.back.length > 0);
  const canForward = useUi((s) => s.forward.length > 0);
  const goBack = useUi((s) => s.goBack);
  const goForward = useUi((s) => s.goForward);

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar__brand" data-tauri-drag-region>
        <Logo size={18} />
        <span data-tauri-drag-region>Frost</span>
      </div>
      <div className="titlebar__nav">
        <button className="icon-btn icon-btn--sm" onClick={goBack} disabled={!canBack} title="Назад (Alt+←)">
          <ChevronLeft size={18} />
        </button>
        <button className="icon-btn icon-btn--sm" onClick={goForward} disabled={!canForward} title="Вперёд (Alt+→)">
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="titlebar__drag" data-tauri-drag-region />
      <SearchBox />
      <div className="titlebar__drag" data-tauri-drag-region />
      <WindowControls />
    </header>
  );
}

function SearchBox() {
  const query = useUi((s) => s.searchQuery);
  const setQuery = useUi((s) => s.setSearchQuery);

  const onFocus = () => {
    const ui = useUi.getState();
    if (ui.route.name !== 'search') ui.navigate({ name: 'search' });
  };

  return (
    <label data-tour="search" className="search-box">
      <Search size={16} className="search-box__icon" />
      <input
        id="global-search"
        value={query}
        placeholder="Треки, исполнители, плейлисты"
        spellCheck={false}
        autoComplete="off"
        onFocus={onFocus}
        onChange={(e) => setQuery(e.target.value)}
      />
      {query ? (
        <button className="search-box__clear" onClick={() => setQuery('')} title="Очистить">
          <X size={14} />
        </button>
      ) : (
        <kbd>Ctrl K</kbd>
      )}
    </label>
  );
}

function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const w = appWindow;
    if (!w) return;
    let alive = true;
    let unlisten: (() => void) | undefined;
    const update = () => {
      w.isMaximized()
        .then((m) => {
          if (alive) setMaximized(m);
        })
        .catch(() => undefined);
    };
    update();
    void w.onResized(update).then((fn) => {
      if (alive) unlisten = fn;
      else fn();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  if (!appWindow) return null;
  // Иконки SVG, а не глифы Segoe Fluent Icons / MDL2: шрифтов может не быть в системе,
  // и тогда вместо значков видны пустые квадраты.
  return (
    <div className="window-controls">
      <button className="wc" onClick={() => void appWindow?.minimize()} title="Свернуть" aria-label="Свернуть">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 5.5h10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
      <button
        className="wc"
        onClick={() => void appWindow?.toggleMaximize()}
        title={maximized ? 'Свернуть в окно' : 'Развернуть'}
        aria-label={maximized ? 'Свернуть в окно' : 'Развернуть'}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="0.5" y="2.5" width="7" height="7" rx="1" />
            <path d="M2.5 2.5V1.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="0.5" y="0.5" width="9" height="9" rx="1.5" />
          </svg>
        )}
      </button>
      <button className="wc wc--close" onClick={() => void appWindow?.close()} title="Закрыть" aria-label="Закрыть">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" stroke="currentColor" strokeWidth="1.05" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
