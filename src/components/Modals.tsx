import { ListMusic, Plus } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { tracksLabel } from '../lib/format';
import type { Track } from '../lib/types';
import { useLibrary } from '../store/library';
import { toast, useUi, type ModalState } from '../store/ui';
import { Mosaic } from './Mosaic';

export function ModalHost() {
  const modal = useUi((s) => s.modal);
  const close = useUi((s) => s.closeModal);
  if (!modal) return null;
  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal glass" role="dialog" aria-modal>
        <ModalBody modal={modal} close={close} />
      </div>
    </div>
  );
}

function ModalBody({ modal, close }: { modal: ModalState; close: () => void }) {
  switch (modal.kind) {
    case 'prompt':
      return <PromptModal modal={modal} close={close} />;
    case 'confirm':
      return (
        <>
          <h3 className="modal__title">{modal.title}</h3>
          <p className="modal__text">{modal.message}</p>
          <div className="modal__actions">
            <button className="btn btn--ghost" onClick={close}>
              Отмена
            </button>
            <button
              className={`btn ${modal.danger ? 'btn--danger' : 'btn--primary'}`}
              onClick={() => {
                close();
                modal.onConfirm();
              }}
            >
              {modal.confirm}
            </button>
          </div>
        </>
      );
    case 'add-to-playlist':
      return <AddToPlaylist tracks={modal.tracks} close={close} />;
  }
}

function PromptModal({ modal, close }: { modal: Extract<ModalState, { kind: 'prompt' }>; close: () => void }) {
  const [value, setValue] = useState(modal.initial ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    close();
    modal.onSubmit(value.trim());
  };
  return (
    <form onSubmit={submit}>
      <h3 className="modal__title">{modal.title}</h3>
      <input
        ref={inputRef}
        className="input"
        value={value}
        placeholder={modal.placeholder}
        onChange={(e) => setValue(e.target.value)}
        maxLength={100}
      />
      <div className="modal__actions">
        <button type="button" className="btn btn--ghost" onClick={close}>
          Отмена
        </button>
        <button type="submit" className="btn btn--primary" disabled={!value.trim()}>
          {modal.confirm}
        </button>
      </div>
    </form>
  );
}

function AddToPlaylist({ tracks, close }: { tracks: Track[]; close: () => void }) {
  const playlists = useLibrary((s) => s.playlists);
  const add = (id: string, name: string) => {
    const added = useLibrary.getState().addToPlaylist(id, tracks);
    close();
    toast(added ? `Добавлено в «${name}»` : `Уже есть в «${name}»`, added ? 'success' : 'info');
  };
  const create = () => {
    close();
    useUi.getState().openModal({
      kind: 'prompt',
      title: 'Новый плейлист',
      placeholder: 'Название плейлиста',
      confirm: 'Создать и добавить',
      onSubmit: (name) => {
        useLibrary.getState().createPlaylist(name, tracks);
        toast(`Плейлист «${name}» создан`, 'success');
      },
    });
  };
  return (
    <>
      <h3 className="modal__title">Добавить в плейлист</h3>
      <div className="modal__list">
        <button className="pl-item" onClick={create}>
          <span className="mosaic mosaic--empty mosaic--small" style={{ width: 40, height: 40 }}>
            <Plus size={18} />
          </span>
          <span className="pl-item__text">
            <span className="pl-item__name">Новый плейлист</span>
          </span>
        </button>
        {playlists.map((p) => (
          <button key={p.id} className="pl-item" onClick={() => add(p.id, p.name)}>
            <Mosaic tracks={p.tracks} size={40} />
            <span className="pl-item__text">
              <span className="pl-item__name">{p.name}</span>
              <span className="pl-item__meta">{tracksLabel(p.tracks.length)}</span>
            </span>
          </button>
        ))}
        {playlists.length === 0 && (
          <div className="modal__hint">
            <ListMusic size={16} /> У вас пока нет плейлистов
          </div>
        )}
      </div>
      <div className="modal__actions">
        <button className="btn btn--ghost" onClick={close}>
          Отмена
        </button>
      </div>
    </>
  );
}
