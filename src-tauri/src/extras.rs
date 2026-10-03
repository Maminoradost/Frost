//! Команды версий 0.3–0.6: обновление в один клик, локальные файлы, резервная копия,
//! POST-запросы для скробблинга, статус в Discord и служебные мелочи.

use std::fs::File;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Manager, State};

use crate::error::{AppError, AppResult};
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Обновление в один клик
// ---------------------------------------------------------------------------

/// Установщик скачивается только из релизов этого репозитория.
const RELEASES_PREFIX: &str = "https://github.com/Maminoradost/frost/releases/download/";

/// Скачивает установщик NSIS из релиза, запускает его в режиме обновления
/// (`/P` — только полоса прогресса, `/UPDATE` — без лишних вопросов, `/R` — перезапуск Frost)
/// и закрывает приложение, чтобы установщик мог заменить файлы.
#[tauri::command]
pub async fn update_install(app: AppHandle, state: State<'_, AppState>, url: String) -> AppResult<()> {
    if !url.starts_with(RELEASES_PREFIX) || !url.ends_with("-setup.exe") {
        return Err(AppError::msg("Обновление можно скачать только из релизов Frost на GitHub"));
    }
    let name = url.rsplit('/').next().unwrap_or_default().to_string();
    if name.is_empty() || name.contains("..") || name.contains('\\') || name.contains('%') {
        return Err(AppError::msg("Странное имя файла обновления"));
    }

    let resp = state
        .http()
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Не удалось скачать обновление: {e}")))?;
    let resp = crate::net::ensure_ok(resp).await?;
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::Network(format!("Обновление скачалось не полностью: {e}")))?;
    if bytes.len() < 512 * 1024 {
        return Err(AppError::msg("Файл обновления подозрительно маленький, установка отменена"));
    }

    let dir = std::env::temp_dir().join("frost-update");
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(&name);
    std::fs::write(&path, &bytes)?;

    std::process::Command::new(&path)
        .args(["/P", "/UPDATE", "/R"])
        .spawn()
        .map_err(|e| AppError::msg(format!("Не удалось запустить установщик: {e}")))?;
    app.exit(0);
    Ok(())
}

// ---------------------------------------------------------------------------
// Локальные файлы
// ---------------------------------------------------------------------------

/// Форматы, которые умеет играть WebView2.
const AUDIO_EXT: &[&str] = &["mp3", "flac", "m4a", "aac", "ogg", "oga", "opus", "wav", "webm"];
const MAX_FILES: usize = 50_000;
const MAX_DEPTH: usize = 16;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFile {
    pub path: String,
    pub size: u64,
    /// Время изменения, секунды Unix.
    pub modified: u64,
    /// Картинка альбома из той же папки (cover.jpg, folder.jpg…), если есть.
    pub cover: Option<String>,
}

/// Обходит папки с музыкой и открывает их для протокола asset (воспроизведение и чтение тегов).
#[tauri::command]
pub async fn local_scan(app: AppHandle, folders: Vec<String>) -> AppResult<Vec<LocalFile>> {
    tauri::async_runtime::spawn_blocking(move || scan_folders(&app, &folders))
        .await
        .map_err(|e| AppError::msg(e.to_string()))?
}

fn scan_folders(app: &AppHandle, folders: &[String]) -> AppResult<Vec<LocalFile>> {
    let scope = app.asset_protocol_scope();
    let mut out = Vec::new();
    for folder in folders {
        let root = PathBuf::from(folder);
        if !root.is_dir() {
            continue;
        }
        scope
            .allow_directory(&root, true)
            .map_err(|e| AppError::msg(format!("Нет доступа к папке {folder}: {e}")))?;
        walk(&root, 0, &mut out);
        if out.len() >= MAX_FILES {
            break;
        }
    }
    Ok(out)
}

/// Обложки, которые плееры кладут рядом с треками. Чем раньше в списке, тем важнее.
const COVER_NAMES: [&str; 6] = ["cover", "folder", "front", "album", "albumart", "albumartsmall"];

fn cover_rank(path: &Path) -> Option<usize> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    if !matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "webp") {
        return None;
    }
    let stem = path.file_stem()?.to_str()?.to_ascii_lowercase();
    COVER_NAMES.iter().position(|n| *n == stem)
}

