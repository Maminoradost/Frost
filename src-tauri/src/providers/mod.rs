//! Источники музыки в Rust-ядре.
//!
//! * SoundCloud живёт во фронтенде (`src/lib/soundcloud.ts`): ядро даёт ему только
//!   сетевой транспорт `net_fetch` и прокси потоков `register_stream`;
//! * YouTube Music: метаданные через RustyPipe, потоки через RustyPipe или yt-dlp
//!   (выбирается в настройках, по умолчанию «Авто»).
pub mod youtube;
pub mod ytdlp;

use crate::config::YtEngine;
use crate::error::{AppError, AppResult};
use crate::models::{Provider, StreamSource};
use crate::state::AppState;

/// Поток трека для прокси `frost://` (используется и для перезапроса истёкших ссылок).
pub async fn stream_source(st: &AppState, provider: Provider, id: &str) -> AppResult<StreamSource> {
    match provider {
        Provider::Youtube => youtube_stream(st, id, None).await,
        Provider::Soundcloud => Err(AppError::msg(
            "Ссылки SoundCloud обновляет клиент в интерфейсе",
        )),
    }
}

/// Выбор движка YouTube. `force` — принудительный движок (повторная попытка из плеера).
///
/// «Авто»: звук через yt-dlp, если он установлен, иначе RustyPipe; при ошибке одного
/// пробуем другой. Почему yt-dlp первым: без botguard RustyPipe получает потоки клиентов
/// iOS/TV, а YouTube требует для них PO-токен и обрывает загрузку после первой порции
/// (трек играет секунду и замолкает). yt-dlp сам выбирает клиент без этого ограничения
/// и обновляется каждую неделю.
pub async fn youtube_stream(
    st: &AppState,
    id: &str,
    force: Option<YtEngine>,
) -> AppResult<StreamSource> {
    let engine = force.unwrap_or(st.config().yt_engine);
    match engine {
        YtEngine::Rustypipe => st.youtube.stream(id.to_string()).await,
        YtEngine::Ytdlp => ytdlp::stream(st, id).await,
        YtEngine::Auto => {
            if ytdlp::find_ytdlp(st).is_some() {
                match ytdlp::stream(st, id).await {
                    Ok(source) => Ok(source),
                    Err(first) => st.youtube.stream(id.to_string()).await.map_err(|second| {
                        AppError::msg(format!("yt-dlp: {first}. RustyPipe: {second}"))
                    }),
                }
            } else {
                st.youtube.stream(id.to_string()).await.map_err(|first| {
                    AppError::msg(format!(
                        "{first}. Установите yt-dlp в Настройки → YouTube Music: в режиме «Авто» Frost переключится на него сам"
                    ))
                })
            }
        }
    }
}
