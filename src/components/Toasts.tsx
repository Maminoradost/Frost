import { Check, CircleAlert, Info } from 'lucide-react';
import { useUi } from '../store/ui';

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast glass toast--${t.kind}`} role="status" onClick={() => dismiss(t.id)}>
          {t.kind === 'error' ? <CircleAlert size={16} /> : t.kind === 'success' ? <Check size={16} /> : <Info size={16} />}
          <span className="toast__text">{t.text}</span>
          {t.action && (
            <button
              className="toast__action"
              onClick={(e) => {
                e.stopPropagation();
                t.action?.onClick();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
