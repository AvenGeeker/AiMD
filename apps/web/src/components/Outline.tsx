import { useMemo } from 'react';
import { extractOutline } from '@aimarkdown/markdown';
import { countWords } from '@aimarkdown/markdown';

/** Right rail: document outline plus note statistics. */

export interface OutlineProps {
  source: string;
  createdAt?: string;
  updatedAt?: string;
  onJump?(anchorId: string): void;
  /** Optional tag editor rendered beneath the statistics. */
  children?: React.ReactNode;
}

export function Outline({ source, createdAt, updatedAt, onJump, children }: OutlineProps) {
  const outline = useMemo(() => extractOutline(source), [source]);
  const words = useMemo(() => countWords(source), [source]);
  const chars = source.length;
  const lines = source.split('\n').length;

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-l border-border bg-surface" data-testid="outline">
      <div className="border-b border-border px-3 py-2 text-[11px] uppercase tracking-wide text-muted">大纲</div>
      <nav className="min-h-0 flex-1 overflow-auto p-2">
        {outline.length === 0 && <div className="px-1 text-xs text-muted/70">暂无标题</div>}
        {outline.map((entry) => (
          <button
            key={`${entry.id}-${entry.line}`}
            type="button"
            onClick={() => onJump?.(entry.id)}
            className="block w-full truncate rounded px-1 py-0.5 text-left text-xs text-muted hover:bg-hover hover:text-foreground"
            style={{ paddingLeft: `${(entry.level - 1) * 10 + 4}px` }}
            title={entry.text}
          >
            {entry.text}
          </button>
        ))}
      </nav>
      <div className="border-t border-border px-3 py-2 text-[11px] text-muted">
        <div className="flex justify-between">
          <span>字数</span>
          <span data-testid="word-count">{words}</span>
        </div>
        <div className="flex justify-between">
          <span>字符</span>
          <span>{chars}</span>
        </div>
        <div className="flex justify-between">
          <span>行数</span>
          <span>{lines}</span>
        </div>
        {updatedAt && (
          <div className="mt-1 flex justify-between">
            <span>修改</span>
            <span>{new Date(updatedAt).toLocaleString('zh-CN', { hour12: false })}</span>
          </div>
        )}
        {createdAt && (
          <div className="flex justify-between">
            <span>创建</span>
            <span>{new Date(createdAt).toLocaleString('zh-CN', { hour12: false })}</span>
          </div>
        )}
      </div>
      {children}
    </aside>
  );
}
