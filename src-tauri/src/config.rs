//! Настройки ядра. Хранятся в `%APPDATA%\app.frost.player\config.json`.
//! Никаких ключей API: всё работает сразу после установки.
use std::path::Path;

use serde::{Deserialize, Serialize};

/// Как ядро выходит в сеть.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum NetMode {
    /// Как браузер: системный прокси Windows / переменные окружения (подхватывает VPN-клиенты).
    #[default]
    System,
    /// Свой прокси (http://, https://, socks5://).
    Custom,
    /// Напрямую, без прокси.
    Direct,
}

/// Чем получать аудиопотоки YouTube Music.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum YtEngine {
    /// Звук через yt-dlp, если он установлен (Frost ставит его сам), иначе RustyPipe;
    /// при ошибке одного пробуем другой. Рекомендуется.
    #[default]
    Auto,
    /// Только RustyPipe: быстрый, встроен в приложение.
    Rustypipe,
    /// Только yt-dlp: отдельная программа, обновляется независимо от Frost.
    Ytdlp,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AppConfig {
    pub net_mode: NetMode,
    pub proxy_url: String,
    pub soundcloud: bool,
    pub youtube: bool,
    pub yt_engine: YtEngine,
    /// Путь к своему yt-dlp.exe (необязательно).
    pub ytdlp_path: String,
    /// Страна для чартов и выдачи YouTube Music (ISO-код, например "RU").
    pub region: String,
    /// Язык ответов YouTube Music ("ru", "en", "uk"...).
    pub language: String,
    /// Хранить скачанные треки YouTube на диске (повторное прослушивание без сети).
    pub audio_cache: bool,
    /// Предел кэша, МБ.
    pub audio_cache_mb: u32,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            net_mode: NetMode::System,
            proxy_url: String::new(),
            soundcloud: true,
            youtube: true,
            yt_engine: YtEngine::Auto,
            ytdlp_path: String::new(),
            region: "RU".to_string(),
            language: "ru".to_string(),
            audio_cache: true,
            audio_cache_mb: 2048,
        }
    }
}

impl AppConfig {
    pub fn load(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|text| serde_json::from_str::<AppConfig>(&text).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let text = serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".to_string());
        std::fs::write(path, text)
    }
}
