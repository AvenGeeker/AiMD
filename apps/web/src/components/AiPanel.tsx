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
      return <div className="p-3 text-xs text-muted">正在读取 AI 配置…</div>;
    }
    if (!overview.data.config) {
      return (
        <div className="space-y-3 p-3 text-xs text-muted">
          <p>还没有配置 AI 服务。填入 OpenAI 兼容接口或阿里云 Token Plan 后即可自动总结和打标签。</p>
          <button
            type="button"
            onClick={onOpenSettings}
            className="inline-flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-xs text-accent-foreground"
            data-testid="ai-go-settings"
          >
            <Settings2 size={13} /> 去设置
          </button>
        </div>
      );
    }
    if (!overview.data.config.enabled) {
      return (
        <div className="space-y-3 p-3 text-xs text-muted">
          <p>AI 功能已关闭。</p>
          <button type="button" onClick={onOpenSettings} className="text-accent underline-offset-2 hover:underline">
            在设置中启用
          </button>
        </div>
      );
    }
    if (!noteId) {
      return <div className="p-3 text-xs text-muted">选择一篇笔记后查看 AI 总结。</div>;
    }
    return (
      <div className="space-y-4 p-3" data-testid="ai-panel-body">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-muted">AI 总结</div>
            {state.generatedAt && (
              <div className="truncate text-[11px] text-muted/70">
                {formatTime(state.generatedAt)}
                {state.model ? ` · ${state.model}` : ''}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={regenerate}
            disabled={busy}
            className="flex shrink-0 items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted hover:bg-hover disabled:opacity-50"
            data-testid="ai-regenerate"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {hasResult ? '重新生成' : '生成'}
          </button>
        </div>

        {state.error && (
          <div className="rounded border border-danger/40 bg-danger/10 px-2 py-1.5 text-[11px] text-danger">
            {state.error}
          </div>
        )}

        {stale && (
          <div className="rounded border border-warning/40 bg-warning/10 px-2 py-1.5 text-[11px] text-warning">
            正文已变化，当前摘要可能过期。
          </div>
        )}

        {busy && !hasResult && (
          <div className="flex items-center gap-2 rounded border border-border bg-hover/60 px-2 py-2 text-xs text-muted">
            <Loader2 size={13} className="animate-spin" /> 正在阅读笔记…
          </div>
        )}

        {state.summary && (
          <div className="text-xs leading-5 text-foreground" data-testid="ai-summary">
            {state.summary}
          </div>
        )}

        {state.keyPoints.length > 0 && (
          <div>
            <div className="mb-1 text-[11px] font-medium text-muted">要点</div>
            <ul className="space-y-1 text-xs leading-5">
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
              <span className="text-[11px] font-medium text-muted">待办</span>
              <button
                type="button"
                onClick={insertTodos}
                className="text-[11px] text-accent hover:underline"
                data-testid="ai-insert-todos"
              >
                插入正文
              </button>
            </div>
            <div className="space-y-1">
              {todos.map((todo: AiTodoEntry) => (
                <label key={todo.id} className="flex cursor-pointer items-start gap-2 text-xs leading-5">
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
          <p className="text-xs leading-5 text-muted">输入正文后会自动生成一次；也可以点右上角“生成”。</p>
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
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs font-medium">
        <Sparkles size={14} className="text-accent" />
        AI 助手
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{content}</div>
    </div>
  );
}
