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
    <div className="notes-panel flex h-full flex-col" data-testid="capture-list">
      <div className="notes-header flex shrink-0 items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <NotebookPen size={14} className="text-accent" />
          <span className="text-[12px] font-semibold">速记</span>
          <span className="text-[10.5px] tabular-nums text-muted" data-testid="capture-list-count">
            {captures.length}
          </span>
        </div>
        <button
          type="button"
          title="记一条速记"
          onClick={onCapture}
          disabled={!hasInbox}
          className="icon-button !h-7 !w-7"
          data-testid="capture-list-new"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && captures.length === 0 && (
          <div className="p-5 text-center text-[11px] text-muted">正在加载速记…</div>
        )}
        {!loading && !hasInbox && (
          <div className="empty-state pt-8">
            <span className="empty-state-icon">
              <NotebookPen size={19} />
            </span>
            <div className="max-w-52 text-[11px] leading-5">
              还没有收集箱笔记。重新登录后系统会自动创建。
            </div>
          </div>
        )}
        {!loading && hasInbox && captures.length === 0 && (
          <div className="empty-state pt-8" data-testid="capture-list-empty">
            <span className="empty-state-icon">
              <NotebookPen size={20} />
            </span>
            <div className="max-w-56 text-[11px] leading-5">
              还没有速记。按全局快捷键或 ⌘/Ctrl+Shift+Q 随手记一条。
            </div>
            <button type="button" onClick={onCapture} className="button-primary mt-1">
              <Plus size={14} />
              记一条速记
            </button>
          </div>
        )}

        {captures.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => onOpen(entry)}
            className="block w-full border-b border-border-subtle/70 px-4 py-3 text-left transition-colors hover:bg-hover focus:bg-hover focus:outline-none"
            data-testid="capture-item"
            title="在收集箱中打开这条速记"
          >
            <div className="flex items-center gap-1.5 text-[10.5px] text-muted/80">
              <Clock3 size={10.5} />
              <span>{entry.stampLabel ?? '无时间戳'}</span>
            </div>
            <div className="mt-1.5 line-clamp-5 whitespace-pre-wrap break-words text-[11.5px] leading-5 text-foreground/90">
              {entry.body}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
