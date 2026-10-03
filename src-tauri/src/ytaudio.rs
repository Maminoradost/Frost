//! Звук YouTube целиком: загрузка, кэш на диске и раздача плееру через `frost://`.
//!
//! Почему не прямой прокси по кусочкам, как в 0.9.0. Без PO-токена YouTube отдаёт
//! первую порцию файла (у прокси это были 384 КБ, около 20 секунд звука), а следующие
//! запросы отклоняет или режет скорость до реального времени. Трек начинал заикаться
//! и замолкал на 20-й секунде.
//!
//! Теперь каждый трек скачивается целиком, одним последовательным потоком байтов.
//! Его могут продолжать разные источники: ссылка RustyPipe, загрузка самим yt-dlp,
//! ссылка yt-dlp. Файл одного формата (itag + размер) у всех клиентов YouTube
//! побайтно одинаковый, поэтому источник можно сменить посреди загрузки, а плеер
//! этого не заметит: он читает из буфера в памяти. Готовый файл кладётся в кэш, и
//! повторное прослушивание вообще не трогает сеть.
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

use http::{header, Response, StatusCode};
use serde::Serialize;
use tauri::{AppHandle, Manager};
use tokio::sync::watch;

use crate::config::YtEngine;
use crate::error::{AppError, AppResult};
use crate::providers::ytdlp;
use crate::state::AppState;

/// Размер одного запроса к googlevideo. Как у yt-dlp: крупнее YouTube режет скорость.
const HTTP_CHUNK: u64 = 10 * 1024 * 1024;
/// Сколько ждать следующих байтов, прежде чем счесть загрузку вставшей.
const STALL: Duration = Duration::from_secs(12);
/// Порция ответа плееру из памяти и из файла.
const SERVE_CHUNK: u64 = 2 * 1024 * 1024;
const FILE_CHUNK: u64 = 4 * 1024 * 1024;
/// Сколько плеер ждёт нужные байты.
const SERVE_WAIT: Duration = Duration::from_secs(45);
/// Сколько `open` ждёт первые байты, прежде чем вернуть ошибку.
const OPEN_WAIT: Duration = Duration::from_secs(50);
/// Источник, отставший от другого больше чем на столько, останавливается.
const LAG_LIMIT: u64 = 2 * 1024 * 1024;
/// Максимум адресов `a/{n}` в памяти (каждый держит буфер трека, пока не сохранён файл).
const MAX_TOKENS: usize = 12;
/// Формат по умолчанию для yt-dlp (как в `ytdlp::stream`).
pub const YTDLP_FORMAT: &str = "bestaudio[acodec=opus]/bestaudio[ext=m4a]/bestaudio/best";

/// Ссылка на файл одного формата (как её отдал RustyPipe или yt-dlp).
#[derive(Debug, Clone)]
pub struct Direct {
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub itag: Option<u32>,
    pub size: Option<u64>,
    pub mime: String,
    /// Битрейт, бит/с (0, если неизвестен).
    pub bitrate: u32,
    /// Кто дал ссылку: «RustyPipe (Tv)», «yt-dlp (251)».
    pub via: String,
}

#[derive(Debug, Clone, Default)]
struct Progress {
    have: u64,
    total: Option<u64>,
    done: bool,
    failed: bool,
}

#[derive(Debug, Default)]
struct Meta {
    itag: Option<u32>,
    mime: String,
    /// Номер «личности» файла: меняется, если до первых байтов сменился формат.
    version: u64,
    error: Option<String>,
    log: Vec<String>,
    file: Option<PathBuf>,
}

/// Загрузка одного трека.
pub struct Job {
    pub id: String,
    data: Mutex<Vec<u8>>,
    meta: Mutex<Meta>,
    tx: watch::Sender<Progress>,
    ytdlp_started: AtomicBool,
    ytdlp_task: Mutex<Option<tauri::async_runtime::JoinHandle<Result<(), String>>>>,
}

enum Offer {
    Took,
    Behind,
    Rejected,
}

impl Job {
    fn new(id: &str) -> Arc<Self> {
        let (tx, _rx) = watch::channel(Progress::default());
        Arc::new(Self {
            id: id.to_string(),
            data: Mutex::new(Vec::new()),
            meta: Mutex::new(Meta::default()),
            tx,
            ytdlp_started: AtomicBool::new(false),
            ytdlp_task: Mutex::new(None),
        })
    }

    fn progress(&self) -> Progress {
        self.tx.borrow().clone()
    }

    pub fn have(&self) -> u64 {
        self.tx.borrow().have
    }

    fn total(&self) -> Option<u64> {
        self.tx.borrow().total
    }

    fn itag(&self) -> Option<u32> {
        self.meta.lock().unwrap().itag
    }

    fn mime(&self) -> String {
        let mime = self.meta.lock().unwrap().mime.clone();
        if mime.is_empty() {
            "audio/webm".to_string()
        } else {
            mime
        }
    }

    fn complete(&self) -> bool {
        let p = self.tx.borrow();
        matches!(p.total, Some(total) if total > 0 && p.have >= total)
    }

    fn failed(&self) -> bool {
        self.tx.borrow().failed
    }

    fn error(&self) -> String {
        self.meta
            .lock()
            .unwrap()
            .error
            .clone()
            .unwrap_or_else(|| "Загрузка звука YouTube не удалась".to_string())
    }

    fn note(&self, line: String) {
        let mut meta = self.meta.lock().unwrap();
        if meta.log.len() < 24 {
            meta.log.push(line);
        }
    }

    fn log(&self) -> Vec<String> {
        self.meta.lock().unwrap().log.clone()
    }

