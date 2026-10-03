import { lazy, Suspense, useEffect } from 'react';
import { engine } from './audio/engine';
import { Ambient } from './components/Ambient';
import { ContextMenu } from './components/ContextMenu';
import { ModalHost } from './components/Modals';
import { NowPlaying } from './components/NowPlaying';
import { Onboarding } from './components/Onboarding';
import { PlayerBar } from './components/PlayerBar';
import { SidePanel } from './components/SidePanel';
import { Sidebar } from './components/Sidebar';
import { Spinner } from './components/States';
import { TitleBar } from './components/TitleBar';
import { Toasts } from './components/Toasts';
import { useAppearance } from './hooks/useAppearance';
import { useUpdateCheck, useYtdlpBootstrap, useYtdlpSchedule } from './hooks/useBackground';
import { useDesktop } from './hooks/useDesktop';
import { useDiscordPresence, useListening } from './hooks/useIntegrations';
import { useShortcuts } from './hooks/useShortcuts';
import { useSleepTimer } from './hooks/useSleepTimer';
import { HomePage } from './pages/HomePage';
import { LibraryPage } from './pages/LibraryPage';
import { LikedPage } from './pages/LikedPage';
import { LocalPlaylistPage, RemotePlaylistPage } from './pages/PlaylistPage';
import { SearchPage } from './pages/SearchPage';
import { initLocalLibrary } from './store/local';
import { useSettings } from './store/settings';
import { toast, useUi, type Route } from './store/ui';

// Редкие страницы грузятся по требованию: быстрее первый запуск
const ArtistPage = lazy(() => import('./pages/ArtistPage').then((m) => ({ default: m.ArtistPage })));
const GenrePage = lazy(() => import('./pages/GenrePage').then((m) => ({ default: m.GenrePage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const LocalPage = lazy(() => import('./pages/LocalPage').then((m) => ({ default: m.LocalPage })));
const WrappedPage = lazy(() => import('./pages/WrappedPage').then((m) => ({ default: m.WrappedPage })));

function RouteView({ route }: { route: Route }) {
  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'search':
      return <SearchPage />;
    case 'library':
      return <LibraryPage tab={route.tab ?? 'playlists'} />;
    case 'liked':
      return <LikedPage />;
    case 'local-playlist':
      return <LocalPlaylistPage id={route.id} />;
    case 'playlist':
      return <RemotePlaylistPage provider={route.provider} id={route.id} />;
    case 'artist':
      return <ArtistPage provider={route.provider} id={route.id} />;
    case 'genre':
      return <GenrePage key={`${route.provider}:${route.id}`} provider={route.provider} id={route.id} title={route.title} />;
    case 'local':
      return <LocalPage tab={route.tab ?? 'tracks'} />;
    case 'wrapped':
      return <WrappedPage />;
    case 'settings':
      return <SettingsPage />;
  }
}

/** Устройство вывода и выравнивание громкости из настроек. */
function useAudioOutput() {
  const device = useSettings((s) => s.outputDevice);
  const normalize = useSettings((s) => s.normalize);
  useEffect(() => {
    void engine.setOutputDevice(device).then((ok) => {
      if (!ok && device) toast('Выбранное устройство вывода недоступно, звук идёт в устройство Windows по умолчанию', 'error');
    });
  }, [device]);
  useEffect(() => engine.setNormalize(normalize), [normalize]);
}

export default function App() {
  const route = useUi((s) => s.route);
  useShortcuts();
  useAppearance();
  useSleepTimer();
  useYtdlpBootstrap();
  useYtdlpSchedule();
  useUpdateCheck();
  useDesktop();
  useAudioOutput();
  useListening();
  useDiscordPresence();

  useEffect(() => {
    void useSettings.getState().loadConfig();
    useUi.getState().setSearchProvider(useSettings.getState().searchSource);
    void initLocalLibrary();
    // Системное меню WebView («Обновить», «Проверить элемент») скрываем везде, кроме полей ввода.
    const onContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('input, textarea')) e.preventDefault();
    };
    document.addEventListener('contextmenu', onContextMenu);
    // Интерфейс готов: убираем заставку (index.html), выдержав её минимальную длительность
    window.requestAnimationFrame(() => window.__frostSplashDone?.());
    return () => document.removeEventListener('contextmenu', onContextMenu);
  }, []);

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Перейти к содержимому
      </a>
      <Ambient />
      <TitleBar />
      <div className="app__body">
        <Sidebar />
        <main className="main" id="main" tabIndex={-1}>
          <div className="main__scroll" key={JSON.stringify(route)}>
            <Suspense
              fallback={
                <div className="page-loading" role="status" aria-label="Загрузка">
                  <Spinner />
                </div>
              }
            >
              <RouteView route={route} />
            </Suspense>
          </div>
        </main>
        <SidePanel />
      </div>
      <PlayerBar />
      <NowPlaying />
      <ContextMenu />
      <ModalHost />
      <Onboarding />
      <Toasts />
    </div>
  );
}
