<div align="center">

# Frost

**Музыкальный плеер для Windows 10 и 11**
YouTube Music и SoundCloud без аккаунтов и ключей, тексты песен и оформление Material You.

[![CI](https://github.com/Maminoradost/frost/actions/workflows/ci.yml/badge.svg)](https://github.com/Maminoradost/frost/actions/workflows/ci.yml)
[![Релиз](https://img.shields.io/github/v/release/Maminoradost/frost?label=%D1%80%D0%B5%D0%BB%D0%B8%D0%B7)](https://github.com/Maminoradost/frost/releases/latest)
[![Лицензия: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)
[![Telegram](https://img.shields.io/badge/Telegram-%D0%BA%D0%B0%D0%BD%D0%B0%D0%BB-2aabee?logo=telegram&logoColor=white)](https://t.me/+5N4FXvQT9C8wYjNi)

</div>

## Возможности

- **Два больших каталога.** YouTube Music (встроенный RustyPipe и yt-dlp, который Frost ставит сам) и SoundCloud. Ищет сразу в обоих, показывает чарты по странам, жанры и страницы артистов.
- **Material You.** Цвета берутся из обложки текущего трека или из выбранного оттенка. Светлая и тёмная темы, эффекты окна Windows 11: Mica, Acrylic, стекло.
- **Тексты песен.** Синхронные из LRCLIB и YouTube Music, обычные из Genius. Источник можно переключить прямо в панели текста.
- **Медиатека.** Избранное, плейлисты, очередь. Всё хранится локально.
- **Звук.** Эквалайзер, визуализатор, медиаклавиши и плитка управления Windows (Media Session), горячие клавиши.
- **Мелочи, которые приятны.** Знакомство при первом запуске, таймер сна (15–90 минут или до конца трека), уведомление о новой версии, канал в Telegram.

## Установка

1. Скачайте `Frost_<версия>_x64-setup.exe` со страницы [последнего релиза](https://github.com/Maminoradost/frost/releases/latest).
2. Запустите установщик. Установщик пока не подписан, поэтому Windows может показать SmartScreen: нажмите «Подробнее», затем «Выполнить в любом случае».
3. Frost работает на WebView2. В Windows 11 он уже есть, в Windows 10 установщик скачает его сам.

При первом запуске Frost в фоне скачает yt-dlp (около 18 МБ) с [официальной страницы проекта](https://github.com/yt-dlp/yt-dlp/releases): через него звук YouTube работает надёжнее всего. Движок YouTube можно сменить в настройках.

## Горячие клавиши

| Клавиши | Действие |
|---|---|
| Пробел | Пауза и воспроизведение |
| Ctrl + → / ← | Следующий и предыдущий трек |
| Shift + → / ← | Перемотка на 5 секунд |
| Ctrl + ↑ / ↓ | Громкость |
| M / S / R | Без звука, перемешивание, повтор |
| L | Добавить в избранное |
| Q | Очередь |
| F | Экран «Сейчас играет» |
| Ctrl + K, Ctrl + F или / | Поиск |
| Alt + ← / → | Назад и вперёд по страницам |
| Esc | Закрыть панель или окно |

Буквенные клавиши работают и в русской раскладке.

## Сборка из исходников

Понадобятся:

- Windows 10 или 11 (x64);
- [Node.js](https://nodejs.org) LTS (20 или новее);
- [Rust](https://rustup.rs) stable (1.82 или новее) и Microsoft C++ Build Tools с набором «Desktop development with C++»;
- [Bun](https://bun.sh), если хотите запускать тесты.

```powershell
git clone https://github.com/Maminoradost/frost.git
cd frost
npm ci
npm run tauri dev     # запуск в режиме разработки
npm run tauri build   # установщики: src-tauri\target\release\bundle\nsis и \msi
```

Проверки:

```powershell
npm run typecheck   # TypeScript
npm test            # тесты (Bun)
npm run check       # всё вместе
```

## Как устроено

```
src/                интерфейс: React 19, TypeScript, Zustand, Vite
  audio/            звуковой движок (Web Audio), эквалайзер, Media Session
  components/       плеер, боковая панель, знакомство, таймер сна, тексты
  lib/              SoundCloud, Genius, тексты, Material You, версии
  pages/            главная, поиск, артист, жанр, медиатека, плейлисты, настройки
  store/            состояние: плеер, медиатека, настройки, интерфейс, таймер сна
  styles/           токены Material You и стили
src-tauri/          ядро на Rust (Tauri 2)
  src/providers/    YouTube Music: RustyPipe и yt-dlp
  src/stream.rs     протокол frost://: прокси аудио с Range-запросами и HLS
  src/lyrics.rs     синхронные тексты из LRCLIB
  src/net.rs        сетевые запросы интерфейса по белому списку адресов
tests/              тесты (bun test)
```

SoundCloud целиком работает в интерфейсе (`src/lib/soundcloud.ts`), ядро даёт ему сетевой транспорт и прокси потоков. Подробности и планы: [PLAN.md](PLAN.md), история изменений: [CHANGELOG.md](CHANGELOG.md).

## Приватность

Frost не собирает статистику и не требует аккаунтов. Медиатека и настройки хранятся на компьютере: в данных WebView2 и в `%APPDATA%\app.frost.player`. Запросы уходят только к источникам музыки и текстов (YouTube, SoundCloud, LRCLIB, Genius) и к GitHub: проверка обновлений и загрузка yt-dlp.

## Лицензия

[GNU GPL v3 или новее](LICENSE). Frost использует библиотеку RustyPipe (GPL-3.0), поэтому весь проект распространяется под GPL.

Права на музыку, обложки и тексты принадлежат их авторам. Frost ничего не хранит и не распространяет: он воспроизводит то, что сервисы отдают в открытом доступе.

## Связь

Новости и обсуждение: [канал в Telegram](https://t.me/+5N4FXvQT9C8wYjNi). Ошибки и идеи: [Issues](https://github.com/Maminoradost/frost/issues).

## Возможности 0.9.1

- Мини-плеер открывается стабильно, а YouTube Music играет без заиканий: трек скачивается целиком и кешируется на диске, следующий подгружается заранее.
- Тексты песен из LRCLIB, NetEase, YouTube Music и Genius с выбором источника, сдвигом, ручным поиском и караоке-заливкой. Текст без таймкодов Frost синхронизирует сам, по голосу в треке, а при желании это можно сделать вручную Пробелом.
- Material You по канону Material 3: цвет в HCT, 9 стилей палитры с превью, три уровня контраста, тема «Как в Windows», форма, размер текста, движение и компактный режим.

## Возможности 0.9.0

- Медиатека «На компьютере» с чтением MP3, FLAC, OGG/Vorbis, Opus, M4A и WAV, тегами ID3/Vorbis/MP4/WAV, встроенными и папочными обложками.
- Журнал реального прослушивания и страница «Итоги» с периодами, топами, графиками и сериями.
- Импорт M3U/M3U8, CSV, TXT и ссылок на YouTube Music/SoundCloud.
- Discord Rich Presence, ListenBrainz, Last.fm, резервные копии, плавный переход, нормализация громкости и выбор устройства вывода.
- Радио от локальных треков, релизы артистов из подписок, перетаскивание треков и полноэкранный текст песни.

Локальные файлы не загружаются в сеть. Статистика хранится в IndexedDB на компьютере пользователя, пока он сам не добавит её в резервную копию.
