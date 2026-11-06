import { useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, Link2, Loader2 } from 'lucide-react';
import { describeError } from '../lib/api.js';
import { openExternalUrl } from '../lib/desktop.js';
import { useNoteShare, useSetNoteShare } from '../lib/queries.js';
import { ToggleSwitch } from './ui/ToggleSwitch.js';

/**
 * Per-note public link control.
 *
 * The URL is a capability: anyone holding it can read the note. Closing the dialog does not
 * change anything; the toggle is the only mutation and the server response is authoritative.
 */

export interface ShareDialogProps {
  open: boolean;
  noteId: string | null;
  onClose(): void;
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement('textarea');
  input.value = value;
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  document.execCommand('copy');
  input.remove();
}

export function ShareDialog({ open, noteId, onClose }: ShareDialogProps) {
  const share = useNoteShare(noteId, open);
  const setShare = useSetNoteShare();
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    setActionError(null);
    setCopied(false);
    const timer = window.setTimeout(() => closeRef.current?.focus(), 30);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, noteId]);

  if (!open || !noteId) return null;

  const data = share.data;
  const enabled = data?.enabled ?? false;
  const busy = setShare.isPending;
  const url = data?.url ?? '';

  const toggle = async (next: boolean) => {
    setActionError(null);
    setCopied(false);
    try {
      await setShare.mutateAsync({ id: noteId, enabled: next });
    } catch (error) {
      setActionError(describeError(error));
    }
  };

  const copy = async () => {
    if (!url) return;
    try {
      await copyText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setActionError('复制失败，请手动选中链接复制');
    }
  };

  const openLink = async () => {
    if (!url) return;
    try {
      const opened = await openExternalUrl(url);
      if (!opened) setActionError('无法打开浏览器，请复制链接后手动打开');
    } catch {
      setActionError('无法打开浏览器，请复制链接后手动打开');
    }
  };

  return (
    <div className="dialog-overlay" role="dialog" aria-modal="true" aria-label="分享笔记" data-testid="share-dialog">
      <div className="dialog-panel w-[min(480px,calc(100vw-32px))]">
        <div className="flex items-start gap-3 px-5 pb-4 pt-5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Link2 size={17} />
          </span>
          <div className="min-w-0">
            <h3 className="text-[13px] font-semibold">分享笔记</h3>
            <p className="mt-1.5 text-[11.5px] leading-5 text-muted">
              开启后生成一个公开链接。任何拿到链接的人都能查看这篇笔记，无需登录。
            </p>
          </div>
        </div>

        <div className="space-y-3 border-t border-border-subtle px-5 py-4">
          {share.isLoading ? (
            <div className="flex items-center gap-2 text-[11.5px] text-muted" data-testid="share-loading">
              <Loader2 size={14} className="animate-spin" /> 正在读取分享状态…
            </div>
          ) : share.isError ? (
            <div className="rounded-xl bg-danger-soft px-3 py-2 text-[11.5px] text-danger">
              读取分享状态失败：{describeError(share.error)}
              <button type="button" className="ml-2 underline" onClick={() => void share.refetch()}>
                重试
              </button>
            </div>
          ) : (
            <>
              <ToggleSwitch
                label="公开分享"
                checked={enabled}
                disabled={busy}
                onChange={(next) => void toggle(next)}
                testId="share-toggle"
              />

              {enabled ? (
                <div className="space-y-2" data-testid="share-link-area">
                  <label className="block text-[11px] font-medium text-muted" htmlFor="share-url">
                    分享链接
                  </label>
                  <input
                    id="share-url"
                    value={url}
                    readOnly
                    className="input-base font-mono text-[11px]"
                    onFocus={(event) => event.currentTarget.select()}
                    data-testid="share-url"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => void copy()}
                      data-testid="share-copy"
                    >
                      {copied ? <Check size={13} /> : <Copy size={13} />}
                      {copied ? '已复制' : '复制链接'}
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => void openLink()}
                      data-testid="share-open"
                    >
                      <ExternalLink size={13} />
                      打开链接
                    </button>
                  </div>
                </div>
              ) : null}

              <p className="text-[11px] leading-5 text-muted">
                关闭分享后链接立即失效；再次开启会生成全新链接，旧链接不会恢复。
              </p>
            </>
          )}

          {actionError ? (
            <div className="rounded-xl bg-danger-soft px-3 py-2 text-[11.5px] text-danger" data-testid="share-error">
              {actionError}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border-subtle bg-panel/55 px-5 py-3">
          <button ref={closeRef} type="button" className="button-ghost" onClick={onClose} data-testid="share-close">
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
