import { BarChart3, Clock, HardDrive, Heart, House, Library, Plus, Search, Settings } from 'lucide-react';
import { TelegramCard } from './Telegram';
import type { ReactNode } from 'react';
import { tracksLabel } from '../lib/format';
import { focusSearch } from '../hooks/useShortcuts';
import { useLibrary } from '../store/library';
import { useLocal } from '../store/local';
import { useUi } from '../store/ui';
import { Mosaic } from './Mosaic';

export function promptCreatePlaylist() {
  useUi.getState().openModal({
    kind: 'prompt',
    title: 'Новый плейлист',
    placeholder: 'Название плейлиста',
    confirm: 'Создать',
    onSubmit: (name) => {
      const id = useLibrary.getState().createPlaylist(name);
      useUi.getState().navigate({ name: 'local-playlist', id });
    },
  });
}

function NavItem({
  active,
  icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button className={`nav-item ${active ? 'is-active' : ''}`} onClick={onClick} aria-current={active ? 'page' : undefined}>
      {icon}
      <span className="nav-item__label">{label}</span>
      {count ? <span className="nav-item__count">{count}</span> : null}
    </button>
  );
}

export function Sidebar() {
  const route = useUi((s) => s.route);
  const navigate = useUi((s) => s.navigate);
  const playlists = useLibrary((s) => s.playlists);
  const likedCount = useLibrary((s) => s.liked.length);
  const localCount = useLocal((s) => s.tracks.length);
  const activePlaylist = route.name === 'local-playlist' ? route.id : null;
  const libraryTab = route.name === 'library' ? route.tab ?? 'playlists' : null;

  return (
    <aside className="sidebar">
      <nav className="sidebar__nav" data-tour="nav">
        <NavItem active={route.name === 'home'} icon={<House size={18} />} label="Главная" onClick={() => navigate({ name: 'home' })} />
        <NavItem active={route.name === 'search'} icon={<Search size={18} />} label="Поиск" onClick={focusSearch} />
        <NavItem
          active={libraryTab !== null && libraryTab !== 'history'}
          icon={<Library size={18} />}
          label="Медиатека"
          onClick={() => navigate({ name: 'library' })}
        />
      </nav>

      <div className="sidebar__group" data-tour="library">
      <div className="sidebar__section">
        <span>Моя музыка</span>
      </div>
      <NavItem
        active={route.name === 'liked'}
        icon={<Heart size={18} />}
        label="Любимые треки"
        count={likedCount}
        onClick={() => navigate({ name: 'liked' })}
      />
      <NavItem
        active={route.name === 'local'}
        icon={<HardDrive size={18} />}
        label="На компьютере"
        count={localCount || undefined}
        onClick={() => navigate({ name: 'local' })}
      />
      <NavItem
        active={libraryTab === 'history'}
        icon={<Clock size={18} />}
        label="История"
        onClick={() => navigate({ name: 'library', tab: 'history' })}
      />
      <NavItem active={route.name === 'wrapped'} icon={<BarChart3 size={18} />} label="Итоги" onClick={() => navigate({ name: 'wrapped' })} />
      </div>

      <div className="sidebar__section">
        <span>Плейлисты</span>
        <button className="icon-btn icon-btn--xs" title="Создать плейлист" aria-label="Создать плейлист" onClick={promptCreatePlaylist}>
          <Plus size={16} />
        </button>
      </div>
      <div className="sidebar__playlists">
        {playlists.length === 0 && (
          <button className="sidebar__hint" onClick={promptCreatePlaylist}>
            <Plus size={14} /> Создать первый плейлист
          </button>
        )}
        {playlists.map((p) => (
          <button
            key={p.id}
            className={`pl-item ${activePlaylist === p.id ? 'is-active' : ''}`}
            onClick={() => navigate({ name: 'local-playlist', id: p.id })}
          >
            <Mosaic tracks={p.tracks} size={38} />
            <span className="pl-item__text">
              <span className="pl-item__name">{p.name}</span>
              <span className="pl-item__meta">{tracksLabel(p.tracks.length)}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="sidebar__footer">
        <TelegramCard />
        <div data-tour="settings">
          <NavItem
            active={route.name === 'settings'}
            icon={<Settings size={18} />}
            label="Настройки"
            onClick={() => navigate({ name: 'settings' })}
          />
        </div>
      </div>
    </aside>
  );
}