fn walk(dir: &Path, depth: usize, out: &mut Vec<LocalFile>) {
    if depth > MAX_DEPTH || out.len() >= MAX_FILES {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let start = out.len();
    let mut cover: Option<(usize, String)> = None;
    for entry in entries.flatten() {
        let path = entry.path();
        // metadata() у DirEntry не идёт по ссылкам: так не зациклимся на junction
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if meta.is_dir() {
            walk(&path, depth + 1, out);
        } else if meta.is_file() && is_audio(&path) {
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            out.push(LocalFile {
                path: path.to_string_lossy().into_owned(),
                size: meta.len(),
                modified,
                cover: None,
            });
        } else if meta.is_file() {
            if let Some(rank) = cover_rank(&path) {
                if cover.as_ref().map_or(true, |(best, _)| rank < *best) {
                    cover = Some((rank, path.to_string_lossy().into_owned()));
                }
            }
        }
        if out.len() >= MAX_FILES {
            break;
        }
    }
    if let Some((_, image)) = cover {
        for file in out[start..].iter_mut() {
            if Path::new(&file.path).parent() == Some(dir) {
                file.cover = Some(image.clone());
            }
        }
    }
}

/// Папка кэша обложек локальных файлов.
fn covers_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| AppError::msg(e.to_string()))?
        .join("covers");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Открывает для протокола asset кэш обложек и уже добавленные папки с музыкой
/// (разрешения живут до перезапуска, поэтому зовём при каждом старте).
#[tauri::command]
pub fn local_allow(app: AppHandle, folders: Vec<String>) -> AppResult<String> {
    let scope = app.asset_protocol_scope();
    let covers = covers_dir(&app)?;
    scope
        .allow_directory(&covers, false)
        .map_err(|e| AppError::msg(e.to_string()))?;
    for folder in folders {
        let root = PathBuf::from(&folder);
        if root.is_dir() {
            let _ = scope.allow_directory(&root, true);
        }
    }
    Ok(covers.to_string_lossy().into_owned())
}

/// Сохраняет уменьшенную обложку (JPEG) и возвращает путь к файлу.
#[tauri::command]
pub fn local_cover_save(app: AppHandle, key: String, bytes: Vec<u8>) -> AppResult<String> {
    let valid = (8..=64).contains(&key.len()) && key.chars().all(|c| c.is_ascii_alphanumeric());
    if !valid || bytes.is_empty() || bytes.len() > 2 * 1024 * 1024 {
        return Err(AppError::msg("Неверная обложка"));
    }
    let path = covers_dir(&app)?.join(format!("{key}.jpg"));
    std::fs::write(&path, &bytes)?;
    Ok(path.to_string_lossy().into_owned())
}

fn is_audio(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO_EXT.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Резервная копия
// ---------------------------------------------------------------------------

/// Записывает резервную копию в файл, выбранный в диалоге сохранения. Только `.json`.
#[tauri::command]
pub fn backup_write(path: String, contents: String) -> AppResult<()> {
    let target = PathBuf::from(&path);
    let is_json = target
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("json"))
        .unwrap_or(false);
    if !is_json {
        return Err(AppError::msg("Резервную копию можно сохранить только в файл .json"));
    }
    std::fs::write(&target, contents)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// POST для скробблинга (ListenBrainz, Last.fm)
// ---------------------------------------------------------------------------

const POST_HOSTS: &[&str] = &["api.listenbrainz.org", "ws.audioscrobbler.com"];

/// Запрос к сервисам скробблинга. В отличие от `net_fetch` умеет POST и заголовок
/// Authorization, а ответ с ошибкой возвращает как есть: у Last.fm и ListenBrainz
/// в теле лежит понятное описание (неверный токен, истёкшая сессия).
#[tauri::command]
pub async fn net_post(
    state: State<'_, AppState>,
    url: String,
    body: String,
    content_type: Option<String>,
    authorization: Option<String>,
    method: Option<String>,
) -> AppResult<crate::commands::FetchResponse> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| AppError::msg("Неверный адрес"))?;
    let host = parsed.host_str().unwrap_or("").to_ascii_lowercase();
    if parsed.scheme() != "https" || !POST_HOSTS.contains(&host.as_str()) {
        return Err(AppError::msg("Этот адрес не разрешён"));
    }
    let mut req = if method.as_deref() == Some("GET") {
        state.http().get(parsed)
    } else {
        state
            .http()
            .post(parsed)
            .header(
                reqwest::header::CONTENT_TYPE,
                content_type.unwrap_or_else(|| "application/json".to_string()),
            )
            .body(body)
    };
    if let Some(auth) = authorization {
        req = req.header(reqwest::header::AUTHORIZATION, auth);
    }
    let resp = req
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;
    let status = resp.status().as_u16();
    let final_url = resp.url().to_string();
    let body = resp.text().await.map_err(|e| AppError::Network(e.to_string()))?;
    Ok(crate::commands::FetchResponse {
        status,
        url: final_url,
        body,
    })
}