    /// Источник сообщает формат. Пока не получено ни байта, формат можно сменить;
    /// дальше годятся только источники того же файла. Возвращает номер версии.
    fn adopt(&self, itag: Option<u32>, total: Option<u64>, mime: &str) -> Result<u64, String> {
        let have = self.have();
        let total = total.filter(|t| *t > 0);
        let mut meta = self.meta.lock().unwrap();
        let current_total = self.total();
        if have == 0 {
            meta.version += 1;
            meta.itag = itag;
            if !mime.is_empty() {
                meta.mime = mime.to_string();
            }
            let version = meta.version;
            drop(meta);
            if let Some(t) = total {
                let mut data = self.data.lock().unwrap();
                let want = t.min(64 * 1024 * 1024) as usize;
                // Длину читаем заранее: у MutexGuard нет «двухфазного» заимствования,
                // поэтому `data.reserve(want - data.len())` не проходит borrowck.
                let len = data.len();
                if data.capacity() < want {
                    data.reserve(want.saturating_sub(len));
                }
            }
            self.tx.send_modify(|p| p.total = total);
            return Ok(version);
        }
        let same_itag = match (meta.itag, itag) {
            (Some(a), Some(b)) => a == b,
            _ => true,
        };
        let same_size = match (current_total, total) {
            (Some(a), Some(b)) => a == b,
            _ => true,
        };
        if !(same_itag && same_size) {
            return Err(format!(
                "другой файл (формат {:?}, размер {:?}; нужен {:?}, {:?})",
                itag, total, meta.itag, current_total
            ));
        }
        if meta.itag.is_none() {
            meta.itag = itag;
        }
        let version = meta.version;
        drop(meta);
        if current_total.is_none() && total.is_some() {
            self.tx.send_modify(|p| p.total = total);
        }
        Ok(version)
    }

    /// Принимает байты источника, начиная с позиции `pos`.
    fn offer(&self, version: u64, pos: u64, bytes: &[u8]) -> Offer {
        if bytes.is_empty() {
            return Offer::Behind;
        }
        if self.meta.lock().unwrap().version != version {
            return Offer::Rejected;
        }
        let have = {
            let mut data = self.data.lock().unwrap();
            let have = data.len() as u64;
            let end = pos + bytes.len() as u64;
            if pos > have {
                return Offer::Rejected;
            }
            if end <= have {
                return Offer::Behind;
            }
            let skip = (have - pos) as usize;
            let room = match self.total() {
                Some(total) => (total.saturating_sub(have)) as usize,
                None => usize::MAX,
            };
            let take = &bytes[skip..];
            let take = &take[..take.len().min(room)];
            data.extend_from_slice(take);
            data.len() as u64
        };
        self.tx.send_modify(|p| p.have = have);
        Offer::Took
    }

    fn slice(&self, start: u64, len: u64) -> Vec<u8> {
        let data = self.data.lock().unwrap();
        let s = (start as usize).min(data.len());
        let e = (start.saturating_add(len) as usize).min(data.len());
        if s >= e {
            return Vec::new();
        }
        data[s..e].to_vec()
    }

    fn fail(&self, message: String) {
        self.meta.lock().unwrap().error = Some(message);
        self.tx.send_modify(|p| p.failed = true);
    }

    fn finish(&self) {
        self.tx.send_modify(|p| {
            if p.total.is_none() {
                p.total = Some(p.have);
            }
            p.done = true;
        });
    }

    /// Ждёт, пока появятся байты после `start` (или загрузка закончится).
    async fn wait_for(&self, start: u64, limit: Duration) -> Result<(), String> {
        let mut rx = self.tx.subscribe();
        let until = Instant::now() + limit;
        loop {
            let ready = {
                let p = rx.borrow_and_update();
                if p.failed && p.have <= start {
                    Some(Err(()))
                } else if (p.have > start && (p.total.is_some() || p.failed)) || p.done {
                    Some(Ok(()))
                } else {
                    None
                }
            };
            match ready {
                Some(Ok(())) => return Ok(()),
                Some(Err(())) => return Err(self.error()),
                None => {}
            }
            let left = until.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Err("Звук YouTube не успел загрузиться".to_string());
            }
            match tokio::time::timeout(left, rx.changed()).await {
                Ok(Ok(())) => {}
                Ok(Err(_)) => return Err(self.error()),
                Err(_) => return Err("Звук YouTube не успел загрузиться".to_string()),
            }
        }
    }
}

enum Target {
    Job(Arc<Job>),
    File { path: PathBuf, mime: String },
}

