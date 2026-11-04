import { useState } from 'react';
import { Check, Clock3, Copy, NotebookPen } from 'lucide-react';
import { groupCapturesByDay, type QuickCaptureEntry } from '../lib/quickCaptures.js';
import { CaptureComposer } from './CaptureComposer.js';

/** Middle rail for the dedicated quick-capture view: composer on top, day-grouped list below. */

interface CaptureListProps {
  captures: QuickCaptureEntry[];
  loading: boolean;
  hasInbox: boolean;
  /** Bumped whenever an external trigger (⌘⇧Q, menu, palette) asks to capture. */
  composerSignal: number;
  onOpen(entry: QuickCaptureEntry): void;
  onSubmitCapture(text: string): Promise<void>;
}

export function CaptureList({
  captures,
  loading,
  hasInbox,
  composerSignal,
  onOpen,
  onSubmitCapture,
}: CaptureListProps) {
  const [composerOpen, setComposerOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const groups = groupCapturesByDay(captures);

  const copy = async (entry: QuickCaptureEntry) => {
    try {
      await navigator.clipboard.writeText(entry.body);
      setCopiedId(entry.id);
      window.setTimeout(() => setCopiedId((current) => (current === entry.id ? null : current)), 1000);
    } catch {
      // Clipboard can be blocked in insecure contexts; the row click still opens the note.
    }
  };

  return (
    <div className="notes-panel flex h-full flex-col" data-testid="capture-list">
      <div className="notes-header flex shrink-0 items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <NotebookPen size={14} className="text-accent" />
          <span className="text-[12px] font-semibold">速记</span>
          <span className="nav-count-chip" data-testid="capture-list-count">
            {captures.length}
          </span>
        </div>
        <button
          type="button"
          title="记一条速记"
          onClick={() => setComposerOpen(true)}
          disabled={!hasInbox}
          className="icon-button !h-7 !w-7"
          data-testid="capture-list-new"
        >
          <NotebookPen size={14} />
        </button>
      </div>

      <CaptureComposer
        open={composerOpen}
        signal={composerSignal}
        hasInbox={hasInbox}
        onSubmit={onSubmitCapture}
        onOpen={() => setComposerOpen(true)}
        onClose={() => setComposerOpen(false)}
      />

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
          <div className="empty-state pt-4" data-testid="capture-list-empty">
            <span className="empty-state-icon">
              <NotebookPen size={20} />
            </span>
            <div className="max-w-56 text-[11px] leading-5">
              还没有速记。按全局快捷键或 ⌘/Ctrl+Shift+Q 随手记一条。
            </div>
            <button type="button" onClick={() => setComposerOpen(true)} className="button-primary mt-1">
              记一条速记
            </button>
          </div>
        )}

        {groups.map((group) => (
          <section key={group.key}>
            <div className="capture-day-header" data-testid="capture-day-header">
              {group.label}
              <span className="tabular-nums opacity-70">{group.entries.length}</span>
            </div>
            {group.entries.map((entry) => (
              <div
                key={entry.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpen(entry)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onOpen(entry);
                }}
                className="capture-row group"
                data-testid="capture-item"
                title="在收集箱中打开这条速记"
              >
                <div className="flex items-center gap-1.5 text-[10.5px] text-muted/80">
                  <Clock3 size={10.5} className="shrink-0" />
                  <span className="truncate">{entry.stampLabel ?? '无时间戳'}</span>
                </div>
                <div className="mt-1.5 line-clamp-5 whitespace-pre-wrap break-words text-[11.5px] leading-5 text-foreground/90">
                  {entry.body}
                </div>
                <button
                  type="button"
                  className="capture-copy icon-button !h-6 !w-6"
                  title="复制这条速记"
                  aria-label="复制这条速记"
                  onClick={(event) => {
                    event.stopPropagation();
                    void copy(entry);
                  }}
                >
                  {copiedId === entry.id ? <Check size={12} className="text-success" /> : <Copy size={12} />}
                </button>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
