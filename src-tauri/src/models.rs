//! Единая модель данных для всех источников. Сериализуется в camelCase для TypeScript.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Soundcloud,
    Youtube,
}

impl Provider {
    pub fn label(self) -> &'static str {
        match self {
            Provider::Soundcloud => "SoundCloud",
            Provider::Youtube => "YouTube Music",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub provider: Provider,
    pub title: String,
    pub artist: String,
    pub artist_id: Option<String>,
    pub album: Option<String>,
    #[serde(default)]
    pub album_id: Option<String>,
    pub artwork: Option<String>,
    pub artwork_small: Option<String>,
    /// Длительность в секундах.
    pub duration: f64,
    pub permalink: Option<String>,
    pub genre: Option<String>,
    pub plays: Option<u64>,
    pub likes: Option<u64>,
    pub streamable: bool,
    /// Доступен только 30-секундный фрагмент (SoundCloud Go+).
    pub preview_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Artist {
    pub id: String,
    pub provider: Provider,
    pub name: String,
    pub handle: Option<String>,
    pub avatar: Option<String>,
    pub cover: Option<String>,
    pub followers: Option<u64>,
    pub track_count: Option<u64>,
    pub bio: Option<String>,
    pub permalink: Option<String>,
    pub verified: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: String,
    pub provider: Provider,
    pub title: String,
    pub owner: Option<String>,
    #[serde(default)]
    pub owner_id: Option<String>,
    pub artwork: Option<String>,
    pub track_count: Option<u64>,
    pub description: Option<String>,
    pub permalink: Option<String>,
    /// "playlist" | "album" | "single" | "ep"
    #[serde(default = "default_kind")]
    pub kind: String,
    #[serde(default)]
    pub year: Option<u16>,
}

fn default_kind() -> String {
    "playlist".to_string()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page<T> {
    pub items: Vec<T>,
    /// Непрозрачный курсор следующей страницы.
    pub next: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistDetails {
    pub playlist: Playlist,
    pub tracks: Vec<Track>,
}

/// Всё найденное по запросу в одном источнике.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub tracks: Vec<Track>,
    pub artists: Vec<Artist>,
    pub albums: Vec<Playlist>,
    pub playlists: Vec<Playlist>,
    /// Курсор для «Показать ещё» в треках.
    pub tracks_next: Option<String>,
    /// Исправленный запрос («Возможно, вы искали…»).
    pub corrected: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistPage {
    pub artist: Artist,
    pub top_tracks: Vec<Track>,
    pub albums: Vec<Playlist>,
    pub singles: Vec<Playlist>,
    pub playlists: Vec<Playlist>,
    pub similar: Vec<Artist>,
    /// Курсор полного списка треков (SoundCloud).
    pub tracks_next: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Charts {
    pub country: Option<String>,
    pub countries: Vec<String>,
    pub top: Vec<Track>,
    pub trending: Vec<Track>,
    pub artists: Vec<Artist>,
    pub playlists: Vec<Playlist>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Genre {
    pub id: String,
    pub provider: Provider,
    pub name: String,
    /// Цвет жанра в формате #rrggbb (у YouTube Music он есть у каждого жанра).
    pub color: Option<String>,
    pub is_mood: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenreSection {
    pub title: String,
    pub playlists: Vec<Playlist>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenrePage {
    pub id: String,
    pub provider: Provider,
    pub title: String,
    pub sections: Vec<GenreSection>,
    pub tracks: Vec<Track>,
}

/// Результат разбора ссылки (вставили URL в поиск).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Resolved {
    Track { track: Track },
    Artist { artist: Artist },
    Playlist { playlist: Playlist },
    None,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum StreamKind {
    Progressive,
    Hls,
}

/// Поток, как его отдаёт провайдер (до регистрации в прокси).
#[derive(Debug, Clone)]
pub struct StreamSource {
    pub url: String,
    pub kind: StreamKind,
    pub preview: bool,
    /// Дополнительные заголовки для CDN (например, User-Agent клиента YouTube).
    pub headers: Vec<(String, String)>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedStream {
    pub url: String,
    pub kind: StreamKind,
    pub preview: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lyrics {
    pub synced: Option<String>,
    pub plain: Option<String>,
    pub instrumental: bool,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceStatus {
    pub provider: Provider,
    pub ok: bool,
    pub message: String,
    pub millis: u64,
}

/// Помощник: непустая строка или None.
pub fn non_empty(value: Option<String>) -> Option<String> {
    value.and_then(|s| {
        let trimmed = s.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}
