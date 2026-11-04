import { useEffect, useRef, useState } from 'react';
import { Check, CornerDownLeft, Loader2, NotebookPen, X } from 'lucide-react';

/**
 * Inline quick-capture composer.
 *
 * Replaces the old `window.prompt('速记内容')`: capturing stays inside the shell, supports
 * multiple lines, and reports save state where the user is looking. Submitting still goes
 * through the server capture endpoint, which appends to the inbox CRDT body.
 */

export interface CaptureComposerProps {
  open: boolean;
  /** Bumped by the app whenever something outside asks to capture (⌘⇧Q, menu, palette). */
  signal: number;
  hasInbox: boolean;
  onSubmit(text: string): Promise<void>;
  onOpen(): void;
  onClose(): void;
}

type Status = 'idle' | 'saving' | 'saved' | 'error';

export function CaptureComposer({ open, signal, hasInbox, onSubmit, onOpen, onClose }: CaptureComposerProps) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const closeTimer = useRef<number | null>(null);

  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  // An external signal (hotkey / command palette / native menu) expands and focuses the box.
  useEffect(() => {
    if (signal === 0) return;
    onOpenRef.current();
    window.setTimeout(() => textareaRef.current?.focus(), 30);
  }, [signal]);

  useEffect(() => () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  }, []);

  const collapse = () => {
    setText('');
    setStatus('idle');
    setMessage(null);
    onClose();
  };

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || status === 'saving') return;
    setStatus('saving');
    setMessage(null);
    try {
      await onSubmit(trimmed);
      setStatus('saved');
      setText('');
      closeTimer.current = window.setTimeout(collapse, 400);
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  if (!open) {
    return (
      <div className="shrink-0 px-3 pb-2 pt-3">
        <button
          type="button"
          className="composer-collapsed flex w-full items-center gap-2 rounded-lg border border-border-subtle bg-canvas/60 px-3 py-2 text-left text-[11.5px] text-muted transition-colors hover:border-border hover:text-foreground"
          onClick={onOpen}
          disabled={!hasInbox}
          data-testid="capture-composer-collapsed"
        >
          <NotebookPen size={13} className="shrink-0 text-accent" />
          <span className="flex-1 truncate">记一条速记…</span>
          <kbd className="rounded border border-border bg-background px-1.5 py-0.5 text-[9px]">⌘⇧Q</kbd>
        </button>
      </div>
    );
  }

  const rows = Math.min(10, Math.max(2, text.split('\n').length));

  return (
    <div className="shrink-0 px-3 pb-2 pt-3" data-testid="capture-composer">
      <div className="rounded-xl border border-border bg-elevated shadow-[0_10px_30px_rgba(15,20,35,0.10)] focus-within:border-[color-mix(in_srgb,var(--accent)_45%,var(--border))]">
        <textarea
          ref={textareaRef}
          value={text}
          rows={rows}
          onChange={(event) => {
            setText(event.target.value);
            if (status !== 'idle') {
              setStatus('idle');
              setMessage(null);
            }
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              void submit();
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              collapse();
            }
          }}
          placeholder="想到什么记什么，⌘/Ctrl+Enter 保存到收集箱"
          aria-label="速记内容"
          className="block w-full resize-none bg-transparent px-3 pt-2.5 text-[12px] leading-5 outline-none placeholder:text-muted/60"
          data-testid="capture-composer-input"
        />
        <div className="flex items-center gap-2 border-t border-border-subtle px-2.5 py-1.5">
          <span className="flex items-center gap-1 text-[10px] text-muted">
            <kbd className="rounded border border-border bg-background px-1 py-0.5 text-[9px]">⌘/Ctrl</kbd>
            <CornerDownLeft size={9} />
            保存
          </span>
          <span
            className={`min-w-0 flex-1 truncate text-[10px] ${
              status === 'error' ? 'text-danger' : status === 'saved' ? 'text-success' : 'text-muted/70'
            }`}
            data-testid="capture-composer-status"
          >
            {status === 'saving'
              ? '保存中…'
              : status === 'saved'
                ? '已保存'
                : status === 'error'
                  ? `保存失败：${message ?? '未知错误'}`
                  : '离线也会保存'}
          </span>
          <button
            type="button"
            className="icon-button !h-6 !w-6"
            onClick={collapse}
            aria-label="收起速记输入框"
            title="收起"
          >
            <X size={12} />
          </button>
          <button
            type="button"
            className="button-primary !min-h-7 px-2.5 text-[10.5px]"
            disabled={!text.trim() || status === 'saving'}
            onClick={() => void submit()}
            data-testid="capture-composer-submit"
          >
            {status === 'saving' ? <Loader2 size={12} className="animate-spin" /> : status === 'saved' ? <Check size={12} /> : null}
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