#[derive(Default)]
struct Health {
    /// Сколько раз подряд прямая загрузка RustyPipe обрывалась в этом сеансе.
    rustypipe_breaks: u32,
    /// Клиент RustyPipe, который последним скачал трек целиком.
    good_client: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheInfo {
    pub files: u32,
    pub bytes: u64,
    pub limit_mb: u32,
    pub enabled: bool,
    pub path: Option<String>,
}

/// Хранилище загрузок и кэша (часть `AppState`).
#[derive(Default)]
pub struct AudioStore {
    dir: Mutex<Option<PathBuf>>,
    jobs: Mutex<HashMap<String, Arc<Job>>>,
    tokens: Mutex<(u64, HashMap<u64, Target>, VecDeque<u64>)>,
    health: Mutex<Health>,
    counter: AtomicU64,
}

impl AudioStore {
    /// Папка кэша (`%LOCALAPPDATA%\app.frost.player\audio`). Недокачанные файлы удаляются.
    pub fn init(&self, dir: PathBuf) {
        let _ = std::fs::create_dir_all(&dir);
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.contains(".ytdlp.") || name.ends_with(".tmp") {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
        *self.dir.lock().unwrap() = Some(dir);
    }

    pub fn dir(&self) -> Option<PathBuf> {
        self.dir.lock().unwrap().clone()
    }

    fn register(&self, target: Target) -> String {
        let mut guard = self.tokens.lock().unwrap();
        let (next, map, order) = &mut *guard;
        *next += 1;
        let token = *next;
        map.insert(token, target);
        order.push_back(token);
        while order.len() > MAX_TOKENS {
            if let Some(old) = order.pop_front() {
                map.remove(&old);
            }
        }
        format!("{}a/{}", crate::stream::base_url(), token)
    }

    fn target(&self, token: u64) -> Option<(Option<Arc<Job>>, Option<(PathBuf, String)>)> {
        let guard = self.tokens.lock().unwrap();
        match guard.1.get(&token)? {
            Target::Job(job) => Some((Some(job.clone()), None)),
            Target::File { path, mime } => Some((None, Some((path.clone(), mime.clone())))),
        }
    }

    /// Задание сохранило файл: адреса, которые на него смотрели, переходят на файл (память освобождается).
    fn job_saved(&self, job: &Arc<Job>, path: &Path, mime: &str) {
        let mut guard = self.tokens.lock().unwrap();
        for target in guard.1.values_mut() {
            let same = matches!(target, Target::Job(j) if Arc::ptr_eq(j, job));
            if same {
                *target = Target::File {
                    path: path.to_path_buf(),
                    mime: mime.to_string(),
                };
            }
        }
    }

    fn job(&self, id: &str) -> Option<Arc<Job>> {
        self.jobs.lock().unwrap().get(id).cloned()
    }

    fn rustypipe_unreliable(&self) -> bool {
        self.health.lock().unwrap().rustypipe_breaks > 0
    }

    fn note_rustypipe(&self, ok: bool, client: Option<String>) {
        let mut h = self.health.lock().unwrap();
        if ok {
            h.rustypipe_breaks = 0;
            if client.is_some() {
                h.good_client = client;
            }
        } else {
            h.rustypipe_breaks += 1;
        }
    }

    fn good_client(&self) -> Option<String> {
        self.health.lock().unwrap().good_client.clone()
    }

    /// Готовый файл трека в кэше: `{id}-{itag}.{ext}`.
    pub fn cached(&self, id: &str) -> Option<(PathBuf, String)> {
        let dir = self.dir()?;
        let prefix = format!("{id}-");
        let entries = std::fs::read_dir(&dir).ok()?;
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with(&prefix) || name.contains(".ytdlp.") || name.ends_with(".tmp") {
                continue;
            }
            let path = entry.path();
            let len = entry.metadata().map(|m| m.len()).unwrap_or(0);
            if len < 16 * 1024 {
                let _ = std::fs::remove_file(&path);
                continue;
            }
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_string();
            touch(&path);
            return Some((path, mime_for_ext(&ext).to_string()));
        }
        None
    }

    pub fn info(&self, st: &AppState) -> CacheInfo {
        let cfg = st.config();
        let (files, bytes) = self
            .dir()
            .map(|dir| {
                list_cache(&dir)
                    .iter()
                    .fold((0u32, 0u64), |(n, b), (_, len, _)| (n + 1, b + len))
            })
            .unwrap_or((0, 0));
        CacheInfo {
            files,
            bytes,
            limit_mb: cfg.audio_cache_mb,
            enabled: cfg.audio_cache,
            path: self.dir().map(|d| d.display().to_string()),
        }
    }

    pub fn clear(&self) {
        if let Some(dir) = self.dir() {
            for (path, _, _) in list_cache(&dir) {
                let _ = std::fs::remove_file(path);
            }
        }
    }

    /// Удаляет давно слушанные треки, пока кэш больше лимита.
    fn evict(&self, limit_mb: u32) {
        let Some(dir) = self.dir() else { return };
        let limit = u64::from(limit_mb.max(64)) * 1024 * 1024;
        let mut files = list_cache(&dir);
        let mut total: u64 = files.iter().map(|(_, len, _)| len).sum();
        if total <= limit {
            return;
        }
        files.sort_by_key(|(_, _, modified)| *modified);
        for (path, len, _) in files {
            if total <= limit {
                break;
            }
            if std::fs::remove_file(&path).is_ok() {
                total = total.saturating_sub(len);
            }
        }
    }
}

fn list_cache(dir: &Path) -> Vec<(PathBuf, u64, SystemTime)> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.contains(".ytdlp.") || name.ends_with(".tmp") {
                return None;
            }
            let meta = entry.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
            Some((entry.path(), meta.len(), modified))
        })
        .collect()
}

fn touch(path: &Path) {
    if let Ok(file) = std::fs::OpenOptions::new().write(true).open(path) {
        let _ = file.set_modified(SystemTime::now());
    }
}

pub fn mime_for_ext(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "m4a" | "mp4" | "aac" => "audio/mp4",
        "mp3" => "audio/mpeg",
        "ogg" | "opus" => "audio/ogg",
        _ => "audio/webm",
    }
}

fn ext_for_mime(mime: &str) -> &'static str {
    let m = mime.to_ascii_lowercase();
    if m.contains("mp4") || m.contains("m4a") || m.contains("aac") {
        "m4a"
    } else if m.contains("mpeg") {
        "mp3"
    } else if m.contains("ogg") {
        "ogg"
    } else {
        "webm"
    }
}

fn base_mime(mime: &str) -> String {
    mime.split(';').next().unwrap_or("").trim().to_string()
}

// ---------------------------------------------------------------------------
// Вход: команды и протокол
// ---------------------------------------------------------------------------

/// Адрес для плеера. Из кэша, из уже идущей загрузки или новая загрузка.
/// Ждёт первые байты, чтобы ошибка пришла сюда, а не молча в `<audio>`.
pub async fn open(app: &AppHandle, st: &AppState, id: &str, engine: Option<YtEngine>) -> AppResult<String> {
    if let Some((path, mime)) = st.audio.cached(id) {
        return Ok(st.audio.register(Target::File { path, mime }));
    }
    let job = start(app, st, id, engine);
    let url = st.audio.register(Target::Job(job.clone()));
    match job.wait_for(0, OPEN_WAIT).await {
        Ok(()) => Ok(url),
        Err(err) => {
            if job.failed() {
                st.audio.jobs.lock().unwrap().remove(id);
            }
            Err(AppError::msg(err))
        }
    }
}

/// Заранее скачивает трек (следующий в очереди).
pub fn prefetch(app: &AppHandle, st: &AppState, id: &str) {
    if st.audio.cached(id).is_some() {
        return;
    }
    let _ = start(app, st, id, None);
}

