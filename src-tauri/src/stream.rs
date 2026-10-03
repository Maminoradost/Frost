//! Протокол `frost://` (на Windows: `http://frost.localhost/`).
//!
//! Зачем он нужен:
//! 1. `<audio>` не умеет добавлять заголовки (например, User-Agent клиента YouTube);
//! 2. WebAudio (эквалайзер, визуализатор) работает только с CORS-чистым звуком. Мы
//!    отдаём всё с `Access-Control-Allow-Origin: *`;
//! 3. HLS-плейлисты переписываются так, чтобы сегменты тоже шли через прокси;
//! 4. фронтенд никогда не получает «сырые» URL: только id из реестра, поэтому это
//!    не открытый прокси.
//!
//! Маршруты:
//! * `r/{id}`: зарегистрированный поток (Range-запросы порциями ≤ 1 МиБ);
//! * `img/{base64url}`: картинка (только `image/*`), нужна для извлечения цвета обложки.
use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

use base64::Engine;
use http::{header, Method, Request, Response, StatusCode};
use tauri::{AppHandle, Manager};
use url::Url;

use crate::error::{AppError, AppResult};
use crate::models::{Provider, StreamKind};
use crate::net::{ensure_ok, API_TIMEOUT, MEDIA_TIMEOUT};
use crate::state::AppState;

const MAX_ENTRIES: usize = 20_000;
/// Первый чанк меньше: трек начинает играть быстрее.
const FIRST_CHUNK: u64 = 384 * 1024;
const CHUNK: u64 = 1024 * 1024;

#[derive(Clone)]
struct Entry {
    url: String,
    /// Дополнительные заголовки для CDN (User-Agent клиента YouTube и т. п.).
    headers: Vec<(String, String)>,
    /// Откуда взят URL: позволяет перезапросить истёкшую подписанную ссылку.
    origin: Option<(Provider, String)>,
}

#[derive(Default)]
struct Registry {
    next_id: u64,
    entries: HashMap<u64, Entry>,
    order: VecDeque<u64>,
}

#[derive(Default)]
pub struct StreamRegistry {
    inner: Mutex<Registry>,
}

pub fn base_url() -> &'static str {
    if cfg!(any(windows, target_os = "android")) {
        "http://frost.localhost/"
    } else {
        "frost://localhost/"
    }
}

impl StreamRegistry {
    /// Регистрирует URL сегмента/ключа HLS и возвращает адрес локального прокси.
    pub fn register(&self, url: &str, headers: Vec<(String, String)>) -> String {
        self.insert(Entry {
            url: url.to_string(),
            headers,
            origin: None,
        })
    }

    /// Регистрирует основной поток трека (с возможностью перезапроса ссылки).
    pub fn register_track(
        &self,
        url: &str,
        provider: Provider,
        id: &str,
        headers: Vec<(String, String)>,
    ) -> String {
        self.insert(Entry {
            url: url.to_string(),
            headers,
            origin: Some((provider, id.to_string())),
        })
    }

    fn update_url(&self, id: u64, url: &str, headers: &[(String, String)]) {
        if let Some(entry) = self.inner.lock().unwrap().entries.get_mut(&id) {
            entry.url = url.to_string();
            entry.headers = headers.to_vec();
        }
    }

    fn insert(&self, entry: Entry) -> String {
        let mut guard = self.inner.lock().unwrap();
        let reg: &mut Registry = &mut guard;
        reg.next_id += 1;
        let id = reg.next_id;
        reg.entries.insert(id, entry);
        reg.order.push_back(id);
        while reg.order.len() > MAX_ENTRIES {
            if let Some(old) = reg.order.pop_front() {
                reg.entries.remove(&old);
            }
        }
        format!("{}r/{}", base_url(), id)
    }

    fn get(&self, id: u64) -> Option<Entry> {
        self.inner.lock().unwrap().entries.get(&id).cloned()
    }
}

