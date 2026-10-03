//! yt-dlp (https://github.com/yt-dlp/yt-dlp) как второй движок YouTube.
//!
//! * по умолчанию («Авто») подключается, только если RustyPipe не смог отдать поток;
//! * ставится одной кнопкой в настройках (официальный `yt-dlp.exe` с GitHub) в папку
//!   данных приложения, обновляется командой `yt-dlp -U`;
//! * для полной поддержки YouTube yt-dlp нужен JS-движок: Deno ставится так же одной
//!   кнопкой (без него yt-dlp работает с ограниченным набором клиентов).
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use crate::config::NetMode;
use crate::error::{truncate, AppError, AppResult};
use crate::models::{Provider, StreamKind, StreamSource, Track};
use crate::net::ensure_ok;
use crate::state::AppState;
use crate::ytaudio::Direct;

const YTDLP_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
const DENO_URL: &str =
    "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YtdlpStatus {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub deno: bool,
    /// Установлен самим Frost (в папку данных), можно обновлять кнопкой.
    pub managed: bool,
    /// Собран ли Frost с RustyPipe.
    pub rustypipe: bool,
    /// Установлен ли rustypipe-botguard (PO-токены для RustyPipe).
    pub botguard: bool,
}

fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

pub fn bin_dir(st: &AppState) -> Option<PathBuf> {
    st.data_dir().map(|dir| dir.join("bin"))
}

fn in_path(name: &str) -> Option<PathBuf> {
    let paths = std::env::var_os("PATH")?;
    std::env::split_paths(&paths)
        .map(|dir| dir.join(exe(name)))
        .find(|path| path.is_file())
}

pub fn find_ytdlp(st: &AppState) -> Option<PathBuf> {
    let cfg = st.config();
    let custom = cfg.ytdlp_path.trim();
    if !custom.is_empty() {
        let path = PathBuf::from(custom);
        if path.is_file() {
            return Some(path);
        }
    }
    if let Some(dir) = bin_dir(st) {
        let path = dir.join(exe("yt-dlp"));
        if path.is_file() {
            return Some(path);
        }
    }
    in_path("yt-dlp")
}

/// rustypipe-botguard: решает проверку YouTube и выдаёт PO-токены для RustyPipe.
/// Ищется только в папке Frost: RustyPipe берёт его оттуда же.
pub fn find_botguard(st: &AppState) -> Option<PathBuf> {
    bin_dir(st)
        .map(|dir| dir.join(exe("rustypipe-botguard")))
        .filter(|path| path.is_file())
}

pub fn find_deno(st: &AppState) -> Option<PathBuf> {
    if let Some(dir) = bin_dir(st) {
        let path = dir.join(exe("deno"));
        if path.is_file() {
            return Some(path);
        }
    }
    in_path("deno")
}

pub(crate) fn command(path: &Path) -> tokio::process::Command {
    let mut std_cmd = std::process::Command::new(path);
    std_cmd
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1");
    hide_console(&mut std_cmd);
    let mut cmd = tokio::process::Command::from(std_cmd);
    cmd.kill_on_drop(true);
    cmd
}

/// CREATE_NO_WINDOW: без мигающего окна консоли.
pub(crate) fn hide_console(cmd: &mut std::process::Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}

