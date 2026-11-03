import { useEffect, useRef, useState } from 'react';
import { BookmarkPlus, Loader2, X } from 'lucide-react';
import { describeError } from '../lib/api.js';
import { importFavoriteMedia, useSaveFavorite } from '../lib/queries.js';
import type { SharedCapture } from '../lib/shareInbox.js';
import { favoriteTitleFromUrl, firstFavoriteUrl } from '../lib/favoriteUrl.js';

interface Props {
  open: boolean;
  initial?: SharedCapture | null;
  onClose(): void;
  onSaved(noteId: string, folderId: string | null): void;
}

function manualTitle(text: string): string {
  return text.split('\n').find((line) => line.trim())?.trim().slice(0, 120) || '收藏';
}

export function FavoriteCaptureDialog({ open, initial, onClose, onSaved }: Props) {
  const save = useSaveFavorite();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoKey = useRef('');

  const finish = (noteId: string, folderId: string | null) => {
    onSaved(noteId, folderId);
    onClose();
  };

  const saveUrl = async (raw: string) => {
    const url = firstFavoriteUrl(raw) || (raw.startsWith('http') ? raw.trim() : '');
    if (!url) {
      setError('请粘贴一个 http/https 链接');
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await save.mutateAsync({
        url,
        title: favoriteTitleFromUrl(url),
        body: '',
        captureStatus: 'fetched',
        forceNew: false,
        downloadImages: true,
      });
      finish(result.note.id, result.note.folderId);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const saveText = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const result = await save.mutateAsync({
        url: null,
        platform: 'manual',
        title: manualTitle(trimmed),
        body: trimmed,
        captureStatus: 'manual',
        forceNew: false,
        downloadImages: false,
      });
      finish(result.note.id, result.note.folderId);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const saveFiles = async (files: File[], text: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await importFavoriteMedia({
        files,
        title: files[0]?.name.replace(/\.[^.]+$/, '') || '收藏媒体',
        body: text.replace(firstFavoriteUrl(text), '').trim(),
        url: firstFavoriteUrl(text) || null,
      });
      finish(result.note.id, result.note.folderId);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open) {
      setValue('');
      setBusy(false);
      setError(null);
      autoKey.current = '';
      return;
    }
    inputRef.current?.focus();
    const text = initial?.text?.trim() ?? '';
    const files = initial?.files ?? [];
    const key = `${initial?.receivedAt ?? ''}|${text}|${files.map((file) => `${file.name}:${file.size}`).join(',')}`;
    if (!text && files.length === 0) return;
    if (autoKey.current === key) return;
    autoKey.current = key;
    if (files.length > 0) {
      void saveFiles(files, text);
      return;
    }
    const url = firstFavoriteUrl(text);
    if (url) {
      setValue(url);
      void saveUrl(url);
    } else {
      void saveText(text);
    }
    // The initial payload is intentionally consumed once per dialog opening.
  }, [open, initial]);

  if (!open) return null;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <div className="favorite-quick-dialog" role="dialog" aria-label="收藏链接">
        <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
          <BookmarkPlus size={16} className="text-accent" />
          <span className="flex-1 text-sm font-semibold">收藏链接</span>
          <button type="button" className="icon-button !h-7 !w-7" onClick={onClose} disabled={busy} aria-label="关闭">
            <X size={15} />
          </button>
        </div>
        <div className="p-4">
          <div className="relative">
            <input
              ref={inputRef}
              value={value}
              disabled={busy}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void saveUrl(value);
                if (event.key === 'Escape' && !busy) onClose();
              }}
              onPaste={(event) => {
                const pasted = event.clipboardData.getData('text').trim();
                if (/^https?:\/\//i.test(pasted)) {
                  event.preventDefault();
                  setValue(pasted);
                  void saveUrl(pasted);
                }
              }}
              placeholder="粘贴链接，回车自动收藏"
              className="input-base min-h-10 w-full pr-10 text-xs"
              data-testid="favorite-url"
              autoFocus
            />
            {busy ? (
              <Loader2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-accent" />
            ) : null}
          </div>
          <div className="mt-2 text-[10.5px] leading-5 text-muted">
            {busy ? '正在解析并收藏…解析不到正文时会自动只保存网址。' : '支持小红书、抖音、公众号和任意网页。粘贴后自动保存并选择默认分类。'}
          </div>
          {error ? (
            <div className="mt-3 rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-[10.5px] text-danger">
              {error}
            </div>
          ) : null}
          <div className="mt-3 flex justify-end">
            <button type="button" className="button-primary !min-h-8 !px-3 text-[11px]" disabled={busy || !value.trim()} onClick={() => void saveUrl(value)}>
              {busy ? '收藏中…' : '收藏'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