pub async fn handle(app: &AppHandle, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    if request.method() == Method::OPTIONS {
        return respond(cors(Response::builder().status(StatusCode::NO_CONTENT)), Vec::new());
    }
    let Some(state) = app.try_state::<AppState>() else {
        return error_response(StatusCode::SERVICE_UNAVAILABLE, "state is not ready");
    };

    let path = request.uri().path().trim_start_matches('/').to_string();
    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let result = if let Some(id) = path.strip_prefix("r/") {
        let stream_id = id.parse::<u64>().unwrap_or(0);
        match state.streams.get(stream_id) {
            Some(entry) => proxy(&state, stream_id, entry, range.as_deref()).await,
            None => return error_response(StatusCode::NOT_FOUND, "unknown stream id"),
        }
    } else if let Some(token) = path.strip_prefix("a/") {
        // Звук YouTube из полной загрузки или кэша (см. ytaudio.rs).
        crate::ytaudio::serve(&state, token, range.as_deref()).await
    } else if let Some(encoded) = path.strip_prefix("img/") {
        image(&state, encoded).await
    } else {
        return error_response(StatusCode::NOT_FOUND, "not found");
    };

    match result {
        Ok(response) => response,
        Err(err) => error_response(StatusCode::BAD_GATEWAY, &err.to_string()),
    }
}

async fn proxy(
    st: &AppState,
    stream_id: u64,
    mut entry: Entry,
    range: Option<&str>,
) -> AppResult<Response<Vec<u8>>> {
    // (заголовок Range для апстрима, начало диапазона, запрошенный конец)
    let plan: Option<(String, Option<u64>, Option<u64>)> = range.map(|raw| match parse_range(raw) {
        Some((start, end)) => {
            let max = if start == 0 { FIRST_CHUNK } else { CHUNK };
            let capped = end
                .map(|e| e.min(start + max - 1))
                .unwrap_or(start + max - 1);
            (format!("bytes={start}-{capped}"), Some(start), end)
        }
        // Нестандартный диапазон (например, суффиксный) передаём как есть.
        None => (raw.to_string(), None, None),
    });

    let range_header = plan.as_ref().map(|p| p.0.clone());
    let mut resp = fetch(st, &entry.url, range_header.as_deref(), &entry.headers).await?;

    // Подписанная ссылка истекла (долгая пауза): получаем новую и повторяем один раз.
    if matches!(resp.status().as_u16(), 401 | 403 | 404 | 410) {
        if let Some((provider, track_id)) = entry.origin.clone() {
            if let Ok(source) = crate::providers::stream_source(st, provider, &track_id).await {
                if source.kind == StreamKind::Progressive {
                    st.streams.update_url(stream_id, &source.url, &source.headers);
                    entry.url = source.url;
                    entry.headers = source.headers;
                    resp = fetch(st, &entry.url, range_header.as_deref(), &entry.headers).await?;
                }
            }
        }
    }
    let status = resp.status();
    let final_url = resp.url().clone();
    let content_type = header_str(&resp, reqwest::header::CONTENT_TYPE).unwrap_or_default();
    let content_range = header_str(&resp, reqwest::header::CONTENT_RANGE);

    // HLS-плейлист: переписываем ссылки на сегменты.
    if status.is_success() && is_playlist(&final_url, &content_type) {
        let text = resp.text().await?;
        let body = rewrite_playlist(st, &final_url, &text, &entry.headers);
        return Ok(respond(
            cors(Response::builder().status(StatusCode::OK))
                .header(header::CONTENT_TYPE, "application/vnd.apple.mpegurl")
                .header(header::CACHE_CONTROL, "no-store"),
            body.into_bytes(),
        ));
    }

    if status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
        let mut builder = cors(Response::builder().status(StatusCode::RANGE_NOT_SATISFIABLE));
        if let Some(cr) = content_range {
            builder = builder.header(header::CONTENT_RANGE, cr);
        }
        return Ok(respond(builder, Vec::new()));
    }

    if !status.is_success() {
        let code = StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
        return Ok(error_response(code, "upstream error"));
    }

    let bytes = resp.bytes().await?.to_vec();
    let ctype = if content_type.is_empty() {
        guess_content_type(&final_url).to_string()
    } else {
        content_type
    };

    match plan {
        // Без Range (HLS-сегменты, ключи): отдаём целиком.
        None => Ok(respond(
            cors(Response::builder().status(StatusCode::OK))
                .header(header::CONTENT_TYPE, ctype)
                .header(header::ACCEPT_RANGES, "bytes"),
            bytes,
        )),
        Some((_, start, requested_end)) => {
            if status == reqwest::StatusCode::PARTIAL_CONTENT {
                let content_range = match content_range {
                    Some(cr) => cr,
                    None => {
                        let start = start.unwrap_or(0);
                        let end = start + (bytes.len() as u64).saturating_sub(1);
                        format!("bytes {start}-{end}/*")
                    }
                };
                return Ok(respond(
                    cors(Response::builder().status(StatusCode::PARTIAL_CONTENT))
                        .header(header::CONTENT_TYPE, ctype)
                        .header(header::ACCEPT_RANGES, "bytes")
                        .header(header::CONTENT_RANGE, content_range)
                        .header(header::CONTENT_LENGTH, bytes.len()),
                    bytes,
                ));
            }

            // Сервер проигнорировал Range и прислал файл целиком: режем сами.
            let Some(start) = start else {
                return Ok(respond(
                    cors(Response::builder().status(StatusCode::OK))
                        .header(header::CONTENT_TYPE, ctype)
                        .header(header::ACCEPT_RANGES, "bytes"),
                    bytes,
                ));
            };
            let total = bytes.len() as u64;
            if total == 0 || start >= total {
                return Ok(respond(
                    cors(Response::builder().status(StatusCode::RANGE_NOT_SATISFIABLE))
                        .header(header::CONTENT_RANGE, format!("bytes */{total}")),
                    Vec::new(),
                ));
            }
            let end = requested_end.unwrap_or(total - 1).min(total - 1);
            let slice = bytes[start as usize..=end as usize].to_vec();
            Ok(respond(
                cors(Response::builder().status(StatusCode::PARTIAL_CONTENT))
                    .header(header::CONTENT_TYPE, ctype)
                    .header(header::ACCEPT_RANGES, "bytes")
                    .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{total}"))
                    .header(header::CONTENT_LENGTH, slice.len()),
                slice,
            ))
        }
    }
}