pub(crate) async fn run(path: &Path, args: &[String], secs: u64) -> AppResult<Vec<u8>> {
    let mut cmd = command(path);
    cmd.args(args);
    let output = tokio::time::timeout(Duration::from_secs(secs), cmd.output())
        .await
        .map_err(|_| AppError::msg("yt-dlp не ответил вовремя"))?
        .map_err(|err| AppError::msg(format!("Не удалось запустить yt-dlp: {err}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let line = stderr
            .lines()
            .rev()
            .find(|l| l.contains("ERROR"))
            .or_else(|| stderr.lines().last())
            .unwrap_or("неизвестная ошибка")
            .trim()
            .to_string();
        return Err(AppError::msg(truncate(format!("yt-dlp: {line}"), 300)));
    }
    Ok(output.stdout)
}

/// Общие аргументы: не читать чужой конфиг, прокси как у Frost, JS-движок.
pub(crate) fn base_args(st: &AppState) -> Vec<String> {
    let cfg = st.config();
    let mut args = vec!["--ignore-config".to_string()];
    match cfg.net_mode {
        NetMode::Custom if !cfg.proxy_url.trim().is_empty() => {
            args.push("--proxy".into());
            args.push(cfg.proxy_url.trim().to_string());
        }
        NetMode::Direct => {
            args.push("--proxy".into());
            args.push(String::new());
        }
        _ => {}
    }
    if let Some(deno) = find_deno(st) {
        args.push("--js-runtimes".into());
        args.push(format!("deno:{}", deno.display()));
    }
    args
}

fn not_installed() -> AppError {
    AppError::msg("yt-dlp не установлен. Установите его в Настройки → Источники")
}

/// Прямая ссылка на аудио + заголовки, которые yt-dlp требует для скачивания.
pub async fn stream(st: &AppState, id: &str) -> AppResult<StreamSource> {
    let path = find_ytdlp(st).ok_or_else(not_installed)?;
    let mut args = base_args(st);
    args.extend(
        [
            "-J",
            "--no-playlist",
            "--no-warnings",
            "--no-progress",
            "-f",
            "bestaudio[acodec=opus]/bestaudio[ext=m4a]/bestaudio/best",
        ]
        .map(String::from),
    );
    args.push(format!("https://music.youtube.com/watch?v={id}"));
    let out = run(&path, &args, 60).await?;
    let json: Value = serde_json::from_slice(&out)?;
    parse_stream(&json).ok_or_else(|| AppError::msg("yt-dlp не вернул ссылку на аудио"))
}

/// Ссылка на файл конкретного формата с размером: для полной загрузки (`ytaudio`).
/// `itag`: продолжаем уже начатый файл, поэтому нужен именно этот формат.
pub async fn direct(st: &AppState, id: &str, itag: Option<u32>) -> AppResult<Direct> {
    let path = find_ytdlp(st).ok_or_else(not_installed)?;
    let mut args = base_args(st);
    args.extend(["-J", "--no-playlist", "--no-warnings", "--no-progress", "-f"].map(String::from));
    args.push(match itag {
        Some(itag) => itag.to_string(),
        None => crate::ytaudio::YTDLP_FORMAT.to_string(),
    });
    args.push(format!("https://music.youtube.com/watch?v={id}"));
    let out = run(&path, &args, 60).await?;
    let json: Value = serde_json::from_slice(&out)?;
    let pick = if json.get("url").and_then(Value::as_str).is_some() {
        &json
    } else {
        json.get("requested_formats")
            .and_then(Value::as_array)
            .and_then(|formats| {
                formats
                    .iter()
                    .find(|f| f.get("vcodec").and_then(Value::as_str) == Some("none"))
                    .or_else(|| formats.first())
            })
            .ok_or_else(|| AppError::msg("yt-dlp не вернул ссылку на аудио"))?
    };
    let source = parse_stream(&json).ok_or_else(|| AppError::msg("yt-dlp не вернул ссылку на аудио"))?;
    if matches!(source.kind, StreamKind::Hls) {
        return Err(AppError::msg("yt-dlp отдал только HLS"));
    }
    let format_id = pick.get("format_id").and_then(Value::as_str).unwrap_or("").to_string();
    let ext = pick.get("ext").and_then(Value::as_str).unwrap_or("webm");
    let size = pick
        .get("filesize")
        .and_then(Value::as_u64)
        .or_else(|| {
            // clen в ссылке googlevideo: точный размер файла.
            source
                .url
                .split(['?', '&'])
                .find_map(|kv| kv.strip_prefix("clen="))
                .and_then(|v| v.parse::<u64>().ok())
        });
    let abr = pick.get("abr").and_then(Value::as_f64).unwrap_or(0.0);
    Ok(Direct {
        url: source.url,
        headers: source.headers,
        itag: format_id.split(['-', '+']).next().and_then(|v| v.parse::<u32>().ok()),
        size,
        mime: crate::ytaudio::mime_for_ext(ext).to_string(),
        bitrate: (abr * 1000.0) as u32,
        via: format!("yt-dlp ({format_id})"),
    })
}

fn parse_stream(json: &Value) -> Option<StreamSource> {
    let pick = if json.get("url").and_then(Value::as_str).is_some() {
        json
    } else {
        let formats = json.get("requested_formats").and_then(Value::as_array)?;
        formats
            .iter()
            .find(|f| f.get("vcodec").and_then(Value::as_str) == Some("none"))
            .or_else(|| formats.first())?
    };
    let url = pick.get("url")?.as_str()?.to_string();
    let protocol = pick
        .get("protocol")
        .and_then(Value::as_str)
        .unwrap_or("https")
        .to_string();
    let headers: Vec<(String, String)> = pick
        .get("http_headers")
        .or_else(|| json.get("http_headers"))
        .and_then(Value::as_object)
        .map(|map| {
            map.iter()
                .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                .filter(|(k, _)| !k.eq_ignore_ascii_case("accept-encoding"))
                .collect()
        })
        .unwrap_or_default();
    Some(StreamSource {
        url,
        kind: if protocol.contains("m3u8") {
            StreamKind::Hls
        } else {
            StreamKind::Progressive
        },
        preview: false,
        headers,
    })
}

/// Поиск через yt-dlp (запасной путь, если RustyPipe недоступен).
pub async fn search(st: &AppState, query: &str) -> AppResult<Vec<Track>> {
    let path = find_ytdlp(st).ok_or_else(not_installed)?;
    let mut args = base_args(st);
    args.extend(["-J", "--flat-playlist", "--no-warnings"].map(String::from));
    args.push(format!("ytsearch20:{query}"));
    let out = run(&path, &args, 45).await?;
    let json: Value = serde_json::from_slice(&out)?;
    Ok(json
        .get("entries")
        .and_then(Value::as_array)
        .map(|list| list.iter().filter_map(map_entry).collect())
        .unwrap_or_default())
}

fn map_entry(entry: &Value) -> Option<Track> {
    let id = entry.get("id")?.as_str()?.to_string();
    let title = entry
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let artist = entry
        .get("channel")
        .or_else(|| entry.get("uploader"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim_end_matches(" - Topic")
        .to_string();
    let artwork = entry
        .get("thumbnails")
        .and_then(Value::as_array)
        .and_then(|list| list.last())
        .and_then(|t| t.get("url"))
        .and_then(Value::as_str)
        .map(|s| s.to_string())
        .or_else(|| Some(format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg")));
    Some(Track {
        id: id.clone(),
        provider: Provider::Youtube,
        title,
        artist,
        artist_id: entry
            .get("channel_id")
            .and_then(Value::as_str)
            .map(|s| s.to_string()),
        album: None,
        album_id: None,
        artwork: artwork.clone(),
        artwork_small: artwork,
        duration: entry.get("duration").and_then(Value::as_f64).unwrap_or(0.0),
        permalink: Some(format!("https://music.youtube.com/watch?v={id}")),
        genre: None,
        plays: entry.get("view_count").and_then(Value::as_u64),
        likes: None,
        streamable: true,
        preview_only: false,
    })
}

pub async fn status(st: &AppState) -> YtdlpStatus {
    let path = find_ytdlp(st);
    let version = match &path {
        Some(p) => run(p, &["--version".to_string()], 20)
            .await
            .ok()
            .map(|out| String::from_utf8_lossy(&out).trim().to_string()),
        None => None,
    };
    let managed = path
        .as_ref()
        .zip(bin_dir(st))
        .map(|(p, dir)| p.starts_with(&dir))
        .unwrap_or(false);
    YtdlpStatus {
        installed: path.is_some(),
        path: path.map(|p| p.display().to_string()),
        version,
        deno: find_deno(st).is_some(),
        managed,
        rustypipe: st.youtube.compiled(),
        botguard: find_botguard(st).is_some(),
    }
}

async fn download(st: &AppState, url: &str, dest: &Path) -> AppResult<()> {
    if let Some(dir) = dest.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let resp = st
        .http()
        .get(url)
        .timeout(Duration::from_secs(600))
        .send()
        .await?;
    let bytes = ensure_ok(resp).await?.bytes().await?;
    if bytes.len() < 64 * 1024 {
        return Err(AppError::msg("Загрузка оборвалась, попробуйте ещё раз"));
    }
    let tmp = dest.with_extension("download");
    std::fs::write(&tmp, &bytes)?;
    std::fs::rename(&tmp, dest)?;
    Ok(())
}

/// Скачивает официальный yt-dlp.exe в папку данных Frost.
pub async fn install(st: &AppState) -> AppResult<YtdlpStatus> {
    let dir = bin_dir(st).ok_or_else(|| AppError::msg("Папка данных недоступна"))?;
    download(st, YTDLP_URL, &dir.join(exe("yt-dlp"))).await?;
    Ok(status(st).await)
}

/// `yt-dlp -U` (для версии из PATH может не сработать: тогда обновите тем же способом, каким ставили).
pub async fn update(st: &AppState) -> AppResult<YtdlpStatus> {
    let path = find_ytdlp(st).ok_or_else(not_installed)?;
    run(&path, &["-U".to_string()], 180).await?;
    Ok(status(st).await)
}

/// Распаковывает zip встроенным PowerShell (есть в любой Windows 10/11).
async fn expand_zip(zip: &Path, dest: &Path) -> AppResult<()> {
    let quote = |p: &Path| p.display().to_string().replace('\'', "''");
    let script = format!(
        "Expand-Archive -LiteralPath '{}' -DestinationPath '{}' -Force",
        quote(zip),
        quote(dest)
    );
    let mut std_cmd = std::process::Command::new("powershell");
    std_cmd
        .args(["-NoProfile", "-NonInteractive", "-Command", script.as_str()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    hide_console(&mut std_cmd);
    let mut cmd = tokio::process::Command::from(std_cmd);
    cmd.kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(180), cmd.output())
        .await
        .map_err(|_| AppError::msg("Распаковка заняла слишком много времени"))?
        .map_err(|err| AppError::msg(format!("Не удалось распаковать архив: {err}")))?;
    if !output.status.success() {
        return Err(AppError::msg("Не удалось распаковать архив"));
    }
    Ok(())
}

fn find_file(dir: &Path, name: &str, depth: u8) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut dirs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            dirs.push(path);
        } else if entry.file_name().to_string_lossy().eq_ignore_ascii_case(name) {
            return Some(path);
        }
    }
    if depth == 0 {
        return None;
    }
    dirs.into_iter().find_map(|d| find_file(&d, name, depth - 1))
}

const BOTGUARD_API: &str = "https://codeberg.org/api/v1/repos/ThetaDev/rustypipe-botguard/releases/latest";
const BOTGUARD_FALLBACK: &str = "https://codeberg.org/ThetaDev/rustypipe-botguard/releases/download/v0.1.2/rustypipe-botguard-v0.1.2-x86_64-pc-windows-msvc.zip";

/// Ставит rustypipe-botguard (официальный помощник RustyPipe, Codeberg) в папку Frost.
/// После этого RustyPipe получает PO-токены и YouTube отдаёт ему файлы целиком.
pub async fn install_botguard(st: &AppState) -> AppResult<YtdlpStatus> {
    if !cfg!(windows) {
        return Err(AppError::msg("Установка кнопкой есть только для Windows"));
    }
    let dir = bin_dir(st).ok_or_else(|| AppError::msg("Папка данных недоступна"))?;
    std::fs::create_dir_all(&dir)?;
    // Адрес последней версии; если Codeberg API недоступен, проверенная v0.1.2.
    let mut url = BOTGUARD_FALLBACK.to_string();
    if let Ok(resp) = st.http().get(BOTGUARD_API).timeout(Duration::from_secs(20)).send().await {
        if let Ok(json) = resp.json::<Value>().await {
            let asset = json
                .get("assets")
                .and_then(Value::as_array)
                .and_then(|list| {
                    list.iter().find(|a| {
                        a.get("name")
                            .and_then(Value::as_str)
                            .map(|n| n.contains("x86_64-pc-windows") && n.ends_with(".zip"))
                            .unwrap_or(false)
                    })
                })
                .and_then(|a| a.get("browser_download_url"))
                .and_then(Value::as_str);
            if let Some(found) = asset {
                url = found.to_string();
            }
        }
    }
    let zip = dir.join("botguard.zip");
    let tmp = dir.join("botguard-unpack");
    let _ = std::fs::remove_dir_all(&tmp);
    download(st, &url, &zip).await?;
    let unpacked = expand_zip(&zip, &tmp).await;
    let _ = std::fs::remove_file(&zip);
    unpacked?;
    let found = find_file(&tmp, &exe("rustypipe-botguard"), 3)
        .ok_or_else(|| AppError::msg("В архиве нет rustypipe-botguard.exe"))?;
    let dest = dir.join(exe("rustypipe-botguard"));
    let _ = std::fs::remove_file(&dest);
    std::fs::rename(&found, &dest).or_else(|_| std::fs::copy(&found, &dest).map(|_| ()))?;
    let _ = std::fs::remove_dir_all(&tmp);
    // RustyPipe подхватывает помощника при пересборке клиента.
    st.youtube.rebuild(&st.config());
    Ok(status(st).await)
}

pub fn remove_botguard(st: &AppState) {
    if let Some(path) = find_botguard(st) {
        let _ = std::fs::remove_file(path);
        st.youtube.rebuild(&st.config());
    }
}

/// Скачивает Deno (JS-движок для yt-dlp) и распаковывает встроенным PowerShell.
pub async fn install_deno(st: &AppState) -> AppResult<YtdlpStatus> {
    let dir = bin_dir(st).ok_or_else(|| AppError::msg("Папка данных недоступна"))?;
    let zip = dir.join("deno.zip");
    download(st, DENO_URL, &zip).await?;
    let unpacked = expand_zip(&zip, &dir).await;
    let _ = std::fs::remove_file(&zip);
    unpacked.map_err(|_| AppError::msg("Не удалось распаковать Deno"))?;
    Ok(status(st).await)
}