/// Существующее живое задание или новое.
fn start(app: &AppHandle, st: &AppState, id: &str, engine: Option<YtEngine>) -> Arc<Job> {
    let forced = engine.is_some();
    {
        let jobs = st.audio.jobs.lock().unwrap();
        if let Some(job) = jobs.get(id) {
            // Явный выбор движка после ошибки: старое задание не переиспользуем.
            if !job.failed() && !forced {
                return job.clone();
            }
            if !job.failed() && forced && job.have() > 0 {
                return job.clone();
            }
        }
    }
    let job = Job::new(id);
    st.audio.jobs.lock().unwrap().insert(id.to_string(), job.clone());
    st.audio.counter.fetch_add(1, Ordering::Relaxed);
    let engine = engine.unwrap_or(st.config().yt_engine);
    let app = app.clone();
    let task_job = job.clone();
    tauri::async_runtime::spawn(async move {
        drive(app, task_job, engine).await;
    });
    job
}

fn parse_range(value: Option<&str>) -> (u64, Option<u64>) {
    let Some(raw) = value else { return (0, None) };
    let Some(spec) = raw.trim().strip_prefix("bytes=") else {
        return (0, None);
    };
    let first = spec.split(',').next().unwrap_or("");
    let (a, b) = first.split_once('-').unwrap_or((first, ""));
    let start = a.trim().parse::<u64>().unwrap_or(0);
    let end = b.trim().parse::<u64>().ok();
    (start, end)
}

fn partial(mime: &str, start: u64, last: u64, total: u64, body: Vec<u8>) -> Response<Vec<u8>> {
    let builder = Response::builder()
        .status(StatusCode::PARTIAL_CONTENT)
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::CONTENT_LENGTH, body.len().to_string())
        .header(header::CONTENT_RANGE, format!("bytes {start}-{last}/{total}"))
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(
            header::ACCESS_CONTROL_EXPOSE_HEADERS,
            "Content-Length, Content-Range, Accept-Ranges",
        );
    builder.body(body).unwrap_or_else(|_| Response::new(Vec::new()))
}

fn unsatisfiable(total: u64) -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::RANGE_NOT_SATISFIABLE)
        .header(header::CONTENT_RANGE, format!("bytes */{total}"))
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(Vec::new())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

/// Маршрут `a/{n}` протокола `frost://`.
pub async fn serve(st: &AppState, token: &str, range: Option<&str>) -> AppResult<Response<Vec<u8>>> {
    let token = token.split(['?', '/']).next().unwrap_or("").parse::<u64>().unwrap_or(0);
    let (job, file) = st
        .audio
        .target(token)
        .ok_or_else(|| AppError::msg("Поток устарел, включите трек ещё раз"))?;
    let (start, end) = parse_range(range);
    if let Some((path, mime)) = file {
        return serve_file(path, mime, start, end).await;
    }
    let job = job.ok_or_else(|| AppError::msg("Поток не найден"))?;
    // Файл уже сохранён: читаем с диска.
    let saved = job.meta.lock().unwrap().file.clone();
    if let Some(path) = saved.filter(|p| p.is_file()) {
        return serve_file(path, job.mime(), start, end).await;
    }
    job.wait_for(start, SERVE_WAIT).await.map_err(AppError::msg)?;
    let p = job.progress();
    let total = p.total.unwrap_or(p.have);
    if start >= total {
        return Ok(unsatisfiable(total));
    }
    if p.have <= start {
        return Err(AppError::msg("Нет данных"));
    }
    let available_last = p.have - 1;
    let last = end
        .unwrap_or(u64::MAX)
        .min(total - 1)
        .min(start + SERVE_CHUNK - 1)
        .min(available_last);
    let body = job.slice(start, last - start + 1);
    if body.is_empty() {
        return Err(AppError::msg("Нет данных"));
    }
    let last = start + body.len() as u64 - 1;
    Ok(partial(&job.mime(), start, last, total, body))
}

async fn serve_file(path: PathBuf, mime: String, start: u64, end: Option<u64>) -> AppResult<Response<Vec<u8>>> {
    let read = tokio::task::spawn_blocking(move || -> std::io::Result<(u64, u64, Vec<u8>)> {
        let mut file = std::fs::File::open(&path)?;
        let total = file.metadata()?.len();
        if start >= total {
            return Ok((total, 0, Vec::new()));
        }
        let last = end.unwrap_or(u64::MAX).min(total - 1).min(start + FILE_CHUNK - 1);
        file.seek(SeekFrom::Start(start))?;
        let mut buf = vec![0u8; (last - start + 1) as usize];
        file.read_exact(&mut buf)?;
        Ok((total, last, buf))
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()))?
    .map_err(|e| AppError::msg(format!("Файл кэша недоступен: {e}")))?;
    let (total, last, body) = read;
    if body.is_empty() {
        return Ok(unsatisfiable(total));
    }
    Ok(partial(&mime, start, last, total, body))
}

// ---------------------------------------------------------------------------
// Загрузка
// ---------------------------------------------------------------------------

/// Порядок клиентов RustyPipe при повторных попытках (None: порядок самого RustyPipe).
fn rustypipe_attempts(good: Option<String>) -> Vec<Option<String>> {
    let mut list: Vec<Option<String>> = Vec::new();
    if let Some(client) = good {
        list.push(Some(client));
    }
    for item in [None, Some("tv"), Some("ios"), Some("android"), Some("desktop_music")] {
        let item = item.map(String::from);
        if !list.contains(&item) {
            list.push(item);
        }
    }
    list
}

async fn drive(app: AppHandle, job: Arc<Job>, engine: YtEngine) {
    let st = app.state::<AppState>();
    let st: &AppState = st.inner();
    let result = run(&app, st, &job, engine).await;
    match result {
        Ok(()) => save(st, &job).await,
        Err(err) => {
            if job.complete() {
                save(st, &job).await;
            } else {
                job.fail(err);
                // Неудачное задание не держим: следующий `open` начнёт заново.
                let mut jobs = st.audio.jobs.lock().unwrap();
                if jobs.get(&job.id).map(|j| Arc::ptr_eq(j, &job)).unwrap_or(false) {
                    jobs.remove(&job.id);
                }
            }
        }
    }
}

