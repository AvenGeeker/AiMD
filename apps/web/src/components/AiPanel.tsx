import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as Y from 'yjs';
import { Loader2, RefreshCw, Settings2, Sparkles } from 'lucide-react';
import type { AiTodoEntry } from '@aimarkdown/shared';
import { describeError } from '../lib/api.js';
import { useAiOverview, useAnalyzeNote } from '../lib/queries.js';
import { appendAiTodosToBody, useNoteAi, writeAiTodoDone } from '../hooks/useNoteDocument.js';

export interface AiPanelProps {
  noteId: string | null;
  doc: Y.Doc | null;
  source: string;
  onOpenSettings(): void;
}

async function sha256(text: string): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  try {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', { hour12: false });
}

export function AiPanel({ noteId, doc, source, onOpenSettings }: AiPanelProps) {
  const { state, todos } = useNoteAi(doc);
  const overview = useAiOverview();
  const queryClient = useQueryClient();
  const analyze = useAnalyzeNote();
  const [bodyHash, setBodyHash] = useState<string | null>(null);
  const [insertMessage, setInsertMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void sha256(source).then((hash) => {
        if (!cancelled) setBodyHash(hash);
      });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [source]);

  useEffect(() => {
    if (!state.generatedAt) return;
    void queryClient.invalidateQueries({ queryKey: ['notes'] });
    void queryClient.invalidateQueries({ queryKey: ['tree'] });
  }, [state.generatedAt, queryClient]);

  const configured = Boolean(overview.data?.config?.enabled && overview.data.config.apiKeyConfigured);
  const busy = state.status === 'queued' || state.status === 'running' || analyze.isPending;
  const stale = Boolean(state.generatedAt && bodyHash && state.sourceHash && state.sourceHash !== bodyHash);
  const hasResult = Boolean(state.generatedAt || state.summary);

  const regenerate = () => {
    if (!noteId) return;
    if (!configured) {
      onOpenSettings();
      return;
    }
    analyze.mutate(noteId);
  };

  const insertTodos = () => {
    appendAiTodosToBody(doc, todos);
    setInsertMessage('已插入正文末尾');
    window.setTimeout(() => setInsertMessage(null), 2500);
  };

  const content = useMemo(() => {
    if (!overview.data) {
      return <div className="p-4 text-[11px] text-muted">正在读取 AI 配置…</div>;
    }
    if (!overview.data.config) {
      return (
        <div className="space-y-4 p-4 text-[11px] leading-5 text-muted">
          <p>还没有配置 AI 服务。填入 OpenAI 兼容接口或阿里云 Token Plan 后即可自动总结和打标签。</p>
          <button
            type="button"
            onClick={onOpenSettings}
            className="button-primary !min-h-8 !px-3 text-[10.5px]"
            data-testid="ai-go-settings"
          >
            <Settings2 size={13} /> 去设置
          </button>
        </div>
      );
    }
    if (!overview.data.config.enabled) {
      return (
        <div className="space-y-3 p-4 text-[11px] text-muted">
          <p>AI 功能已关闭。</p>
          <button type="button" onClick={onOpenSettings} className="text-accent underline-offset-2 hover:underline">
            在设置中启用
          </button>
        </div>
      );
    }
    if (!noteId) {
      return <div className="p-4 text-[11px] text-muted">选择一篇笔记后查看 AI 总结。</div>;
    }
    return (
      <div className="space-y-4 p-4" data-testid="ai-panel-body">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10.5px] font-semibold tracking-wide text-muted">AI 总结</div>
            {state.generatedAt && (
              <div className="mt-0.5 truncate text-[9.5px] text-muted/70">
                {formatTime(state.generatedAt)}
                {state.model ? ` · ${state.model}` : ''}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={regenerate}
            disabled={busy}
            className="button-secondary !min-h-7 !px-2.5 text-[10px]"
            data-testid="ai-regenerate"
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            {hasResult ? '重新生成' : '生成'}
          </button>
        </div>

        {state.error && (
          <div className="rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-[10.5px] leading-5 text-danger">
            {state.error}
          </div>
        )}

        {stale && (
          <div className="rounded-lg border border-warning/35 bg-warning-soft px-3 py-2 text-[10.5px] leading-5 text-warning">
            正文已变化，当前摘要可能过期。
          </div>
        )}

        {busy && !hasResult && (
          <div className="flex items-center gap-2 rounded-lg border border-border-subtle bg-hover/60 px-3 py-2.5 text-[10.5px] text-muted">
            <Loader2 size={13} className="animate-spin" /> 正在阅读笔记…
          </div>
        )}

        {state.summary && (
          <div className="rounded-xl border border-border-subtle bg-panel/45 p-3.5 text-[11.5px] leading-6 text-foreground" data-testid="ai-summary">
            {state.summary}
          </div>
        )}

        {state.keyPoints.length > 0 && (
          <div>
            <div className="mb-2 text-[10.5px] font-semibold text-muted">要点</div>
            <ul className="space-y-1.5 text-[11px] leading-5">
              {state.keyPoints.map((point, index) => (
                <li key={`${point}-${index}`} className="flex gap-1.5">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {todos.length > 0 && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10.5px] font-semibold text-muted">待办</span>
              <button
                type="button"
                onClick={insertTodos}
                className="rounded px-1.5 py-0.5 text-[10px] text-accent transition-colors hover:bg-accent-soft"
                data-testid="ai-insert-todos"
              >
                插入正文
              </button>
            </div>
            <div className="space-y-1">
              {todos.map((todo: AiTodoEntry) => (
                <label key={todo.id} className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 text-[11px] leading-5 hover:bg-hover/60">
                  <input
                    type="checkbox"
                    checked={todo.done}
                    onChange={(event) => writeAiTodoDone(doc, todo.id, event.target.checked)}
                    className="mt-1 h-3.5 w-3.5 shrink-0"
                    data-testid={`ai-todo-${todo.id}`}
                  />
                  <span className={todo.done ? 'text-muted line-through' : ''}>{todo.text}</span>
                </label>
              ))}
            </div>
            {insertMessage && <div className="mt-1 text-[11px] text-success">{insertMessage}</div>}
          </div>
        )}

        {!hasResult && !busy && !state.error && (
          <p className="text-[11px] leading-5 text-muted">输入正文后会自动生成一次；也可以点右上角“生成”。</p>
        )}

        {analyze.error && (
          <div className="text-[11px] text-danger">{describeError(analyze.error)}</div>
        )}
      </div>
    );
  }, [
    overview.data,
    noteId,
    state.generatedAt,
    state.model,
    state.error,
    state.summary,
    state.keyPoints,
    state.status,
    busy,
    hasResult,
    stale,
    todos,
    doc,
    insertMessage,
    analyze.error,
    onOpenSettings,
  ]);

  return (
    <div className="flex h-full flex-col" data-testid="ai-panel">
      <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-2.5 text-[10.5px] font-semibold text-muted">
        <Sparkles size={13} className="text-accent" />
        AI 助手
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{content}</div>
    </div>
  );
}
