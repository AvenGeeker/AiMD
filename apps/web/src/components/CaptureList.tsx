import { Clock3, NotebookPen, Plus } from 'lucide-react';
import type { QuickCaptureEntry } from '../lib/quickCaptures.js';

/** Middle rail for the dedicated quick-capture view. */

interface CaptureListProps {
  captures: QuickCaptureEntry[];
  loading: boolean;
  hasInbox: boolean;
  onOpen(entry: QuickCaptureEntry): void;
  onCapture(): void;
}

export function CaptureList({ captures, loading, hasInbox, onOpen, onCapture }: CaptureListProps) {
  return (
    <div
      className="flex h-full w-72 shrink-0 flex-col border-r border-border bg-background"
      data-testid="capture-list"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <NotebookPen size={13} />
          速记
        </span>
        <div className="flex items-center gap-2">
          <span data-testid="capture-list-count">{captures.length}</span>
          <button
            type="button"
            title="记一条速记"
            onClick={onCapture}
            disabled={!hasInbox}
            className="rounded p-0.5 text-muted hover:bg-hover hover:text-foreground disabled:opacity-40"
            data-testid="capture-list-new"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading && captures.length === 0 && (
          <div className="p-4 text-center text-xs text-muted">正在加载速记…</div>
        )}
        {!loading && !hasInbox && (
          <div className="p-4 text-center text-xs text-muted">
            还没有收集箱笔记。重新登录后系统会自动创建。
          </div>
        )}
        {!loading && hasInbox && captures.length === 0 && (
          <div className="flex flex-col items-center gap-3 p-6 text-center" data-testid="capture-list-empty">
            <NotebookPen size={22} className="text-muted/50" />
            <div className="text-xs leading-5 text-muted">
              还没有速记。
              <br />
              按全局快捷键或 ⌘/Ctrl+Shift+Q 随手记一条。
            </div>
            <button
              type="button"
              onClick={onCapture}
              className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground"
            >
              记一条速记
            </button>
          </div>
        )}

        {captures.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => onOpen(entry)}
            className="block w-full border-b border-border/60 px-3 py-2.5 text-left hover:bg-hover focus:bg-hover focus:outline-none"
            data-testid="capture-item"
            title="在收集箱中打开这条速记"
          >
            <div className="flex items-center gap-1.5 text-[11px] text-muted/80">
              <Clock3 size={11} />
              <span>{entry.stampLabel ?? '无时间戳'}</span>
            </div>
            <div className="mt-1 line-clamp-5 whitespace-pre-wrap break-words text-xs leading-5 text-foreground/90">
              {entry.body}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
