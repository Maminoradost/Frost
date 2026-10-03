use std::path::PathBuf;
use std::sync::RwLock;

use crate::config::AppConfig;
use crate::error::AppResult;
use crate::net;
use crate::providers::youtube::YouTube;
use crate::stream::StreamRegistry;

/// Общее состояние ядра (регистрируется через `app.manage`).
pub struct AppState {
    http: RwLock<reqwest::Client>,
    config: RwLock<AppConfig>,
    config_path: RwLock<Option<PathBuf>>,
    data_dir: RwLock<Option<PathBuf>>,
    pub youtube: YouTube,
    pub streams: StreamRegistry,
    pub audio: crate::ytaudio::AudioStore,
}

impl AppState {
    pub fn new() -> Self {
        let cfg = AppConfig::default();
        let http = net::client_builder(&cfg).build().unwrap_or_default();
        Self {
            http: RwLock::new(http),
            config: RwLock::new(cfg),
            config_path: RwLock::new(None),
            data_dir: RwLock::new(None),
            youtube: YouTube::new(),
            streams: StreamRegistry::default(),
            audio: crate::ytaudio::AudioStore::default(),
        }
    }

    /// Вызывается в `setup`, когда известна папка данных приложения.
    pub fn init(&self, dir: PathBuf) {
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("config.json");
        let cfg = AppConfig::load(&path);
        *self.config_path.write().unwrap() = Some(path);
        *self.data_dir.write().unwrap() = Some(dir.clone());
        *self.config.write().unwrap() = cfg.clone();
        self.rebuild_http();
        self.youtube.init(dir.join("youtube"), &cfg);
    }

    /// Клиент дешёвый в клонировании (внутри Arc).
    pub fn http(&self) -> reqwest::Client {
        self.http.read().unwrap().clone()
    }

    fn rebuild_http(&self) {
        let cfg = self.config();
        if let Ok(client) = net::client_builder(&cfg).build() {
            *self.http.write().unwrap() = client;
        }
    }

    pub fn config(&self) -> AppConfig {
        self.config.read().unwrap().clone()
    }

    /// Папка данных приложения (`%APPDATA%\app.frost.player`).
    pub fn data_dir(&self) -> Option<PathBuf> {
        self.data_dir.read().unwrap().clone()
    }

    pub fn save_config(&self, cfg: AppConfig) -> AppResult<()> {
        let old = self.config();
        let path = self.config_path.read().unwrap().clone();
        if let Some(path) = path {
            cfg.save(&path)?;
        }
        *self.config.write().unwrap() = cfg.clone();
        let network_changed = old.net_mode != cfg.net_mode || old.proxy_url != cfg.proxy_url;
        if network_changed {
            self.rebuild_http();
        }
        if network_changed || old.region != cfg.region || old.language != cfg.language {
            self.youtube.rebuild(&cfg);
        }
        Ok(())
    }
}
