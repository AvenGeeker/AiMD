import { useMemo } from 'react';
import { Hash } from 'lucide-react';
import { extractOutline } from '@aimarkdown/markdown';
import { countWords } from '@aimarkdown/markdown';

/** Right rail: document outline plus note statistics. */

export interface OutlineProps {
  source: string;
  createdAt?: string;
  updatedAt?: string;
  onJump?(anchorId: string): void;
  children?: React.ReactNode;
}

export interface OutlineBodyProps {
  source: string;
  createdAt?: string;
  updatedAt?: string;
  onJump?(anchorId: string): void;
}

export function OutlineBody({ source, createdAt, updatedAt, onJump }: OutlineBodyProps) {
  const outline = useMemo(() => extractOutline(source), [source]);
  const words = useMemo(() => countWords(source), [source]);
  const chars = source.length;
  const lines = source.split('\n').length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3" aria-label="文档大纲">
        {outline.length === 0 && (
          <div className="px-2 py-1 text-[11px] text-muted/70">这篇笔记还没有标题</div>
        )}
        {outline.map((entry) => (
          <button
            key={`${entry.id}-${entry.line}`}
            type="button"
            onClick={() => onJump?.(entry.id)}
            className="group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[11.5px] leading-4 text-muted-strong transition-colors hover:bg-hover hover:text-foreground"
            style={{ paddingLeft: `${(entry.level - 1) * 11 + 8}px` }}
            title={entry.text}
          >
            <Hash size={10} className="shrink-0 text-muted/45 group-hover:text-accent" />
            <span className="truncate">{entry.text}</span>
          </button>
        ))}
      </nav>

      <div className="border-t border-border-subtle px-4 py-3 text-[10.5px] text-muted">
        <div className="grid grid-cols-3 gap-2 rounded-lg border border-border-subtle bg-background/45 px-2.5 py-2">
          <div>
            <div className="text-[13px] font-semibold tabular-nums text-foreground" data-testid="word-count">
              {words}
            </div>
            <div className="mt-0.5">字数</div>
          </div>
          <div>
            <div className="text-[13px] font-semibold tabular-nums text-foreground">{chars}</div>
            <div className="mt-0.5">字符</div>
          </div>
          <div>
            <div className="text-[13px] font-semibold tabular-nums text-foreground">{lines}</div>
            <div className="mt-0.5">行数</div>
          </div>
        </div>
        {(updatedAt || createdAt) && (
          <div className="mt-2.5 space-y-1.5 px-1">
            {updatedAt && (
              <div className="flex justify-between gap-3">
                <span>修改</span>
                <span className="text-right tabular-nums text-muted-strong">
                  {new Date(updatedAt).toLocaleString('zh-CN', { hour12: false })}
                </span>
              </div>
            )}
            {createdAt && (
              <div className="flex justify-between gap-3">
                <span>创建</span>
                <span className="text-right tabular-nums text-muted-strong">
                  {new Date(createdAt).toLocaleString('zh-CN', { hour12: false })}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function Outline({ source, createdAt, updatedAt, onJump, children }: OutlineProps) {
  return (
    <aside className="inspector-panel flex h-full flex-col" data-testid="outline">
      <div className="border-b border-border-subtle px-3 py-3 text-[10.5px] font-semibold tracking-wide text-muted">
        大纲
      </div>
      <OutlineBody source={source} createdAt={createdAt} updatedAt={updatedAt} onJump={onJump} />
      {children}
    </aside>
  );
}