async fn run(app: &AppHandle, st: &AppState, job: &Arc<Job>, engine: YtEngine) -> Result<(), String> {
    let has_ytdlp = engine != YtEngine::Rustypipe && ytdlp::find_ytdlp(st).is_some();
    let has_rustypipe = engine != YtEngine::Ytdlp && st.youtube.compiled();
    if !has_ytdlp && !has_rustypipe {
        return Err(match engine {
            YtEngine::Ytdlp => "yt-dlp не установлен. Установите его в Настройки → YouTube Music".to_string(),
            _ => "Нет движка для звука YouTube: установите yt-dlp в Настройки → YouTube Music".to_string(),
        });
    }
    let mut errors: Vec<String> = Vec::new();

    // Если прямые ссылки уже обрывались в этом сеансе, yt-dlp начинает сразу, параллельно.
    if has_ytdlp && (!has_rustypipe || st.audio.rustypipe_unreliable()) {
        escalate(app, job);
    }

    if has_rustypipe {
        let mut last_error: Option<String> = None;
        for client in rustypipe_attempts(st.audio.good_client()) {
            if job.complete() {
                break;
            }
            // yt-dlp уже качает: дальнейшие клиенты RustyPipe только мешают.
            if job.ytdlp_started.load(Ordering::SeqCst) && last_error.is_some() {
                break;
            }
            let label = client.clone().unwrap_or_else(|| "auto".to_string());
            match st.youtube.audio(job.id.clone(), client.clone(), job.itag()).await {
                Ok(direct) => {
                    let via = direct.via.clone();
                    let outcome = pull_http(st, job, &direct, if has_ytdlp { Some(app) } else { None }).await;
                    match outcome {
                        Ok(()) if job.complete() => {
                            st.audio.note_rustypipe(true, client.clone());
                            job.note(format!("{via}: файл целиком"));
                            return Ok(());
                        }
                        Ok(()) => {
                            job.note(format!("{via}: другой источник обогнал"));
                            break;
                        }
                        Err(err) => {
                            st.audio.note_rustypipe(false, None);
                            job.note(format!("{via}: {err}"));
                            errors.push(format!("{via}: {err}"));
                            let same = last_error.as_deref() == Some(err.as_str());
                            last_error = Some(err);
                            if has_ytdlp {
                                escalate(app, job);
                                break;
                            }
                            if same {
                                // Тот же сбой у второго клиента подряд: перебирать дальше бессмысленно.
                                break;
                            }
                        }
                    }
                }
                Err(err) => {
                    let err = err.to_string();
                    job.note(format!("RustyPipe ({label}): {err}"));
                    errors.push(format!("RustyPipe ({label}): {err}"));
                    last_error = Some(err);
                }
            }
        }
    }

    if job.complete() {
        return Ok(());
    }

    if has_ytdlp {
        escalate(app, job);
        let task = job.ytdlp_task.lock().unwrap().take();
        if let Some(task) = task {
            match task.await {
                Ok(Ok(())) if job.complete() => return Ok(()),
                Ok(Ok(())) => errors.push("yt-dlp: файл неполный".to_string()),
                Ok(Err(err)) => errors.push(format!("yt-dlp: {err}")),
                Err(err) => errors.push(format!("yt-dlp: {err}")),
            }
        }
        if job.complete() {
            return Ok(());
        }
        // Запасной путь: ссылка от yt-dlp и свой загрузчик.
        match ytdlp::direct(st, &job.id, job.itag()).await {
            Ok(direct) => {
                let via = direct.via.clone();
                match pull_http(st, job, &direct, None).await {
                    Ok(()) if job.complete() => return Ok(()),
                    Ok(()) => {}
                    Err(err) => errors.push(format!("{via}: {err}")),
                }
            }
            Err(err) => errors.push(err.to_string()),
        }
    }

    if job.complete() {
        return Ok(());
    }
    let mut message = errors.join("; ");
    if message.is_empty() {
        message = "YouTube не отдал звук".to_string();
    }
    if !has_ytdlp && engine != YtEngine::Rustypipe {
        message.push_str(". Установите yt-dlp (Настройки → YouTube Music): Frost переключится на него сам");
    }
    Err(crate::error::truncate(message, 600))
}

/// Запускает загрузку самим yt-dlp параллельно (один раз на задание).
fn escalate(app: &AppHandle, job: &Arc<Job>) {
    if job.ytdlp_started.swap(true, Ordering::SeqCst) {
        return;
    }
    let app2 = app.clone();
    let job2 = job.clone();
    let handle = tauri::async_runtime::spawn(async move { pull_ytdlp(app2, job2).await });
    *job.ytdlp_task.lock().unwrap() = Some(handle);
}

fn content_range_total(resp: &reqwest::Response) -> Option<u64> {
    resp.headers()
        .get(reqwest::header::CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.rsplit('/').next())
        .and_then(|v| v.trim().parse::<u64>().ok())
}