/// Запрос к апстриму (CDN) с нужными заголовками.
async fn fetch(
    st: &AppState,
    url: &str,
    range: Option<&str>,
    headers: &[(String, String)],
) -> AppResult<reqwest::Response> {
    let mut req = st.http().get(url).timeout(MEDIA_TIMEOUT);
    for (name, value) in headers {
        req = req.header(name.as_str(), value.as_str());
    }
    if let Some(range) = range {
        req = req.header(reqwest::header::RANGE, range);
    }
    Ok(req.send().await?)
}

async fn image(st: &AppState, encoded: &str) -> AppResult<Response<Vec<u8>>> {
    let raw = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(encoded.trim_end_matches('='))
        .map_err(|_| AppError::msg("bad image url"))?;
    let url = String::from_utf8(raw).map_err(|_| AppError::msg("bad image url"))?;
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(AppError::msg("bad image url"));
    }
    let resp = ensure_ok(st.http().get(&url).timeout(API_TIMEOUT).send().await?).await?;
    let ctype = header_str(&resp, reqwest::header::CONTENT_TYPE).unwrap_or_default();
    if !ctype.starts_with("image/") {
        return Err(AppError::msg("not an image"));
    }
    let bytes = resp.bytes().await?.to_vec();
    Ok(respond(
        cors(Response::builder().status(StatusCode::OK))
            .header(header::CONTENT_TYPE, ctype)
            .header(header::CACHE_CONTROL, "max-age=86400"),
        bytes,
    ))
}

