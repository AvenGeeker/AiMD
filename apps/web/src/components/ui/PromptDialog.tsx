import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * In-app replacement for `window.prompt` (new folder, and any future single-field ask).
 * Enter submits, Escape cancels, empty values never submit.
 */

export interface PromptDialogProps {
  open: boolean;
  title: string;
  description?: string;
  placeholder?: string;
  initial?: string;
  submitLabel?: string;
  busy?: boolean;
  onSubmit(value: string): void | Promise<void>;
  onClose(): void;
}

export function PromptDialog({
  open,
  title,
  description,
  placeholder,
  initial = '',
  submitLabel = '创建',
  busy = false,
  onSubmit,
  onClose,
}: PromptDialogProps) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Callbacks arrive as inline arrows from the parent; keeping them in a ref stops parent
  // re-renders from re-running these effects (which would wipe the typed value).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    setValue(initial);
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    // Focus after paint so the dialog animation does not swallow the first keystroke.
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!open) return null;

  const trimmed = value.trim();
  const submit = () => {
    if (!trimmed || busy) return;
    void onSubmit(trimmed);
  };

  return (
    <div className="dialog-overlay" role="dialog" aria-modal="true" aria-label={title} data-testid="prompt-dialog">
      <form
        className="dialog-panel w-[min(400px,calc(100vw-32px))]"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="px-5 pb-4 pt-5">
          <h3 className="text-[13px] font-semibold">{title}</h3>
          {description && <p className="mt-1.5 text-[11.5px] leading-5 text-muted">{description}</p>}
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={placeholder}
            aria-label={title}
            className="input-base mt-3"
            data-testid="prompt-dialog-input"
          />
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border-subtle bg-panel/55 px-5 py-3">
          <button type="button" className="button-ghost" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="submit" className="button-primary" disabled={!trimmed || busy} data-testid="prompt-dialog-submit">
            {busy && <Loader2 size={13} className="animate-spin" />}
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
