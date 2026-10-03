//! YouTube Music через RustyPipe (https://codeberg.org/ThetaDev/rustypipe, GPL-3.0).
//!
//! RustyPipe работает в отдельном потоке со своим однопоточным Tokio-рантаймом
//! (`LocalSet`): так нам не важно, являются ли его future `Send`. Команды Tauri
//! отправляют задания через канал и ждут ответ через `oneshot`.
//!
//! Сборка без RustyPipe: `cargo build --no-default-features`. Тогда поиск и потоки
//! YouTube идут только через yt-dlp.
use std::path::PathBuf;

use crate::config::AppConfig;
use crate::error::{AppError, AppResult};
use crate::ytaudio::Direct;
use crate::models::{
    ArtistPage, Charts, Genre, GenrePage, Playlist, PlaylistDetails, SearchResults, StreamSource,
    Track,
};

#[cfg(feature = "rustypipe")]
pub use enabled::YouTube;

#[cfg(not(feature = "rustypipe"))]
pub use disabled::YouTube;

fn unavailable() -> AppError {
    AppError::msg("YouTube Music сейчас недоступен. Проверьте подключение или включите yt-dlp в настройках")
}

#[cfg(feature = "rustypipe")]
mod enabled {
    use super::*;
    use std::future::Future;
    use std::pin::Pin;
    use std::sync::Mutex;
    use std::time::Duration;

    use rustypipe::client::{ClientType, RustyPipe, RustyPipeBuilder};
    use rustypipe::model::{
        AlbumItem, AlbumType, ArtistItem, AudioCodec, AudioFormat, AudioStream, MusicPlaylistItem,
        Thumbnail, TrackItem,
    };
    use rustypipe::param::{Country, Language};
    use tokio::sync::{mpsc, oneshot};

    use crate::error::truncate;
    use crate::models::{Artist, GenreSection, Provider, StreamKind};
    use crate::net;

    type Job = Box<dyn FnOnce(RustyPipe) -> Pin<Box<dyn Future<Output = ()>>> + Send>;
    type BoxFut<T> = Pin<Box<dyn Future<Output = AppResult<T>>>>;

    enum Msg {
        Job(Job),
        Rebuild(AppConfig),
    }

    pub struct YouTube {
        tx: Mutex<Option<mpsc::UnboundedSender<Msg>>>,
    }

    impl YouTube {
        pub fn new() -> Self {
            Self { tx: Mutex::new(None) }
        }

        pub fn compiled(&self) -> bool {
            true
        }

        /// Запускает поток RustyPipe (вызывается один раз из `AppState::init`).
        pub fn init(&self, dir: PathBuf, cfg: &AppConfig) {
            let (tx, rx) = mpsc::unbounded_channel::<Msg>();
            let cfg = cfg.clone();
            let spawned = std::thread::Builder::new()
                .name("frost-youtube".into())
                .spawn(move || worker(dir, cfg, rx));
            if spawned.is_ok() {
                *self.tx.lock().unwrap() = Some(tx);
            }
        }

        /// Пересоздаёт клиент (сменились сеть, страна или язык).
        pub fn rebuild(&self, cfg: &AppConfig) {
            let sender = self.tx.lock().unwrap().clone();
            if let Some(sender) = sender {
                let _ = sender.send(Msg::Rebuild(cfg.clone()));
            }
        }

        async fn run<T, F>(&self, make: F) -> AppResult<T>
        where
            T: Send + 'static,
            F: FnOnce(RustyPipe) -> BoxFut<T> + Send + 'static,
        {
            let (otx, orx) = oneshot::channel::<AppResult<T>>();
            let job: Job = Box::new(move |rp: RustyPipe| -> Pin<Box<dyn Future<Output = ()>>> {
                let fut = make(rp);
                Box::pin(async move {
                    let result = fut.await;
                    let _ = otx.send(result);
                })
            });
            let sender = self.tx.lock().unwrap().clone();
            let Some(sender) = sender else {
                return Err(unavailable());
            };
            if sender.send(Msg::Job(job)).is_err() {
                return Err(unavailable());
            }
            match tokio::time::timeout(Duration::from_secs(45), orx).await {
                Ok(Ok(result)) => result,
                Ok(Err(_)) => Err(unavailable()),
                Err(_) => Err(AppError::msg("YouTube Music не ответил вовремя")),
            }
        }

