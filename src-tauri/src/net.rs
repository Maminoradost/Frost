//! HTTP-клиент ядра: заголовки браузера, таймауты, режимы сети.
use std::time::Duration;

use crate::config::{AppConfig, NetMode};
use crate::error::{AppError, AppResult};

/// Обычный Chrome под Windows: так нас воспринимают как посетителя сайта.
pub const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
pub const API_TIMEOUT: Duration = Duration::from_secs(20);
/// Таймаут на один чанк аудио.
pub const MEDIA_TIMEOUT: Duration = Duration::from_secs(60);

/// Собирает `ClientBuilder` по настройкам сети.
pub fn client_builder(cfg: &AppConfig) -> reqwest::ClientBuilder {
    let mut builder = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(15))
        .pool_idle_timeout(Duration::from_secs(90));
    match cfg.net_mode {
        // reqwest сам читает системный прокси (переменные окружения и настройки Windows).
        NetMode::System => {}
        NetMode::Direct => {
            builder = builder.no_proxy();
        }
        NetMode::Custom => {
            let raw = cfg.proxy_url.trim();
            match reqwest::Proxy::all(raw) {
                Ok(proxy) if !raw.is_empty() => builder = builder.proxy(proxy),
                _ => builder = builder.no_proxy(),
            }
        }
    }
    builder
}

/// Домены, к которым фронтенд может обращаться через `net_fetch` (клиент SoundCloud).
pub fn fetch_allowed(url: &reqwest::Url) -> bool {
    if url.scheme() != "https" {
        return false;
    }
    let host = url.host_str().unwrap_or("").to_ascii_lowercase();
    [
        // SoundCloud без ключей (client_id из бандлов, api-v2)
        "soundcloud.com",
        "sndcdn.com",
        "soundcloud.cloud",
        // Тексты песен: LRCLIB (синхронизированные) и Genius (дополнительный источник)
        "lrclib.net",
        "genius.com",
        // NetEase Cloud Music: большой каталог синхронизированных текстов
        "music.163.com",
        // Проверка обновлений через GitHub Releases
        "api.github.com",
    ]
    .iter()
    .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
}

/// Хост SoundCloud: таким запросам нужны Referer/Origin сайта.
pub fn is_soundcloud_host(host: &str) -> bool {
    ["soundcloud.com", "sndcdn.com", "soundcloud.cloud"]
        .iter()
        .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
}

/// Человеческое описание HTTP-статуса (без HTML-страниц в интерфейсе).
pub fn status_message(status: u16) -> String {
    let text = match status {
        400 => "Сервис отклонил запрос",
        401 => "Сервис требует авторизацию",
        403 => "Доступ запрещён: сервис недоступен из вашей сети или региона",
        404 => "Не найдено",
        410 => "Ссылка устарела",
        429 => "Слишком много запросов, попробуйте через минуту",
        500..=599 => "Сервис временно недоступен",
        _ => "Сервис вернул ошибку",
    };
    format!("{text} (HTTP {status})")
}

/// Превращает не-2xx ответ в понятную ошибку.
pub async fn ensure_ok(resp: reqwest::Response) -> AppResult<reqwest::Response> {
    let status = resp.status();
    if status.is_success() {
        return Ok(resp);
    }
    Err(AppError::Upstream {
        status: status.as_u16(),
        message: status_message(status.as_u16()),
    })
}
