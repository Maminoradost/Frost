/**
 * Перетаскивание строк мышью (HTML5 drag and drop) и с клавиатуры: Alt+↑ / Alt+↓.
 * В Windows для этого у окна выключен системный приём файлов (dragDropEnabled: false).
 */
import { useState, type DragEvent, type KeyboardEvent } from 'react';

export interface DragItemProps {
  draggable: true;
  onDragStart: (e: DragEvent<HTMLElement>) => void;
  onDragOver: (e: DragEvent<HTMLElement>) => void;
  onDrop: (e: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  dragClass: string;
}

interface DragState {
  from: number;
  over: number;
  after: boolean;
}

/** Куда встанет элемент `from`, если бросить его перед/после `over`. */
export function dropIndex(from: number, over: number, after: boolean): number {
  let to = after ? over + 1 : over;
  if (from < to) to -= 1;
  return to;
}

export function useDragSort(count: number, onMove: (from: number, to: number) => void) {
  const [drag, setDrag] = useState<DragState | null>(null);

  const itemProps = (index: number): DragItemProps => ({
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
      setDrag({ from: index, over: index, after: false });
    },
    onDragOver: (e) => {
      if (!drag) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = e.currentTarget.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      if (drag.over !== index || drag.after !== after) setDrag({ ...drag, over: index, after });
    },
    onDrop: (e) => {
      e.preventDefault();
      if (!drag) return;
      const to = dropIndex(drag.from, index, drag.after);
      setDrag(null);
      if (to !== drag.from) onMove(drag.from, to);
    },
    onDragEnd: () => setDrag(null),
    onKeyDown: (e) => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      const to = e.key === 'ArrowUp' ? index - 1 : index + 1;
      if (to < 0 || to >= count) return;
      e.preventDefault();
      onMove(index, to);
    },
    dragClass: !drag ? '' : drag.from === index ? 'is-dragging' : drag.over === index ? (drag.after ? 'is-drop-after' : 'is-drop-before') : '',
  });

  return { itemProps, dragging: drag !== null };
}
