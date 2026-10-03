import { FileUp, Link2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { matchImport, importFromUrl } from '../lib/import';
import { parsePlaylistFile, playlistNameFromFile, type ImportItem } from '../lib/importer';
import type { Track } from '../lib/types';
import { useLibrary } from '../store/library';
import { toast, useUi } from '../store/ui';

/**
 * Импорт плейлиста: ссылка YouTube Music / SoundCloud или файл M3U, CSV, TXT.
 * Для Spotify и Яндекс Музыки подойдёт CSV из Exportify или TuneMyMusic.
 */
export function ImportPanel({ onClose }: { onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const cancel = useRef({ cancelled: false });
  const [link, setLink] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [missing, setMissing] = useState<ImportItem[]>([]);
  const busy = progress !== null;

  const finish = (title: string, tracks: Track[], notFound: ImportItem[] = []) => {
    setProgress(null);
    setMissing(notFound);
    if (!tracks.length) {
      toast('Не нашлось ни одного трека', 'error');
      return;
    }
    const id = useLibrary.getState().createPlaylist(title, tracks);
    toast(notFound.length ? `«${title}»: найдено ${tracks.length} из ${tracks.length + notFound.length}` : `«${title}»: ${tracks.length} треков`, 'success', {
      label: 'Открыть',
      onClick: () => useUi.getState().navigate({ name: 'local-playlist', id }),
    });
    if (!notFound.length) onClose();
  };

  const fromLink = async () => {
    setProgress({ done: 0, total: 0 });
    try {
      const res = await importFromUrl(link);
      if (!res) {
        setProgress(null);
        toast('Ссылка не распознана. Подходят плейлисты и альбомы YouTube Music и SoundCloud', 'error');
        return;
      }
      setLink('');
      finish(res.title, res.tracks);
    } catch (e) {
      setProgress(null);
      toast(`Не удалось открыть ссылку: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  };

  const fromFile = async (file: File) => {
    const items = parsePlaylistFile(file.name, new Uint8Array(await file.arrayBuffer()));
    if (!items.length) {
      toast('В файле не нашлось треков', 'error');
      return;
    }
    cancel.current = { cancelled: false };
    setMissing([]);
    setProgress({ done: 0, total: items.length });
    const res = await matchImport(items, (done, total) => setProgress({ done, total }), cancel.current);
    if (cancel.current.cancelled) {
      setProgress(null);
      return;
    }
    finish(playlistNameFromFile(file.name), res.tracks, res.missing);
  };

  return (
    <section className="import-panel" aria-label="Импорт плейлиста">
      <div className="import-panel__head">
        <h2 className="section__title">Импорт плейлиста</h2>
        <button className="icon-btn icon-btn--xs" onClick={onClose} aria-label="Закрыть импорт">
          <X size={16} />
        </button>
      </div>
      <div className="import-panel__row">
        <label className="import-panel__link">
          <Link2 size={16} aria-hidden />
          <input
            className="input"
            value={link}
            disabled={busy}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && link.trim() && void fromLink()}
            placeholder="Ссылка на плейлист YouTube Music или SoundCloud"
            aria-label="Ссылка на плейлист"
          />
        </label>
        <button className="btn btn--primary" disabled={busy || !link.trim()} onClick={() => void fromLink()}>
          Добавить
        </button>
        <button className="btn btn--ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
          <FileUp size={16} /> Из файла
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".m3u,.m3u8,.csv,.tsv,.txt"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void fromFile(f);
          }}
        />
      </div>
      <p className="setting-row__desc">
        Файлы M3U и M3U8, CSV (например, из Exportify или TuneMyMusic для Spotify и Яндекс Музыки) и текст в виде строк «Артист - Название».
        Старые файлы в кодировке Windows-1251 тоже подходят.
      </p>
      {progress && progress.total > 0 && (
        <div className="scan-progress" role="status">
          <div className="scan-progress__bar">
            <div style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
          </div>
          <span>
            Ищу треки: {progress.done} из {progress.total}
          </span>
          <button className="btn btn--ghost btn--sm" onClick={() => (cancel.current.cancelled = true)}>
            Отмена
          </button>
        </div>
      )}
      {missing.length > 0 && (
        <details className="import-panel__missing">
          <summary>Не найдено: {missing.length}</summary>
          <ul>
            {missing.slice(0, 200).map((m, i) => (
              <li key={i}>{m.artist ? `${m.artist} - ${m.title}` : m.title}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