        pub async fn search(&self, query: String) -> AppResult<SearchResults> {
            self.run::<SearchResults, _>(move |rp: RustyPipe| -> BoxFut<SearchResults> { Box::pin(do_search(rp, query)) })
                .await
        }

        pub async fn search_tracks(&self, query: String) -> AppResult<Vec<Track>> {
            self.run::<Vec<Track>, _>(move |rp: RustyPipe| -> BoxFut<Vec<Track>> { Box::pin(do_search_tracks(rp, query)) })
                .await
        }

        pub async fn artist(&self, id: String) -> AppResult<ArtistPage> {
            self.run::<ArtistPage, _>(move |rp: RustyPipe| -> BoxFut<ArtistPage> { Box::pin(do_artist(rp, id)) })
                .await
        }

        pub async fn playlist(&self, id: String) -> AppResult<PlaylistDetails> {
            self.run::<PlaylistDetails, _>(move |rp: RustyPipe| -> BoxFut<PlaylistDetails> { Box::pin(do_playlist(rp, id)) })
                .await
        }

        pub async fn charts(&self, country: Option<String>) -> AppResult<Charts> {
            self.run::<Charts, _>(move |rp: RustyPipe| -> BoxFut<Charts> { Box::pin(do_charts(rp, country)) })
                .await
        }

        pub async fn new_releases(&self) -> AppResult<Vec<Playlist>> {
            self.run::<Vec<Playlist>, _>(move |rp: RustyPipe| -> BoxFut<Vec<Playlist>> { Box::pin(do_new_releases(rp)) })
                .await
        }

        pub async fn genres(&self) -> AppResult<Vec<Genre>> {
            self.run::<Vec<Genre>, _>(move |rp: RustyPipe| -> BoxFut<Vec<Genre>> { Box::pin(do_genres(rp)) }).await
        }

        pub async fn genre(&self, id: String) -> AppResult<GenrePage> {
            self.run::<GenrePage, _>(move |rp: RustyPipe| -> BoxFut<GenrePage> { Box::pin(do_genre(rp, id)) }).await
        }

        pub async fn radio(&self, id: String) -> AppResult<Vec<Track>> {
            self.run::<Vec<Track>, _>(move |rp: RustyPipe| -> BoxFut<Vec<Track>> { Box::pin(do_radio(rp, id)) }).await
        }

        pub async fn track(&self, id: String) -> AppResult<Track> {
            self.run::<Track, _>(move |rp: RustyPipe| -> BoxFut<Track> { Box::pin(do_track(rp, id)) }).await
        }

        pub async fn lyrics(&self, id: String) -> AppResult<Option<String>> {
            self.run::<Option<String>, _>(move |rp: RustyPipe| -> BoxFut<Option<String>> { Box::pin(do_lyrics(rp, id)) })
                .await
        }

        pub async fn stream(&self, id: String) -> AppResult<StreamSource> {
            self.run::<StreamSource, _>(move |rp: RustyPipe| -> BoxFut<StreamSource> { Box::pin(do_stream(rp, id)) })
                .await
        }

        /// Прямая ссылка на файл звука с форматом и размером (для полной загрузки).
        /// `client`: конкретный клиент YouTube (`tv`, `ios`, `android`, `desktop_music`...),
        /// `itag`: нужен именно этот формат (продолжение уже начатой загрузки).
        pub async fn audio(&self, id: String, client: Option<String>, itag: Option<u32>) -> AppResult<Direct> {
            self.run::<Direct, _>(move |rp: RustyPipe| -> BoxFut<Direct> { Box::pin(do_audio(rp, id, client, itag)) })
                .await
        }
    }

