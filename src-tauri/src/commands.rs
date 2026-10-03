//! Команды для фронтенда (`invoke("имя", {...})`). Аргументы приходят в camelCase.
//!
//! SoundCloud полностью реализован во фронтенде (`src/lib/soundcloud.ts`), ядро даёт ему
//! только сетевой транспорт (`net_fetch`) и прокси потоков (`register_stream`).
use serde::Serialize;
use tauri::State;

use crate::config::AppConfig;
use crate::error::{check_id, AppError, AppResult};
use crate::lyrics;
use crate::models::{
    ArtistPage, Charts, Genre, GenrePage, Lyrics, Playlist, PlaylistDetails, Provider,
    ResolvedStream, SearchResults, StreamKind, Track,
};
use crate::net;
use crate::providers::{self, ytdlp};
use crate::state::AppState;

// ---------- настройки ----------

#[tauri::command]
pub fn get_config(state: State<'_, AppState>) -> AppConfig {
    state.config()
}

#[tauri::command]
pub fn set_config(state: State<'_, AppState>, config: AppConfig) -> AppResult<()> {
    state.save_config(config)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub rustypipe: bool,
}

#[tauri::command]
pub fn app_info(state: State<'_, AppState>) -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        rustypipe: state.youtube.compiled(),
    }
}

// ---------- транспорт SoundCloud ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchResponse {
    pub status: u16,
    pub url: String,
    pub body: String,
}

/// GET-запрос от имени ядра (системный прокси/VPN, без CORS). Только домены SoundCloud.
#[tauri::command]
pub async fn net_fetch(
    state: State<'_, AppState>,
    url: String,
    accept: Option<String>,
) -> AppResult<FetchResponse> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| AppError::msg("Некорректный адрес"))?;
    if !net::fetch_allowed(&parsed) {
        return Err(AppError::msg("Адрес не разрешён"));
    }
    let host = parsed.host_str().unwrap_or("").to_ascii_lowercase();
    let st = state.inner();
    let mut req = st
        .http()
        .get(parsed)
        .timeout(net::API_TIMEOUT)
        .header(
            reqwest::header::ACCEPT,
            accept.unwrap_or_else(|| "application/json, text/plain, */*".to_string()),
        )
        .header(
            reqwest::header::ACCEPT_LANGUAGE,
            "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
        );
    if net::is_soundcloud_host(&host) {
        req = req.header(reqwest::header::REFERER, "https://soundcloud.com/");
        if host.starts_with("api") {
            req = req.header(reqwest::header::ORIGIN, "https://soundcloud.com");
        }
    } else if host == "genius.com" || host.ends_with(".genius.com") {
        req = req.header(reqwest::header::REFERER, "https://genius.com/");
    } else if host == "music.163.com" || host.ends_with(".music.163.com") {
        // Без cookie и Referer NetEase отвечает «Cheating» на анонимные запросы.
        req = req
            .header(reqwest::header::REFERER, "https://music.163.com/")
            .header(reqwest::header::COOKIE, "NMTID=00OAVK3xqDG726ITU6jopU6jF2yMk0AAAGCO8l1BA; os=pc; appver=2.10.13");
    } else if host == "lrclib.net" || host == "api.github.com" {
        // LRCLIB и GitHub просят представляться именем приложения
        req = req.header(
            reqwest::header::USER_AGENT,
            concat!("Frost/", env!("CARGO_PKG_VERSION"), " (Windows music player)"),
        );
    }
    let resp = req.send().await?;
    let status = resp.status().as_u16();
    let final_url = resp.url().to_string();
    let body = resp.text().await?;
    Ok(FetchResponse {
        status,
        url: final_url,
        body,
    })
}

/// Регистрирует поток SoundCloud в прокси `frost://` и возвращает локальный адрес.
#[tauri::command]
pub fn register_stream(state: State<'_, AppState>, url: String) -> AppResult<String> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| AppError::msg("Некорректный адрес"))?;
    if !net::fetch_allowed(&parsed) {
        return Err(AppError::msg("Адрес не разрешён"));
    }
    Ok(state.streams.register(parsed.as_str(), Vec::new()))
}