// ---------------------------------------------------------------------------
// Discord Rich Presence: свой маленький клиент IPC без лишних зависимостей
// ---------------------------------------------------------------------------

struct DiscordConn {
    pipe: File,
    client_id: String,
}

/// Открытое подключение к Discord (или ничего).
#[derive(Default)]
pub struct Discord(Mutex<Option<DiscordConn>>);

fn write_frame(pipe: &mut File, op: u32, payload: &serde_json::Value) -> io::Result<()> {
    let data = serde_json::to_vec(payload)?;
    let mut buf = Vec::with_capacity(8 + data.len());
    buf.extend_from_slice(&op.to_le_bytes());
    buf.extend_from_slice(&(data.len() as u32).to_le_bytes());
    buf.extend_from_slice(&data);
    pipe.write_all(&buf)?;
    pipe.flush()
}

fn read_frame(pipe: &mut File) -> io::Result<(u32, Vec<u8>)> {
    let mut head = [0u8; 8];
    pipe.read_exact(&mut head)?;
    let op = u32::from_le_bytes([head[0], head[1], head[2], head[3]]);
    let len = u32::from_le_bytes([head[4], head[5], head[6], head[7]]) as usize;
    if len > 256 * 1024 {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "слишком большой ответ Discord"));
    }
    let mut data = vec![0u8; len];
    pipe.read_exact(&mut data)?;
    Ok((op, data))
}

#[cfg(windows)]
fn open_pipe(client_id: &str) -> io::Result<File> {
    for i in 0..10 {
        let name = format!(r"\\.\pipe\discord-ipc-{i}");
        let Ok(mut pipe) = std::fs::OpenOptions::new().read(true).write(true).open(&name) else {
            continue;
        };
        write_frame(&mut pipe, 0, &json!({ "v": 1, "client_id": client_id }))?;
        let (op, _) = read_frame(&mut pipe)?;
        if op == 2 {
            return Err(io::Error::new(io::ErrorKind::PermissionDenied, "Discord отклонил подключение"));
        }
        return Ok(pipe);
    }
    Err(io::Error::new(io::ErrorKind::NotFound, "Discord не запущен"))
}

#[cfg(not(windows))]
fn open_pipe(_client_id: &str) -> io::Result<File> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "Статус в Discord работает только в Windows"))
}

/// Подключение с таймаутом: если Discord завис, не держим команду вечно.
fn connect(client_id: &str) -> AppResult<File> {
    let (tx, rx) = std::sync::mpsc::channel();
    let id = client_id.to_string();
    std::thread::spawn(move || {
        let _ = tx.send(open_pipe(&id));
    });
    match rx.recv_timeout(Duration::from_secs(3)) {
        Ok(Ok(pipe)) => Ok(pipe),
        Ok(Err(e)) => Err(AppError::msg(format!("Discord: {e}"))),
        Err(_) => Err(AppError::msg("Discord не ответил")),
    }
}

fn send_command(pipe: &mut File, payload: &serde_json::Value) -> io::Result<()> {
    write_frame(pipe, 1, payload)?;
    let (op, _) = read_frame(pipe)?;
    if op == 2 {
        return Err(io::Error::new(io::ErrorKind::ConnectionAborted, "Discord закрыл подключение"));
    }
    Ok(())
}

fn nonce() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("frost-{}-{nanos}", std::process::id())
}

/// Показывает «Слушает …» в профиле Discord. `activity` собирает интерфейс.
#[tauri::command]
pub async fn discord_set(app: AppHandle, client_id: String, activity: serde_json::Value) -> AppResult<()> {
    if client_id.is_empty() || !client_id.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::msg("Нужен числовой Application ID из Discord Developer Portal"));
    }
    tauri::async_runtime::spawn_blocking(move || -> AppResult<()> {
        let state = app.state::<Discord>();
        let mut guard = state.0.lock().map_err(|_| AppError::msg("Discord занят"))?;
        let reconnect = guard.as_ref().map(|c| c.client_id != client_id).unwrap_or(true);
        if reconnect {
            *guard = None;
            let pipe = connect(&client_id)?;
            *guard = Some(DiscordConn { pipe, client_id: client_id.clone() });
        }
        let payload = json!({
            "cmd": "SET_ACTIVITY",
            "args": { "pid": std::process::id(), "activity": activity },
            "nonce": nonce(),
        });
        let result = match guard.as_mut() {
            Some(conn) => send_command(&mut conn.pipe, &payload),
            None => Err(io::Error::new(io::ErrorKind::NotConnected, "нет подключения")),
        };
        if let Err(e) = result {
            // Discord перезапустили или закрыли: переподключимся при следующем треке
            *guard = None;
            return Err(AppError::msg(format!("Discord: {e}")));
        }
        Ok(())
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()))?
}