/// Качает файл по прямой ссылке последовательными запросами по 10 МиБ, начиная с того,
/// что уже есть. `Ok(())`: файл готов или нас обогнал другой источник.
async fn pull_http(st: &AppState, job: &Arc<Job>, direct: &Direct, escalate_to: Option<&AppHandle>) -> Result<(), String> {
    let http = st.http();
    let mut version: Option<u64> = None;
    let mut pos = job.have();
    let started = Instant::now();
    let mut received: u64 = 0;
    let mut checked_speed = false;
    let mut refreshes = 0u32;
    let mut use_param = false;
    loop {
        if job.complete() {
            return Ok(());
        }
        if let Some(total) = job.total().or(direct.size) {
            if pos >= total {
                return Ok(());
            }
        }
        let end = pos + HTTP_CHUNK - 1;
        let url = if use_param {
            let sep = if direct.url.contains('?') { '&' } else { '?' };
            format!("{}{}range={}-{}", direct.url, sep, pos, end)
        } else {
            direct.url.clone()
        };
        let mut req = http.get(&url).timeout(Duration::from_secs(300));
        if !use_param {
            req = req.header(reqwest::header::RANGE, format!("bytes={pos}-{end}"));
        }
        for (name, value) in &direct.headers {
            req = req.header(name.as_str(), value.as_str());
        }
        let mut resp = match tokio::time::timeout(Duration::from_secs(20), req.send()).await {
            Err(_) => return Err(format!("сервер не ответил (байт {pos})")),
            Ok(Err(err)) => return Err(format!("сеть: {err} (байт {pos})")),
            Ok(Ok(resp)) => resp,
        };
        let status = resp.status();
        if !status.is_success() {
            // 403 на середине: иногда помогает передать диапазон параметром, как у плеера YouTube.
            if (status.as_u16() == 403 || status.as_u16() == 416) && !use_param && refreshes == 0 {
                refreshes += 1;
                use_param = true;
                continue;
            }
            return Err(format!("HTTP {} на {} КБ", status.as_u16(), pos / 1024));
        }
        let ignored_range = status.as_u16() == 200;
        let total = if ignored_range {
            resp.content_length()
        } else {
            content_range_total(&resp)
        }
        .or(direct.size);
        let v = job.adopt(direct.itag, total, &base_mime(&direct.mime))?;
        if version.is_some() && version != Some(v) {
            return Err("формат сменился".to_string());
        }
        version = Some(v);
        let mut at = if ignored_range { 0 } else { pos };
        let mut got_any = false;
        loop {
            let next = tokio::time::timeout(STALL, resp.chunk()).await;
            match next {
                Err(_) => return Err(format!("загрузка встала на {} КБ", at / 1024)),
                Ok(Err(err)) => return Err(format!("обрыв на {} КБ: {err}", at / 1024)),
                Ok(Ok(None)) => break,
                Ok(Ok(Some(bytes))) => {
                    got_any = true;
                    match job.offer(v, at, &bytes) {
                        Offer::Took => {}
                        Offer::Behind => {
                            if job.have() > at + LAG_LIMIT || job.complete() {
                                return Ok(());
                            }
                        }
                        Offer::Rejected => return Err("файл сменился".to_string()),
                    }
                    at += bytes.len() as u64;
                    received += bytes.len() as u64;
                    // Скорость: если YouTube отдаёт в реальном времени, зовём yt-dlp на помощь.
                    if !checked_speed && started.elapsed() > Duration::from_secs(5) {
                        checked_speed = true;
                        let rate = received as f64 / started.elapsed().as_secs_f64();
                        let need = (f64::from(direct.bitrate) / 8.0 * 2.5).max(64.0 * 1024.0);
                        if rate < need {
                            if let Some(app) = escalate_to {
                                job.note(format!("{}: медленно, {} КБ/с", direct.via, (rate / 1024.0) as u64));
                                escalate(app, job);
                            }
                        }
                    }
                }
            }
        }
        if !got_any {
            return Err(format!("пустой ответ на {} КБ", pos / 1024));
        }
        if job.complete() {
            return Ok(());
        }
        // Если другой источник ушёл вперёд, продолжаем с его места.
        pos = at.max(job.have());
        if ignored_range {
            // Сервер отдал весь файл, а он кончился раньше: дальше не продвинемся.
            return Err("сервер оборвал файл".to_string());
        }
    }
}