// ---------- YouTube Music ----------

fn yt_enabled(st: &AppState) -> AppResult<()> {
    if st.config().youtube {
        Ok(())
    } else {
        Err(AppError::msg("YouTube Music выключен в настройках"))
    }
}

#[tauri::command]
pub async fn yt_search(state: State<'_, AppState>, query: String) -> AppResult<SearchResults> {
    let st = state.inner();
    yt_enabled(st)?;
    let q = query.trim().to_string();
    if q.is_empty() {
        return Ok(SearchResults::default());
    }
    match st.youtube.search(q.clone()).await {
        Ok(result) => Ok(result),
        Err(err) => {
            if ytdlp::find_ytdlp(st).is_none() {
                return Err(err);
            }
            let tracks = ytdlp::search(st, &q).await.map_err(|_| err)?;
            Ok(SearchResults {
                tracks,
                ..Default::default()
            })
        }
    }
}

#[tauri::command]
pub async fn yt_search_tracks(state: State<'_, AppState>, query: String) -> AppResult<Vec<Track>> {
    let st = state.inner();
    yt_enabled(st)?;
    let q = query.trim().to_string();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    match st.youtube.search_tracks(q.clone()).await {
        Ok(tracks) => Ok(tracks),
        Err(err) => {
            if ytdlp::find_ytdlp(st).is_none() {
                return Err(err);
            }
            ytdlp::search(st, &q).await.map_err(|_| err)
        }
    }
}

#[tauri::command]
pub async fn yt_artist(state: State<'_, AppState>, id: String) -> AppResult<ArtistPage> {
    check_id(&id)?;
    yt_enabled(state.inner())?;
    state.youtube.artist(id).await
}

#[tauri::command]
pub async fn yt_playlist(state: State<'_, AppState>, id: String) -> AppResult<PlaylistDetails> {
    check_id(&id)?;
    yt_enabled(state.inner())?;
    state.youtube.playlist(id).await
}

#[tauri::command]
pub async fn yt_charts(state: State<'_, AppState>, country: Option<String>) -> AppResult<Charts> {
    yt_enabled(state.inner())?;
    let country = country
        .map(|c| c.trim().to_ascii_uppercase())
        .filter(|c| c.len() == 2 && c.chars().all(|ch| ch.is_ascii_alphabetic()));
    state.youtube.charts(country).await
}

#[tauri::command]
pub async fn yt_new_releases(state: State<'_, AppState>) -> AppResult<Vec<Playlist>> {
    yt_enabled(state.inner())?;
    state.youtube.new_releases().await
}

#[tauri::command]
pub async fn yt_genres(state: State<'_, AppState>) -> AppResult<Vec<Genre>> {
    yt_enabled(state.inner())?;
    state.youtube.genres().await
}

#[tauri::command]
pub async fn yt_genre(state: State<'_, AppState>, id: String) -> AppResult<GenrePage> {
    check_id(&id)?;
    yt_enabled(state.inner())?;
    state.youtube.genre(id).await
}

#[tauri::command]
pub async fn yt_radio(state: State<'_, AppState>, id: String) -> AppResult<Vec<Track>> {
    check_id(&id)?;
    yt_enabled(state.inner())?;
    state.youtube.radio(id).await
}

#[tauri::command]
pub async fn yt_track(state: State<'_, AppState>, id: String) -> AppResult<Track> {
    check_id(&id)?;
    yt_enabled(state.inner())?;
    state.youtube.track(id).await
}