/// Убирает статус: закрытие канала Discord воспринимает как «ничего не играет».
#[tauri::command]
pub fn discord_clear(state: State<'_, Discord>) {
    if let Ok(mut guard) = state.0.lock() {
        *guard = None;
    }
}

// ---------------------------------------------------------------------------
// Служебное
// ---------------------------------------------------------------------------

/// Аргументы запуска: автозапуск передаёт `--autostart`, тогда Frost стартует в трее.
#[tauri::command]
pub fn startup_args() -> Vec<String> {
    std::env::args().skip(1).collect()
}

/// Полный выход (из меню трея, когда окно только спрятано).
#[tauri::command]
pub fn app_quit(app: AppHandle) {
    app.exit(0);
}

// ---------------------------------------------------------------------------
// Мини-плеер
// ---------------------------------------------------------------------------

pub const MINI_LABEL: &str = "mini";

/// Открывает мини-плеер или показывает уже открытый.
///
/// Почему окно создаётся здесь, а не через `new WebviewWindow(...)` в JS: все окна WebView2
/// с общей папкой данных обязаны запускаться с одинаковыми `additionalBrowserArgs`.
/// JS API не умеет их передавать, поэтому мини-окно получало аргументы по умолчанию,
/// WebView2 отказывался создавать его браузер, и пустое белое окно тут же закрывалось.
/// Здесь берётся конфигурация главного окна целиком (аргументы браузера, эффекты фона,
/// запрет перетаскивания файлов) и меняется только то, чем мини-плеер отличается.
///
/// Команда асинхронная: на Windows создание окна из синхронной команды блокирует цикл событий.
#[tauri::command]
pub async fn mini_open(app: AppHandle) -> AppResult<()> {
    if let Some(mini) = app.get_webview_window(MINI_LABEL) {
        let _ = mini.unminimize();
        let _ = mini.show();
        let _ = mini.set_focus();
        return Ok(());
    }
    let mut cfg = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .cloned()
        .unwrap_or_default();
    cfg.label = MINI_LABEL.to_string();
    cfg.url = tauri::WebviewUrl::App("index.html#mini".into());
    cfg.title = "Frost".to_string();
    cfg.width = 380.0;
    cfg.height = 116.0;
    cfg.min_width = Some(320.0);
    cfg.min_height = Some(116.0);
    cfg.max_width = None;
    cfg.max_height = None;
    cfg.x = None;
    cfg.y = None;
    cfg.center = true;
    cfg.resizable = false;
    cfg.maximizable = false;
    cfg.maximized = false;
    cfg.fullscreen = false;
    cfg.decorations = false;
    cfg.transparent = true;
    cfg.shadow = true;
    cfg.always_on_top = true;
    cfg.skip_taskbar = false;
    cfg.visible = true;
    cfg.focus = true;

    let window = tauri::WebviewWindowBuilder::from_config(&app, &cfg)
        .map_err(|e| AppError::msg(format!("Мини-плеер: неверная конфигурация окна: {e}")))?
        .build()
        .map_err(|e| AppError::msg(format!("Не удалось открыть мини-плеер: {e}")))?;
    // Размер мог восстановиться из прошлых неудачных запусков: возвращаем расчётный.
    let _ = window.set_size(tauri::LogicalSize::new(380.0, 116.0));
    let _ = window.set_focus();
    Ok(())
}

/// Закрывает мини-плеер, если он открыт.
#[tauri::command]
pub fn mini_close(app: AppHandle) {
    if let Some(mini) = app.get_webview_window(MINI_LABEL) {
        let _ = mini.close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audio_extensions() {
        assert!(is_audio(Path::new("C:/Music/a.MP3")));
        assert!(is_audio(Path::new("song.flac")));
        assert!(!is_audio(Path::new("cover.jpg")));
        assert!(!is_audio(Path::new("noext")));
    }

    #[test]
    fn folder_covers() {
        assert_eq!(cover_rank(Path::new("D:/Music/Album/Cover.JPG")), Some(0));
        assert_eq!(cover_rank(Path::new("folder.png")), Some(1));
        assert_eq!(cover_rank(Path::new("scan.jpg")), None);
        assert_eq!(cover_rank(Path::new("cover.txt")), None);
    }

    #[test]
    fn backup_only_json() {
        assert!(backup_write("C:/tmp/frost.txt".into(), "{}".into()).is_err());
    }
}