/// yt-dlp сам скачивает файл в папку кэша, а мы подхватываем его по мере записи.
async fn pull_ytdlp(app: AppHandle, job: Arc<Job>) -> Result<(), String> {
    let st = app.state::<AppState>();
    let st: &AppState = st.inner();
    let exe = ytdlp::find_ytdlp(st).ok_or_else(|| "yt-dlp не установлен".to_string())?;
    let dir = st.audio.dir().ok_or_else(|| "папка кэша недоступна".to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let n = st.audio.counter.fetch_add(1, Ordering::Relaxed);
    let tmp = dir.join(format!("{}.ytdlp.{n}.part", job.id));
    let info = dir.join(format!("{}.ytdlp.{n}.info", job.id));
    let log = dir.join(format!("{}.ytdlp.{n}.log", job.id));
    for path in [&tmp, &info, &log] {
        let _ = std::fs::remove_file(path);
    }
    let escape = |p: &Path| p.display().to_string().replace('%', "%%");
    let format = match job.itag() {
        Some(itag) => format!("{itag}/{YTDLP_FORMAT}"),
        None => YTDLP_FORMAT.to_string(),
    };
    let mut args = ytdlp::base_args(st);
    for a in [
        "--no-playlist",
        "--no-warnings",
        "--quiet",
        "--no-progress",
        "--no-simulate",
        "--no-part",
        "--force-overwrites",
        "--no-mtime",
        "--fixup",
        "never",
        "--retries",
        "10",
        "--fragment-retries",
        "10",
        "--http-chunk-size",
        "10M",
        "-f",
    ] {
        args.push(a.to_string());
    }
    args.push(format);
    args.push("--print-to-file".to_string());
    args.push("before_dl:%(format_id)s|%(filesize)s|%(ext)s".to_string());
    args.push(escape(&info));
    args.push("-o".to_string());
    args.push(escape(&tmp));
    args.push(format!("https://music.youtube.com/watch?v={}", job.id));

    let log_file = std::fs::File::create(&log).map_err(|e| e.to_string())?;
    let mut std_cmd = std::process::Command::new(&exe);
    std_cmd
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::from(log_file))
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1");
    ytdlp::hide_console(&mut std_cmd);
    let mut cmd = tokio::process::Command::from(std_cmd);
    cmd.kill_on_drop(true);
    let mut child = cmd.spawn().map_err(|e| format!("не запустился: {e}"))?;

    let started = Instant::now();
    let mut version: Option<u64> = None;
    let mut foreign = false;
    let mut foreign_itag: Option<u32> = None;
    let mut foreign_ext = String::new();
    let cleanup = |all: bool| {
        if all {
            let _ = std::fs::remove_file(&tmp);
        }
        let _ = std::fs::remove_file(&info);
        let _ = std::fs::remove_file(&log);
    };
    let outcome: Result<(), String> = loop {
        if version.is_none() && !foreign {
            if let Some((itag, size, ext)) = read_info(&info) {
                match job.adopt(itag, size, mime_for_ext(&ext)) {
                    Ok(v) => version = Some(v),
                    Err(err) => {
                        // yt-dlp достался другой формат: докачаем его в кэш целиком, а
                        // плеер перейдёт на файл при следующем запросе (через восстановление).
                        job.note(format!("yt-dlp: {err}"));
                        foreign = true;
                        foreign_itag = itag;
                        foreign_ext = ext;
                    }
                }
            }
        }
        if let Some(v) = version {
            if let Err(err) = feed_from_file(&job, v, &tmp) {
                break Err(err);
            }
            if job.complete() {
                let _ = child.start_kill();
                break Ok(());
            }
        } else if !foreign && job.complete() {
            // Другой источник успел раньше.
            let _ = child.start_kill();
            break Ok(());
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                if let Some(v) = version {
                    let _ = feed_from_file(&job, v, &tmp);
                }
                if status.success() {
                    break Ok(());
                }
                break Err(last_error_line(&log));
            }
            Ok(None) => {}
            Err(err) => break Err(err.to_string()),
        }
        if started.elapsed() > Duration::from_secs(900) {
            let _ = child.start_kill();
            break Err("слишком долго".to_string());
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    };

    match outcome {
        Ok(()) if foreign => {
            let ext = if foreign_ext.is_empty() { "webm".to_string() } else { foreign_ext };
            let itag = foreign_itag.map(|i| i.to_string()).unwrap_or_else(|| "x".to_string());
            let dest = dir.join(format!("{}-{itag}.{ext}", job.id));
            let moved = st.config().audio_cache && std::fs::rename(&tmp, &dest).is_ok();
            cleanup(!moved);
            job.fail("Файл YouTube пришёл в другом формате; он сохранён, плеер продолжит с него".to_string());
            Err("другой формат".to_string())
        }
        Ok(()) => {
            if job.complete() && version.is_some() {
                // Файл на диске уже готов: сохраняем его вместо копии из памяти.
                let len = std::fs::metadata(&tmp).map(|m| m.len()).unwrap_or(0);
                if Some(len) == job.total() && st.config().audio_cache {
                    let ext = ext_for_mime(&job.mime());
                    let itag = job.itag().map(|i| i.to_string()).unwrap_or_else(|| "x".to_string());
                    let dest = dir.join(format!("{}-{itag}.{ext}", job.id));
                    if std::fs::rename(&tmp, &dest).is_ok() {
                        job.meta.lock().unwrap().file = Some(dest);
                    }
                }
            }
            cleanup(true);
            if version.is_none() && !job.complete() {
                return Err("yt-dlp не сообщил формат файла".to_string());
            }
            Ok(())
        }
        Err(err) => {
            cleanup(true);
            Err(err)
        }
    }
}

/// Подхватывает новые байты файла, который пишет yt-dlp.
fn feed_from_file(job: &Job, version: u64, path: &Path) -> Result<(), String> {
    let Ok(meta) = std::fs::metadata(path) else {
        return Ok(());
    };
    let len = meta.len();
    let have = job.have();
    if len <= have {
        return Ok(());
    }
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(have)).map_err(|e| e.to_string())?;
    let mut left = len - have;
    let mut at = have;
    let mut buf = vec![0u8; 1024 * 1024];
    while left > 0 {
        let want = left.min(buf.len() as u64) as usize;
        let n = file.read(&mut buf[..want]).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        match job.offer(version, at, &buf[..n]) {
            Offer::Rejected => return Err("файл сменился".to_string()),
            _ => {}
        }
        at += n as u64;
        left -= n as u64;
    }
    Ok(())
}

fn read_info(path: &Path) -> Option<(Option<u32>, Option<u64>, String)> {
    let text = std::fs::read_to_string(path).ok()?;
    let line = text.lines().rev().find(|l| l.contains('|'))?;
    let mut parts = line.trim().split('|');
    let format_id = parts.next()?.trim().to_string();
    let size = parts.next().and_then(|s| s.trim().parse::<u64>().ok());
    let ext = parts.next().unwrap_or("webm").trim().to_string();
    let itag = format_id.split(['-', '+']).next().and_then(|s| s.parse::<u32>().ok());
    Some((itag, size, ext))
}

fn last_error_line(log: &Path) -> String {
    let text = std::fs::read_to_string(log).unwrap_or_default();
    let line = text
        .lines()
        .rev()
        .find(|l| l.contains("ERROR"))
        .or_else(|| text.lines().rev().find(|l| !l.trim().is_empty()))
        .unwrap_or("завершился с ошибкой")
        .trim()
        .to_string();
    crate::error::truncate(line, 300)
}

/// Сохраняет готовый файл в кэш и освобождает память.
async fn save(st: &AppState, job: &Arc<Job>) {
    job.finish();
    let cfg = st.config();
    let mime = job.mime();
    let existing = job.meta.lock().unwrap().file.clone();
    let path = match existing {
        Some(path) => Some(path),
        None if cfg.audio_cache => {
            let dir = st.audio.dir();
            let itag = job.itag().map(|i| i.to_string()).unwrap_or_else(|| "x".to_string());
            match dir {
                Some(dir) => {
                    let dest = dir.join(format!("{}-{itag}.{}", job.id, ext_for_mime(&mime)));
                    let tmp = dest.with_extension("tmp");
                    let bytes = job.slice(0, u64::MAX / 2);
                    let ok = tokio::task::spawn_blocking({
                        let tmp = tmp.clone();
                        let dest = dest.clone();
                        move || std::fs::write(&tmp, &bytes).and_then(|_| std::fs::rename(&tmp, &dest))
                    })
                    .await
                    .map(|r| r.is_ok())
                    .unwrap_or(false);
                    if ok {
                        Some(dest)
                    } else {
                        let _ = std::fs::remove_file(&tmp);
                        None
                    }
                }
                None => None,
            }
        }
        None => None,
    };
    if let Some(path) = path {
        job.meta.lock().unwrap().file = Some(path.clone());
        st.audio.job_saved(job, &path, &mime);
        st.audio.evict(cfg.audio_cache_mb);
    }
    // Готовое задание больше не нужно в списке: следующий `open` возьмёт файл из кэша
    // (или, если кэш выключен, задание остаётся, пока на него смотрит адрес плеера).
    let mut jobs = st.audio.jobs.lock().unwrap();
    if cfg.audio_cache && jobs.get(&job.id).map(|j| Arc::ptr_eq(j, job)).unwrap_or(false) {
        jobs.remove(&job.id);
    }
}