/// Переписывает URI сегментов/ключей/вложенных плейлистов на адреса прокси.
fn rewrite_playlist(st: &AppState, base: &Url, text: &str, headers: &[(String, String)]) -> String {
    let mut out = String::with_capacity(text.len() * 2);
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            out.push('\n');
            continue;
        }
        if trimmed.starts_with('#') {
            out.push_str(&rewrite_uri_attr(st, base, trimmed, headers));
        } else {
            match base.join(trimmed) {
                Ok(abs) => out.push_str(&st.streams.register(abs.as_str(), headers.to_vec())),
                Err(_) => out.push_str(trimmed),
            }
        }
        out.push('\n');
    }
    out
}

/// `#EXT-X-KEY:METHOD=AES-128,URI="key.bin"` / `#EXT-X-MAP:URI="init.mp4"`
fn rewrite_uri_attr(st: &AppState, base: &Url, line: &str, headers: &[(String, String)]) -> String {
    const MARK: &str = "URI=\"";
    let Some(pos) = line.find(MARK) else {
        return line.to_string();
    };
    let start = pos + MARK.len();
    let Some(len) = line[start..].find('"') else {
        return line.to_string();
    };
    let uri = &line[start..start + len];
    match base.join(uri) {
        Ok(abs) => format!(
            "{}{}{}",
            &line[..start],
            st.streams.register(abs.as_str(), headers.to_vec()),
            &line[start + len..]
        ),
        Err(_) => line.to_string(),
    }
}

fn is_playlist(url: &Url, content_type: &str) -> bool {
    content_type.to_ascii_lowercase().contains("mpegurl")
        || url.path().to_ascii_lowercase().ends_with(".m3u8")
}

fn guess_content_type(url: &Url) -> &'static str {
    let path = url.path().to_ascii_lowercase();
    if path.ends_with(".m4a") || path.ends_with(".mp4") || path.ends_with(".m4s") {
        "audio/mp4"
    } else if path.ends_with(".aac") {
        "audio/aac"
    } else if path.ends_with(".ts") {
        "video/mp2t"
    } else if path.ends_with(".ogg") || path.ends_with(".opus") {
        "audio/ogg"
    } else {
        "audio/mpeg"
    }
}

/// `bytes=START-[END]` → (start, end). Множественные/суффиксные диапазоны не поддерживаем.
fn parse_range(value: &str) -> Option<(u64, Option<u64>)> {
    let spec = value.trim().strip_prefix("bytes=")?;
    let first = spec.split(',').next()?.trim();
    let (start, end) = first.split_once('-')?;
    let start = start.trim();
    if start.is_empty() {
        return None;
    }
    let start: u64 = start.parse().ok()?;
    let end = end.trim();
    let end = if end.is_empty() { None } else { end.parse().ok() };
    Some((start, end))
}

fn header_str(resp: &reqwest::Response, name: reqwest::header::HeaderName) -> Option<String> {
    resp.headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
}

fn cors(builder: http::response::Builder) -> http::response::Builder {
    builder
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "*")
        .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, OPTIONS")
        .header(
            header::ACCESS_CONTROL_EXPOSE_HEADERS,
            "Content-Length, Content-Range, Accept-Ranges",
        )
}

fn respond(builder: http::response::Builder, body: Vec<u8>) -> Response<Vec<u8>> {
    builder.body(body).unwrap_or_else(|_| {
        let mut fallback = Response::new(Vec::new());
        *fallback.status_mut() = StatusCode::INTERNAL_SERVER_ERROR;
        fallback
    })
}

fn error_response(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    respond(
        cors(Response::builder().status(status))
            .header(header::CONTENT_TYPE, "text/plain; charset=utf-8"),
        message.as_bytes().to_vec(),
    )
}

#[cfg(test)]
mod tests {
    use super::parse_range;

    #[test]
    fn parses_ranges() {
        assert_eq!(parse_range("bytes=0-"), Some((0, None)));
        assert_eq!(parse_range("bytes=100-199"), Some((100, Some(199))));
        assert_eq!(parse_range("bytes=-500"), None);
        assert_eq!(parse_range("items=0-1"), None);
    }
}