/// Поток YouTube (движок по настройкам) → адрес прокси `frost://`.
#[tauri::command]
pub async fn yt_stream(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    engine: Option<crate::config::YtEngine>,
) -> AppResult<ResolvedStream> {
    check_id(&id)?;
    let st = state.inner();
    yt_enabled(st)?;
    // Основной путь: файл целиком (из кэша или полной загрузкой, см. ytaudio.rs).
    let err = match crate::ytaudio::open(&app, st, &id, engine).await {
        Ok(url) => {
            return Ok(ResolvedStream {
                url,
                kind: StreamKind::Progressive,
                preview: false,
            })
        }
        Err(err) => err,
    };
    // Запасной путь: если файла нет вовсе, а yt-dlp может дать HLS-плейлист.
    if let Ok(source) = providers::youtube_stream(st, &id, engine).await {
        if matches!(source.kind, StreamKind::Hls) {
            let url = st
                .streams
                .register_track(&source.url, Provider::Youtube, &id, source.headers.clone());
            return Ok(ResolvedStream {
                url,
                kind: StreamKind::Hls,
                preview: false,
            });
        }
    }
    Err(err)
}

/// Заранее скачивает трек YouTube (следующий в очереди), чтобы он начался мгновенно.
#[tauri::command]
pub async fn yt_prefetch(app: tauri::AppHandle, state: State<'_, AppState>, id: String) -> AppResult<()> {
    check_id(&id)?;
    let st = state.inner();
    yt_enabled(st)?;
    crate::ytaudio::prefetch(&app, st, &id);
    Ok(())
}

#[tauri::command]
pub fn yt_cache_info(state: State<'_, AppState>) -> crate::ytaudio::CacheInfo {
    state.audio.info(state.inner())
}

#[tauri::command]
pub fn yt_cache_clear(state: State<'_, AppState>) -> crate::ytaudio::CacheInfo {
    state.audio.clear();
    state.audio.info(state.inner())
}

/// Проверка всех способов получить звук YouTube (отчёт текстом).
#[tauri::command]
pub async fn yt_diagnose(state: State<'_, AppState>, id: Option<String>) -> AppResult<String> {
    let id = id
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "dQw4w9WgXcQ".to_string());
    check_id(&id)?;
    Ok(crate::ytaudio::diagnose(state.inner(), &id).await)
}

// ---------- тексты песен ----------

#[tauri::command]
pub async fn get_lyrics(
    state: State<'_, AppState>,
    provider: Provider,
    id: String,
    artist: String,
    title: String,
    duration: f64,
) -> AppResult<Option<Lyrics>> {
    let st = state.inner();
    if let Ok(Some(found)) = lyrics::find(st, &artist, &title, duration).await {
        return Ok(Some(found));
    }
    if provider == Provider::Youtube && check_id(&id).is_ok() && st.config().youtube {
        if let Ok(Some(text)) = st.youtube.lyrics(id).await {
            return Ok(Some(Lyrics {
                synced: None,
                plain: Some(text),
                instrumental: false,
                source: "YouTube Music".to_string(),
            }));
        }
    }
    Ok(None)
}

// ---------- yt-dlp ----------

#[tauri::command]
pub async fn ytdlp_status(state: State<'_, AppState>) -> AppResult<ytdlp::YtdlpStatus> {
    Ok(ytdlp::status(state.inner()).await)
}

#[tauri::command]
pub async fn ytdlp_install(state: State<'_, AppState>) -> AppResult<ytdlp::YtdlpStatus> {
    ytdlp::install(state.inner()).await
}

#[tauri::command]
pub async fn ytdlp_update(state: State<'_, AppState>) -> AppResult<ytdlp::YtdlpStatus> {
    ytdlp::update(state.inner()).await
}

#[tauri::command]
pub async fn deno_install(state: State<'_, AppState>) -> AppResult<ytdlp::YtdlpStatus> {
    ytdlp::install_deno(state.inner()).await
}

#[tauri::command]
pub async fn botguard_install(state: State<'_, AppState>) -> AppResult<ytdlp::YtdlpStatus> {
    ytdlp::install_botguard(state.inner()).await
}

#[tauri::command]
pub async fn botguard_remove(state: State<'_, AppState>) -> AppResult<ytdlp::YtdlpStatus> {
    ytdlp::remove_botguard(state.inner());
    Ok(ytdlp::status(state.inner()).await)
}