    // ---------- поток RustyPipe ----------

    fn worker(dir: PathBuf, cfg: AppConfig, mut rx: mpsc::UnboundedReceiver<Msg>) {
        let runtime = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(runtime) => runtime,
            Err(_) => return,
        };
        let local = tokio::task::LocalSet::new();
        local.block_on(&runtime, async move {
            let mut client = build(&dir, &cfg);
            while let Some(msg) = rx.recv().await {
                match msg {
                    Msg::Job(job) => {
                        // Если клиент не собрался, задание просто отбрасывается:
                        // вызывающий получит «недоступен» (oneshot закроется).
                        if let Some(rp) = client.clone() {
                            let _ = tokio::task::spawn_local(job(rp));
                        }
                    }
                    Msg::Rebuild(new_cfg) => {
                        client = build(&dir, &new_cfg);
                    }
                }
            }
        });
    }

    fn build(dir: &PathBuf, cfg: &AppConfig) -> Option<RustyPipe> {
        let _ = std::fs::create_dir_all(dir);
        let mut builder = RustyPipeBuilder::new().storage_dir(dir.clone()).no_reporter();
        // rustypipe-botguard (ставится кнопкой в настройках) даёт PO-токены: с ними YouTube
        // отдаёт файл целиком и браузерным клиентам. Без него RustyPipe обходится другими.
        builder = match botguard_path(dir) {
            Some(bin) => builder.botguard_bin(bin.into_os_string()),
            None => builder.no_botguard(),
        };
        if let Some(country) = parse_country(&cfg.region) {
            builder = builder.country(country);
        }
        if let Some(lang) = parse_language(&cfg.language) {
            builder = builder.lang(lang);
        }
        builder.build_with_client(net::client_builder(cfg)).ok()
    }

    fn parse_country(code: &str) -> Option<Country> {
        let code = code.trim().to_ascii_uppercase();
        if code.is_empty() {
            return None;
        }
        serde_json::from_value::<Country>(serde_json::Value::String(code)).ok()
    }

    fn parse_language(code: &str) -> Option<Language> {
        let code = code.trim().to_ascii_lowercase();
        if code.is_empty() {
            return None;
        }
        serde_json::from_value::<Language>(serde_json::Value::String(code)).ok()
    }

    fn country_code(country: &Country) -> Option<String> {
        serde_json::to_value(country)
            .ok()
            .and_then(|v| v.as_str().map(|s| s.to_string()))
    }

    fn yt_err(err: rustypipe::error::Error) -> AppError {
        AppError::msg(truncate(format!("YouTube Music: {err}"), 300))
    }

    // ---------- маппинг в общую модель ----------

    /// Ссылки lh3.googleusercontent.com можно «увеличить» суффиксом `=w544-h544`.
    fn resize(url: &str, size: u32) -> String {
        let resizable = url.contains("googleusercontent.com") || url.contains("ggpht.com");
        if resizable {
            if let Some(pos) = url.rfind('=') {
                let suffix = &url[pos + 1..];
                if suffix.starts_with('w') || suffix.starts_with('s') {
                    return format!("{}=w{size}-h{size}-l90-rj", &url[..pos]);
                }
            }
        }
        url.to_string()
    }

    fn thumb(list: &[Thumbnail], size: u32) -> Option<String> {
        let pick = list
            .iter()
            .filter(|t| t.width >= size)
            .min_by_key(|t| t.width)
            .or_else(|| list.iter().max_by_key(|t| t.width))?;
        Some(resize(&pick.url, size))
    }

    fn join_artists(list: &[rustypipe::model::ArtistId]) -> String {
        list.iter()
            .map(|a| a.name.as_str())
            .filter(|n| !n.is_empty())
            .collect::<Vec<_>>()
            .join(", ")
    }

    fn map_track(t: &TrackItem) -> Track {
        Track {
            id: t.id.clone(),
            provider: Provider::Youtube,
            title: t.name.clone(),
            artist: join_artists(&t.artists),
            artist_id: t
                .artist_id
                .clone()
                .or_else(|| t.artists.iter().find_map(|a| a.id.clone())),
            album: t.album.as_ref().map(|a| a.name.clone()),
            album_id: t.album.as_ref().map(|a| a.id.clone()),
            artwork: thumb(&t.cover, 544),
            artwork_small: thumb(&t.cover, 120),
            duration: t.duration.map(f64::from).unwrap_or(0.0),
            permalink: Some(format!("https://music.youtube.com/watch?v={}", t.id)),
            genre: None,
            plays: t.view_count,
            likes: None,
            streamable: true,
            preview_only: false,
        }
    }

    fn album_kind(kind: &AlbumType) -> String {
        match kind {
            AlbumType::Single => "single",
            AlbumType::Ep => "ep",
            _ => "album",
        }
        .to_string()
    }

    fn map_album(a: &AlbumItem) -> Playlist {
        Playlist {
            id: a.id.clone(),
            provider: Provider::Youtube,
            title: a.name.clone(),
            owner: Some(join_artists(&a.artists)).filter(|s| !s.is_empty()),
            owner_id: a
                .artist_id
                .clone()
                .or_else(|| a.artists.iter().find_map(|x| x.id.clone())),
            artwork: thumb(&a.cover, 544),
            track_count: None,
            description: None,
            permalink: Some(format!("https://music.youtube.com/browse/{}", a.id)),
            kind: album_kind(&a.album_type),
            year: a.year,
        }
    }

    fn map_artist(a: &ArtistItem) -> Artist {
        Artist {
            id: a.id.clone(),
            provider: Provider::Youtube,
            name: a.name.clone(),
            handle: None,
            avatar: thumb(&a.avatar, 544),
            cover: None,
            followers: a.subscriber_count,
            track_count: None,
            bio: None,
            permalink: Some(format!("https://music.youtube.com/channel/{}", a.id)),
            verified: false,
        }
    }

    fn map_playlist(p: &MusicPlaylistItem) -> Playlist {
        Playlist {
            id: p.id.clone(),
            provider: Provider::Youtube,
            title: p.name.clone(),
            owner: p.channel.as_ref().map(|c| c.name.clone()),
            owner_id: p.channel.as_ref().map(|c| c.id.clone()),
            artwork: thumb(&p.thumbnail, 544),
            track_count: p.track_count,
            description: None,
            permalink: Some(format!("https://music.youtube.com/playlist?list={}", p.id)),
            kind: "playlist".to_string(),
            year: None,
        }
    }

    // ---------- запросы ----------

    async fn do_search(rp: RustyPipe, query: String) -> AppResult<SearchResults> {
        let q = rp.query();
        let (tracks, artists, albums, playlists) = tokio::join!(
            q.music_search_tracks(&query),
            q.music_search_artists(&query),
            q.music_search_albums(&query),
            q.music_search_playlists(&query, false),
        );
        let tracks = tracks.map_err(yt_err)?;
        let corrected = tracks.corrected_query.clone();
        Ok(SearchResults {
            tracks: tracks.items.items.iter().map(map_track).collect(),
            artists: artists
                .map(|r| r.items.items.iter().map(map_artist).collect())
                .unwrap_or_default(),
            albums: albums
                .map(|r| r.items.items.iter().map(map_album).collect())
                .unwrap_or_default(),
            playlists: playlists
                .map(|r| r.items.items.iter().map(map_playlist).collect())
                .unwrap_or_default(),
            tracks_next: None,
            corrected,
        })
    }

    async fn do_search_tracks(rp: RustyPipe, query: String) -> AppResult<Vec<Track>> {
        let result = rp
            .query()
            .music_search_tracks(&query)
            .await
            .map_err(yt_err)?;
        Ok(result.items.items.iter().map(map_track).collect())
    }

    async fn do_artist(rp: RustyPipe, id: String) -> AppResult<ArtistPage> {
        let a = rp.query().music_artist(&id, false).await.map_err(yt_err)?;
        let mut albums = Vec::new();
        let mut singles = Vec::new();
        for item in &a.albums {
            let mapped = map_album(item);
            if mapped.kind == "single" {
                singles.push(mapped);
            } else {
                albums.push(mapped);
            }
        }
        let artist = Artist {
            id: a.id.clone(),
            provider: Provider::Youtube,
            name: a.name.clone(),
            handle: None,
            avatar: thumb(&a.header_image, 544),
            cover: thumb(&a.header_image, 1440),
            followers: a.subscriber_count,
            track_count: None,
            bio: a.description.clone().filter(|d| !d.trim().is_empty()),
            permalink: Some(format!("https://music.youtube.com/channel/{}", a.id)),
            verified: false,
        };
        Ok(ArtistPage {
            artist,
            top_tracks: a.tracks.iter().map(map_track).collect(),
            albums,
            singles,
            playlists: a.playlists.iter().map(map_playlist).collect(),
            similar: a.similar_artists.iter().map(map_artist).collect(),
            tracks_next: None,
        })
    }

    async fn do_playlist(rp: RustyPipe, id: String) -> AppResult<PlaylistDetails> {
        let q = rp.query();
        if id.starts_with("MPREb") {
            let album = q.music_album(&id).await.map_err(yt_err)?;
            let cover = thumb(&album.cover, 544);
            let cover_small = thumb(&album.cover, 120);
            let owner = Some(join_artists(&album.artists)).filter(|s| !s.is_empty());
            let tracks = album
                .tracks
                .iter()
                .map(|t| {
                    let mut track = map_track(t);
                    if track.artwork.is_none() {
                        track.artwork = cover.clone();
                        track.artwork_small = cover_small.clone();
                    }
                    if track.album.is_none() {
                        track.album = Some(album.name.clone());
                        track.album_id = Some(album.id.clone());
                    }
                    if track.artist.is_empty() {
                        track.artist = owner.clone().unwrap_or_default();
                    }
                    track
                })
                .collect::<Vec<_>>();
            let playlist = Playlist {
                id: album.id.clone(),
                provider: Provider::Youtube,
                title: album.name.clone(),
                owner,
                owner_id: album.artist_id.clone(),
                artwork: cover,
                track_count: Some(u64::from(album.track_count)),
                description: None,
                permalink: Some(format!("https://music.youtube.com/browse/{}", album.id)),
                kind: album_kind(&album.album_type),
                year: album.year,
            };
            return Ok(PlaylistDetails { playlist, tracks });
        }
        let list = q.music_playlist(&id).await.map_err(yt_err)?;
        let playlist = Playlist {
            id: list.id.clone(),
            provider: Provider::Youtube,
            title: list.name.clone(),
            owner: list.channel.as_ref().map(|c| c.name.clone()),
            owner_id: list.channel.as_ref().map(|c| c.id.clone()),
            artwork: thumb(&list.thumbnail, 544),
            track_count: list.track_count,
            description: None,
            permalink: Some(format!("https://music.youtube.com/playlist?list={}", list.id)),
            kind: "playlist".to_string(),
            year: None,
        };
        Ok(PlaylistDetails {
            playlist,
            tracks: list.tracks.items.iter().map(map_track).collect(),
        })
    }

    async fn do_charts(rp: RustyPipe, country: Option<String>) -> AppResult<Charts> {
        let wanted = country.as_deref().and_then(parse_country);
        let charts = rp.query().music_charts(wanted).await.map_err(yt_err)?;
        Ok(Charts {
            country: country.map(|c| c.to_ascii_uppercase()),
            countries: charts
                .available_countries
                .iter()
                .filter_map(country_code)
                .collect(),
            top: charts.top_tracks.iter().map(map_track).collect(),
            trending: charts.trending_tracks.iter().map(map_track).collect(),
            artists: charts.artists.iter().map(map_artist).collect(),
            playlists: charts.playlists.iter().map(map_playlist).collect(),
        })
    }

    async fn do_new_releases(rp: RustyPipe) -> AppResult<Vec<Playlist>> {
        let albums = rp.query().music_new_albums().await.map_err(yt_err)?;
        Ok(albums.iter().map(map_album).collect())
    }

    async fn do_genres(rp: RustyPipe) -> AppResult<Vec<Genre>> {
        let genres = rp.query().music_genres().await.map_err(yt_err)?;
        Ok(genres
            .iter()
            .map(|g| Genre {
                id: g.id.clone(),
                provider: Provider::Youtube,
                name: g.name.clone(),
                color: Some(format!("#{:06x}", g.color & 0x00FF_FFFF)),
                is_mood: g.is_mood,
            })
            .collect())
    }

    async fn do_genre(rp: RustyPipe, id: String) -> AppResult<GenrePage> {
        let genre = rp.query().music_genre(&id).await.map_err(yt_err)?;
        Ok(GenrePage {
            id: genre.id.clone(),
            provider: Provider::Youtube,
            title: genre.name.clone(),
            sections: genre
                .sections
                .iter()
                .map(|s| GenreSection {
                    title: s.name.clone(),
                    playlists: s.playlists.iter().map(map_playlist).collect(),
                })
                .filter(|s| !s.playlists.is_empty())
                .collect(),
            tracks: Vec::new(),
        })
    }

    async fn do_radio(rp: RustyPipe, id: String) -> AppResult<Vec<Track>> {
        let radio = rp.query().music_radio_track(&id).await.map_err(yt_err)?;
        Ok(radio
            .items
            .iter()
            .filter(|t| t.id != id)
            .map(map_track)
            .collect())
    }

    async fn do_track(rp: RustyPipe, id: String) -> AppResult<Track> {
        let details = rp.query().music_details(&id).await.map_err(yt_err)?;
        Ok(map_track(&details.track))
    }

    async fn do_lyrics(rp: RustyPipe, id: String) -> AppResult<Option<String>> {
        let q = rp.query();
        let details = q.music_details(&id).await.map_err(yt_err)?;
        let Some(lyrics_id) = details.lyrics_id.clone() else {
            return Ok(None);
        };
        let lyrics = q.music_lyrics(&lyrics_id).await.map_err(yt_err)?;
        let body = lyrics.body.trim().to_string();
        Ok(if body.is_empty() { None } else { Some(body) })
    }

    fn score(stream: &AudioStream) -> (u8, u32) {
        let opus = matches!(stream.codec, AudioCodec::Opus) && matches!(stream.format, AudioFormat::Webm);
        let aac = matches!(stream.codec, AudioCodec::Mp4a);
        let rank = if opus {
            2
        } else if aac {
            1
        } else {
            0
        };
        (rank, stream.bitrate)
    }

    async fn do_stream(rp: RustyPipe, id: String) -> AppResult<StreamSource> {
        let q = rp.query();
        let player = q.player(&id).await.map_err(yt_err)?;
        let best = player
            .audio_streams
            .iter()
            .filter(|s| s.drm_systems.is_empty() && !s.url.is_empty())
            .filter(|s| score(s).0 > 0)
            .max_by_key(|s| score(s))
            .map(|s| s.url.clone())
            .ok_or_else(|| AppError::msg("YouTube Music не отдал аудиопоток для этого трека"))?;
        let user_agent = q.user_agent(player.client_type).to_string();
        Ok(StreamSource {
            url: best,
            kind: StreamKind::Progressive,
            preview: false,
            headers: vec![("User-Agent".to_string(), user_agent)],
        })
    }

    fn botguard_path(dir: &PathBuf) -> Option<PathBuf> {
        let name = if cfg!(windows) { "rustypipe-botguard.exe" } else { "rustypipe-botguard" };
        dir.parent()
            .map(|parent| parent.join("bin").join(name))
            .filter(|path| path.is_file())
    }

    fn client_type(name: &str) -> Option<ClientType> {
        match name {
            "desktop" => Some(ClientType::Desktop),
            "desktop_music" => Some(ClientType::DesktopMusic),
            "mobile" => Some(ClientType::Mobile),
            "tv" => Some(ClientType::Tv),
            "android" => Some(ClientType::Android),
            "ios" => Some(ClientType::Ios),
            _ => None,
        }
    }

    async fn do_audio(rp: RustyPipe, id: String, client: Option<String>, itag: Option<u32>) -> AppResult<Direct> {
        let q = rp.query();
        let player = match client.as_deref().and_then(client_type) {
            Some(ct) => q.player_from_client(&id, ct).await,
            None => q.player(&id).await,
        }
        .map_err(yt_err)?;
        let usable: Vec<_> = player
            .audio_streams
            .iter()
            .filter(|s| s.drm_systems.is_empty() && !s.url.is_empty())
            .collect();
        let wanted = itag.and_then(|want| usable.iter().copied().find(|s| s.itag == want));
        let pick = match (itag, wanted) {
            (Some(want), None) => {
                return Err(AppError::msg(format!(
                    "клиент {:?} не отдал формат {want}",
                    player.client_type
                )))
            }
            (_, Some(found)) => found,
            (None, None) => usable
                .iter()
                .copied()
                .filter(|s| score(s).0 > 0)
                .max_by_key(|s| score(s))
                .ok_or_else(|| AppError::msg("YouTube Music не отдал аудиопоток для этого трека"))?,
        };
        let user_agent = q.user_agent(player.client_type).to_string();
        Ok(Direct {
            url: pick.url.clone(),
            headers: vec![("User-Agent".to_string(), user_agent)],
            itag: Some(pick.itag),
            size: Some(pick.size).filter(|s| *s > 0),
            mime: pick.mime.clone(),
            bitrate: pick.bitrate,
            via: format!("RustyPipe ({:?})", player.client_type),
        })
    }
}

