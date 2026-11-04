import { useEffect, useRef } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

/**
 * In-app replacement for `window.confirm`. Native confirm blocks the renderer thread and looks
 * nothing like the rest of the shell, which breaks the flow of quick operations.
 */

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm(): void | Promise<void>;
  onClose(): void;
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = '确认',
  cancelLabel = '取消',
  danger = false,
  busy = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div className="dialog-overlay" role="dialog" aria-modal="true" aria-label={title} data-testid="confirm-dialog">
      <div className="dialog-panel w-[min(400px,calc(100vw-32px))]">
        <div className="flex items-start gap-3 px-5 pb-4 pt-5">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
              danger ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent'
            }`}
          >
            <AlertTriangle size={16} />
          </span>
          <div className="min-w-0">
            <h3 className="text-[13px] font-semibold">{title}</h3>
            {body && <p className="mt-1.5 text-[11.5px] leading-5 text-muted">{body}</p>}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border-subtle bg-panel/55 px-5 py-3">
          <button type="button" className="button-ghost" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`button-primary ${danger ? '!bg-danger !border-danger' : ''}`}
            disabled={busy}
            onClick={() => void onConfirm()}
            data-testid="confirm-dialog-confirm"
          >
            {busy && <Loader2 size={13} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