// ---------------------------------------------------------------------------
// Проверка YouTube (отчёт для настроек)
// ---------------------------------------------------------------------------

async fn probe(st: &AppState, direct: &Direct) -> String {
    let http = st.http();
    let size = direct.size.unwrap_or(0);
    let points: Vec<(&str, u64)> = if size > 300 * 1024 {
        vec![("начало", 0), ("середина", size / 2), ("конец", size - 64 * 1024)]
    } else {
        vec![("начало", 0)]
    };
    let mut parts = Vec::new();
    for (name, at) in points {
        let t = Instant::now();
        let mut req = http
            .get(&direct.url)
            .timeout(Duration::from_secs(20))
            .header(reqwest::header::RANGE, format!("bytes={}-{}", at, at + 64 * 1024 - 1));
        for (k, v) in &direct.headers {
            req = req.header(k.as_str(), v.as_str());
        }
        let line = match req.send().await {
            Ok(resp) => {
                let status = resp.status().as_u16();
                match resp.bytes().await {
                    Ok(b) => format!("{name}: HTTP {status}, {} КБ за {} мс", b.len() / 1024, t.elapsed().as_millis()),
                    Err(e) => format!("{name}: HTTP {status}, обрыв: {e}"),
                }
            }
            Err(e) => format!("{name}: ошибка сети: {e}"),
        };
        parts.push(line);
    }
    parts.join("; ")
}

/// Подробная проверка всех способов получить звук: что отвечает YouTube на начало,
/// середину и конец файла. Отчёт можно скопировать и прислать разработчику.
pub async fn diagnose(st: &AppState, id: &str) -> String {
    let mut out = Vec::new();
    let cfg = st.config();
    out.push(format!("Frost {} · трек {id} · движок {:?}", env!("CARGO_PKG_VERSION"), cfg.yt_engine));
    let status = ytdlp::status(st).await;
    out.push(format!(
        "yt-dlp: {} · Deno: {} · botguard: {}",
        status.version.clone().unwrap_or_else(|| "не установлен".to_string()),
        if status.deno { "есть" } else { "нет" },
        if status.botguard { "есть" } else { "нет" },
    ));
    if st.youtube.compiled() {
        for client in [None, Some("tv"), Some("ios"), Some("android"), Some("desktop_music")] {
            let label = client.unwrap_or("auto");
            let t = Instant::now();
            match st.youtube.audio(id.to_string(), client.map(String::from), None).await {
                Ok(d) => {
                    let report = probe(st, &d).await;
                    out.push(format!(
                        "RustyPipe {label} → {} [itag {:?}, {} КБ, ссылка за {} мс]: {report}",
                        d.via,
                        d.itag,
                        d.size.unwrap_or(0) / 1024,
                        t.elapsed().as_millis()
                    ));
                }
                Err(e) => out.push(format!("RustyPipe {label}: {e}")),
            }
        }
    } else {
        out.push("RustyPipe: не встроен в эту сборку".to_string());
    }
    if status.installed {
        let t = Instant::now();
        match ytdlp::direct(st, id, None).await {
            Ok(d) => {
                let report = probe(st, &d).await;
                out.push(format!(
                    "{} [{} КБ, ссылка за {} мс]: {report}",
                    d.via,
                    d.size.unwrap_or(0) / 1024,
                    t.elapsed().as_millis()
                ));
            }
            Err(e) => out.push(format!("yt-dlp (ссылка): {e}")),
        }
    }
    if let Some(job) = st.audio.job(id) {
        for line in job.log() {
            out.push(format!("загрузка: {line}"));
        }
    }
    let cache = st.audio.info(st);
    out.push(format!(
        "кэш: {} · {} файлов, {} МБ из {} МБ",
        if cache.enabled { "включён" } else { "выключен" },
        cache.files,
        cache.bytes / 1024 / 1024,
        cache.limit_mb
    ));
    out.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offers_join_without_gaps() {
        let job = Job::new("abc");
        let v = job.adopt(Some(251), Some(10), "audio/webm").unwrap();
        assert!(matches!(job.offer(v, 0, b"hello"), Offer::Took));
        assert!(matches!(job.offer(v, 2, b"llo w"), Offer::Took));
        assert!(matches!(job.offer(v, 0, b"he"), Offer::Behind));
        assert!(matches!(job.offer(v, 12, b"x"), Offer::Rejected));
        assert_eq!(job.slice(0, 100), b"hello w".to_vec());
        assert!(job.adopt(Some(140), Some(10), "audio/mp4").is_err());
        assert!(job.adopt(Some(251), Some(10), "audio/webm").is_ok());
        assert!(matches!(job.offer(v, 7, b"orld!!"), Offer::Took));
        assert!(job.complete());
        assert_eq!(job.slice(0, 100), b"hello worl".to_vec());
    }

    #[test]
    fn parses_info_and_ranges() {
        assert_eq!(parse_range(Some("bytes=100-")), (100, None));
        assert_eq!(parse_range(Some("bytes=5-9")), (5, Some(9)));
        assert_eq!(parse_range(None), (0, None));
        assert_eq!(mime_for_ext("m4a"), "audio/mp4");
        assert_eq!(ext_for_mime("audio/webm; codecs=\"opus\""), "webm");
    }
}