#[cfg(not(feature = "rustypipe"))]
mod disabled {
    use super::*;

    pub struct YouTube;

    impl YouTube {
        pub fn new() -> Self {
            YouTube
        }
        pub fn compiled(&self) -> bool {
            false
        }
        pub fn init(&self, _dir: PathBuf, _cfg: &AppConfig) {}
        pub fn rebuild(&self, _cfg: &AppConfig) {}
        pub async fn search(&self, _q: String) -> AppResult<SearchResults> {
            Err(unavailable())
        }
        pub async fn search_tracks(&self, _q: String) -> AppResult<Vec<Track>> {
            Err(unavailable())
        }
        pub async fn artist(&self, _id: String) -> AppResult<ArtistPage> {
            Err(unavailable())
        }
        pub async fn playlist(&self, _id: String) -> AppResult<PlaylistDetails> {
            Err(unavailable())
        }
        pub async fn charts(&self, _country: Option<String>) -> AppResult<Charts> {
            Err(unavailable())
        }
        pub async fn new_releases(&self) -> AppResult<Vec<Playlist>> {
            Err(unavailable())
        }
        pub async fn genres(&self) -> AppResult<Vec<Genre>> {
            Err(unavailable())
        }
        pub async fn genre(&self, _id: String) -> AppResult<GenrePage> {
            Err(unavailable())
        }
        pub async fn radio(&self, _id: String) -> AppResult<Vec<Track>> {
            Err(unavailable())
        }
        pub async fn track(&self, _id: String) -> AppResult<Track> {
            Err(unavailable())
        }
        pub async fn lyrics(&self, _id: String) -> AppResult<Option<String>> {
            Ok(None)
        }
        pub async fn stream(&self, _id: String) -> AppResult<StreamSource> {
            Err(unavailable())
        }
        pub async fn audio(&self, _id: String, _client: Option<String>, _itag: Option<u32>) -> AppResult<Direct> {
            Err(unavailable())
        }
    }
}
