/** Внешние ссылки проекта: меняются в одном месте. */

/** Telegram-канал Frost: новости, обновления, обратная связь. */
export const TELEGRAM_URL = 'https://t.me/+5N4FXvQT9C8wYjNi';

/**
 * Репозиторий на GitHub в формате «владелец/репозиторий» (например, `ivan/frost`).
 * Если указан, Frost раз в день проверяет новые релизы и тихо сообщает об обновлении.
 * Пустая строка отключает проверку.
 */
export const GITHUB_REPO = 'Maminoradost/frost';

export const githubUrl = (path = '') => (GITHUB_REPO ? `https://github.com/${GITHUB_REPO}${path}` : '');

/**
 * Discord Rich Presence: Application ID приложения с именем «Frost»
 * (https://discord.com/developers/applications → New Application). Имя приложения
 * Discord показывает в статусе: «Слушает Frost». Пусто — пользователь может
 * вписать свой ID в настройках.
 */
export const DISCORD_APP_ID = '';

/**
 * Last.fm API (https://www.last.fm/api/account/create). Без ключа и секрета
 * скробблинг в Last.fm недоступен; ListenBrainz работает и так.
 */
export const LASTFM_API_KEY = '';
export const LASTFM_API_SECRET = '';

/** Где взять токен ListenBrainz. */
export const LISTENBRAINZ_SETTINGS = 'https://listenbrainz.org/settings/';

/** Новый отчёт об ошибке на GitHub. */
export const newIssueUrl = () => githubUrl('/issues/new?template=bug_report.yml');
