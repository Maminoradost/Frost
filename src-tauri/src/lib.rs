//! Frost: Rust-ядро.
//!
//! * `providers`: YouTube Music (RustyPipe + yt-dlp). SoundCloud работает во фронтенде
//!   через веб-API, ядро даёт ему транспорт и прокси потоков;
//! * `stream`: собственный протокол `frost://`: CORS-чистый прокси аудио с Range-запросами
//!   и переписыванием HLS-плейлистов (нужен для эквалайзера/визуализатора в WebAudio);
//! * `lyrics`: синхронизированные тексты песен (LRCLIB);
//! * `commands`: команды, доступные фронтенду через `invoke`.

mod extras;
mod commands;
mod config;
mod error;
mod lyrics;
mod models;
mod net;
mod providers;
mod state;
mod stream;
mod ytaudio;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Второй запуск просто фокусирует уже открытое окно.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::Builder::new().args(["--autostart"]).build())
        .manage(AppState::new())
        .manage(extras::Discord::default())
        .register_asynchronous_uri_scheme_protocol("frost", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                let response = stream::handle(&app, request).await;
                responder.respond(response);
            });
        })
        .setup(|app| {
            let dir = app.path().app_config_dir()?;
            app.state::<AppState>().init(dir.clone());
            // Кэш скачанного звука YouTube: в папке кэша (LocalAppData), не в настройках.
            let cache = app.path().app_cache_dir().unwrap_or(dir).join("audio");
            app.state::<AppState>().audio.init(cache);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            extras::update_install,
            extras::local_scan,
            extras::local_allow,
            extras::local_cover_save,
            extras::backup_write,
            extras::net_post,
            extras::discord_set,
            extras::discord_clear,
            extras::startup_args,
            extras::app_quit,
            extras::mini_open,
            extras::mini_close,
            commands::get_config,
            commands::set_config,
            commands::app_info,
            commands::net_fetch,
            commands::register_stream,
            commands::yt_search,
            commands::yt_search_tracks,
            commands::yt_artist,
            commands::yt_playlist,
            commands::yt_charts,
            commands::yt_new_releases,
            commands::yt_genres,
            commands::yt_genre,
            commands::yt_radio,
            commands::yt_track,
            commands::yt_stream,
            commands::get_lyrics,
            commands::ytdlp_status,
            commands::ytdlp_install,
            commands::ytdlp_update,
            commands::deno_install,
            commands::botguard_install,
            commands::botguard_remove,
            commands::yt_prefetch,
            commands::yt_cache_info,
            commands::yt_cache_clear,
            commands::yt_diagnose,
        ])
        .run(tauri::generate_context!())
        .expect("ошибка при запуске Frost");
}
