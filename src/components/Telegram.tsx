import { X } from 'lucide-react';
import { TELEGRAM_URL } from '../lib/links';
import { openExternal } from '../lib/window';
import { useSettings } from '../store/settings';

/** Логотип Telegram (бумажный самолётик в круге). */
export function TelegramIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#2AABEE" />
      <path
        fill="#fff"
        d="M5.43 11.87c3.5-1.52 5.83-2.53 6.99-3.02 3.33-1.39 4.02-1.63 4.47-1.64.1 0 .32.02.47.14.12.1.15.23.17.33.02.1.04.31.02.48-.18 1.9-.96 6.5-1.36 8.63-.17.9-.5 1.2-.82 1.23-.7.06-1.23-.46-1.9-.9-1.06-.7-1.66-1.13-2.69-1.8-1.19-.79-.42-1.22.26-1.93.18-.18 3.26-2.99 3.32-3.24 0-.03.01-.15-.06-.21-.07-.06-.17-.04-.25-.02-.1.02-1.8 1.14-5.07 3.35-.48.33-.92.49-1.3.48-.43-.01-1.26-.24-1.87-.44-.75-.24-1.35-.37-1.3-.79.03-.22.33-.44.92-.66Z"
      />
    </svg>
  );
}

export const openTelegram = () => void openExternal(TELEGRAM_URL);

/** Карточка канала внизу боковой панели: заметная, но спокойная и скрываемая. */
export function TelegramCard() {
  const hidden = useSettings((s) => s.hideTelegramCard);
  if (hidden) return null;
  return (
    <div className="tg-card">
      <button className="tg-card__main" onClick={openTelegram} title="Открыть канал Frost в Telegram">
        <TelegramIcon size={28} />
        <span className="tg-card__text">
          <span className="tg-card__title">Frost в Telegram</span>
          <span className="tg-card__sub">новости и обновления</span>
        </span>
      </button>
      <button
        className="icon-btn icon-btn--xs tg-card__close"
        title="Скрыть (ссылка останется в «О программе»)"
        aria-label="Скрыть карточку Telegram"
        onClick={() => useSettings.getState().update({ hideTelegramCard: true })}
      >
        <X size={14} />
      </button>
    </div>
  );
}
