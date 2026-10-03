//! Тексты песен из LRCLIB (https://lrclib.net), бесплатно и без ключа.
use serde::Deserialize;

use crate::error::AppResult;
use crate::models::Lyrics;
use crate::net::{ensure_ok, API_TIMEOUT};
use crate::state::AppState;

const BASE: &str = "https://lrclib.net/api";

#[derive(Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase", default)]
struct LrcItem {
    duration: Option<f64>,
    instrumental: Option<bool>,
    plain_lyrics: Option<String>,
    synced_lyrics: Option<String>,
}

pub async fn find(st: &AppState, artist: &str, title: &str, duration: f64) -> AppResult<Option<Lyrics>> {
    let clean_title = clean(title);
    let clean_artist = clean(artist);

    // На SoundCloud/Audius часто грузят как «Исполнитель - Название».
    let mut candidates: Vec<(String, String)> = Vec::new();
    if let Some((a, t)) = clean_title.split_once(" - ") {
        candidates.push((a.trim().to_string(), t.trim().to_string()));
    }
    candidates.push((clean_artist.clone(), clean_title.clone()));

    // Синхронизированный текст важнее обычного: обычный запоминаем и ищем дальше.
    let mut plain_only: Option<Lyrics> = None;
    for (a, t) in &candidates {
        if t.is_empty() {
            continue;
        }
        let items = search(st, &[("track_name", t.clone()), ("artist_name", a.clone())])
            .await
            .unwrap_or_default();
        if let Some(found) = choose(&items, duration) {
            if found.synced.is_some() {
                return Ok(Some(found));
            }
            plain_only.get_or_insert(found);
        }
    }

    // Лейблы и репост-каналы SoundCloud: в поле «автор» чужое имя, поэтому ищем только
    // по названию и верим лишь почти точному совпадению длительности (±2 с).
    if duration > 0.0 {
        for (_, t) in &candidates {
            if t.chars().count() < 3 || t.contains(" - ") {
                continue;
            }
            let items: Vec<LrcItem> = search(st, &[("track_name", t.clone())])
                .await
                .unwrap_or_default()
                .into_iter()
                .filter(|i| i.duration.map(|d| (d - duration).abs() <= 2.0).unwrap_or(false))
                .collect();
            if let Some(found) = choose(&items, duration) {
                if found.synced.is_some() {
                    return Ok(Some(found));
                }
                plain_only.get_or_insert(found);
            }
        }
    }
    if plain_only.is_some() {
        return Ok(plain_only);
    }

    let q = format!("{clean_artist} {clean_title}");
    let items = search(st, &[("q", q.trim().to_string())]).await?;
    Ok(choose(&items, duration))
}

async fn search(st: &AppState, query: &[(&str, String)]) -> AppResult<Vec<LrcItem>> {
    let resp = st
        .http()
        .get(format!("{BASE}/search"))
        .query(query)
        .timeout(API_TIMEOUT)
        .send()
        .await?;
    let resp = ensure_ok(resp).await?;
    Ok(resp.json().await?)
}

fn has(text: &Option<String>) -> bool {
    text.as_deref().map(|s| !s.trim().is_empty()).unwrap_or(false)
}

fn choose(items: &[LrcItem], duration: f64) -> Option<Lyrics> {
    let close = |item: &LrcItem| {
        duration <= 0.0
            || item
                .duration
                .map(|d| (d - duration).abs() <= 6.0)
                .unwrap_or(false)
    };
    let pick = items
        .iter()
        .find(|i| close(*i) && has(&i.synced_lyrics))
        .or_else(|| items.iter().find(|i| close(*i) && has(&i.plain_lyrics)))
        .or_else(|| items.iter().find(|i| has(&i.synced_lyrics)))
        .or_else(|| items.iter().find(|i| has(&i.plain_lyrics)))
        .or_else(|| items.iter().find(|i| i.instrumental.unwrap_or(false)))?;

    Some(Lyrics {
        synced: pick.synced_lyrics.clone().filter(|s| !s.trim().is_empty()),
        plain: pick.plain_lyrics.clone().filter(|s| !s.trim().is_empty()),
        instrumental: pick.instrumental.unwrap_or(false),
        source: "LRCLIB".into(),
    })
}

/// Убирает «(Official Video)», «[Free DL]», «feat. …» и лишние пробелы.
fn clean(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut depth = 0i32;
    for c in input.chars() {
        match c {
            '(' | '[' | '{' => depth += 1,
            ')' | ']' | '}' => {
                if depth > 0 {
                    depth -= 1;
                }
            }
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    let lower = out.to_ascii_lowercase();
    let cut = [" feat.", " ft.", " feat ", " prod."]
        .iter()
        .filter_map(|marker| lower.find(*marker))
        .min();
    if let Some(index) = cut {
        out.truncate(index);
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::clean;

    #[test]
    fn cleans_titles() {
        assert_eq!(clean("Song (Official Video) [HD]"), "Song");
        assert_eq!(clean("Track feat. Someone"), "Track");
        assert_eq!(clean("  A   B  "), "A B");
    }
}
