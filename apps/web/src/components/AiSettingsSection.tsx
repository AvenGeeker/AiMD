import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Sparkles, Trash2 } from 'lucide-react';
import {
  AI_DEFAULT_MODEL,
  AI_PRESET_ALIBABA,
  AI_PRESET_CUSTOM,
  ALIBABA_TOKEN_PLAN_BASE_URL,
  type AiConfigInput,
  type AiProviderPreset,
} from '@aimarkdown/shared';
import { describeError } from '../lib/api.js';
import {
  useAiOverview,
  useCancelAiJob,
  useDeleteAiConfig,
  useSaveAiConfig,
  useStartBackfill,
  useTestAiConfig,
} from '../lib/queries.js';

interface Draft {
  enabled: boolean;
  preset: AiProviderPreset;
  baseUrl: string;
  model: string;
  apiKey: string;
}

const EMPTY_DRAFT: Draft = {
  enabled: false,
  preset: AI_PRESET_ALIBABA,
  baseUrl: ALIBABA_TOKEN_PLAN_BASE_URL,
  model: AI_DEFAULT_MODEL,
  apiKey: '',
};

export function AiSettingsSection() {
  const overview = useAiOverview();
  const save = useSaveAiConfig();
  const remove = useDeleteAiConfig();
  const test = useTestAiConfig();
  const backfill = useStartBackfill();
  const cancel = useCancelAiJob();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const config = overview.data?.config;
  useEffect(() => {
    if (config) {
      setDraft({
        enabled: config.enabled,
        preset: config.preset,
        baseUrl: config.baseUrl,
        model: config.model,
        apiKey: '',
      });
    }
  }, [config?.enabled, config?.preset, config?.baseUrl, config?.model]);

  const activeBackfill =
    overview.data?.activeJob?.kind === 'backfill'
      ? overview.data.activeJob
      : overview.data?.lastJob?.kind === 'backfill' &&
          (overview.data.lastJob.status === 'running' || overview.data.lastJob.status === 'queued')
        ? overview.data.lastJob
        : null;

  const setPreset = (preset: AiProviderPreset) => {
    setDraft((prev) => ({
      ...prev,
      preset,
      ...(preset === AI_PRESET_ALIBABA
        ? { baseUrl: ALIBABA_TOKEN_PLAN_BASE_URL, model: AI_DEFAULT_MODEL }
        : prev.baseUrl === ALIBABA_TOKEN_PLAN_BASE_URL
          ? { baseUrl: '', model: '' }
          : {}),
    }));
  };

  const saveConfig = async () => {
    setError(null);
    setMessage(null);
    try {
      const input: AiConfigInput = {
        enabled: draft.enabled,
        preset: draft.preset,
        baseUrl: draft.baseUrl.trim(),
        model: draft.model.trim(),
        ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
      };
      await save.mutateAsync(input);
      setDraft((prev) => ({ ...prev, apiKey: '' }));
      setMessage('AI 配置已保存');
    } catch (caught) {
      setError(describeError(caught));
    }
  };

  const testConnection = async () => {
    setError(null);
    setMessage(null);
    try {
      const result = await test.mutateAsync({
        preset: draft.preset,
        baseUrl: draft.baseUrl.trim(),
        model: draft.model.trim(),
        ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
      });
      if (result.ok) setMessage(`连接成功（${result.latencyMs}ms）`);
      else setError(result.message ?? '连接失败');
    } catch (caught) {
      setError(describeError(caught));
    }
  };

  const startBackfill = async () => {
    const confirmed = window.confirm(
      '回填会逐篇调用 AI，可能消耗较多 Token。个人版 Token Plan 可能限制后端或批量调用，请确认套餐允许后再继续。是否开始？',
    );
    if (!confirmed) return;
    setError(null);
    try {
      await backfill.mutateAsync();
      setMessage('回填任务已开始');
    } catch (caught) {
      setError(describeError(caught));
    }
  };

  const deleteConfig = async () => {
    if (!window.confirm('清空 AI 配置和已保存的 API Key？')) return;
    setError(null);
    try {
      await remove.mutateAsync();
      setDraft(EMPTY_DRAFT);
      setMessage('AI 配置已清空');
    } catch (caught) {
      setError(describeError(caught));
    }
  };

  return (
    <div className="border-t border-border pt-3" data-testid="ai-settings">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted">
        <Sparkles size={13} /> AI 助手
      </div>

      {(error || message) && (
        <div
          className={`mb-2 rounded border px-2 py-1.5 text-[11px] ${
            error ? 'border-danger/40 bg-danger/10 text-danger' : 'border-success/40 bg-success/10 text-success'
          }`}
        >
          {error ?? message}
        </div>
      )}

      <label className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs">启用 AI 总结与自动标签</span>
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(event) => setDraft((prev) => ({ ...prev, enabled: event.target.checked }))}
          className="h-4 w-4"
          data-testid="ai-enabled"
        />
      </label>

      <div className="space-y-2">
        <label className="flex items-center justify-between gap-3">
          <span className="shrink-0 text-xs text-muted">服务预设</span>
          <select
            value={draft.preset}
            onChange={(event) => setPreset(event.target.value as AiProviderPreset)}
            className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
            data-testid="ai-preset"
          >
            <option value={AI_PRESET_ALIBABA}>阿里云 Token Plan</option>
            <option value={AI_PRESET_CUSTOM}>自定义 OpenAI 兼容</option>
          </select>
        </label>

        <label className="flex items-center justify-between gap-3">
          <span className="shrink-0 text-xs text-muted">Base URL</span>
          <input
            value={draft.baseUrl}
            onChange={(event) => setDraft((prev) => ({ ...prev, baseUrl: event.target.value }))}
            placeholder="https://.../v1"
            className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
            data-testid="ai-base-url"
          />
        </label>

        <label className="flex items-center justify-between gap-3">
          <span className="shrink-0 text-xs text-muted">模型</span>
          <input
            value={draft.model}
            onChange={(event) => setDraft((prev) => ({ ...prev, model: event.target.value }))}
            placeholder="qwen3.7-plus"
            className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
            data-testid="ai-model"
          />
        </label>

        <label className="flex items-center justify-between gap-3">
          <span className="shrink-0 text-xs text-muted">API Key</span>
          <input
            type="password"
            value={draft.apiKey}
            onChange={(event) => setDraft((prev) => ({ ...prev, apiKey: event.target.value }))}
            placeholder={config?.apiKeyConfigured ? `已保存 ${config.apiKeyHint}，留空不修改` : 'sk-…'}
            autoComplete="off"
            className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
            data-testid="ai-api-key"
          />
        </label>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => void saveConfig()}
          disabled={save.isPending}
          className="rounded bg-accent px-2.5 py-1 text-[11px] font-medium text-accent-foreground disabled:opacity-50"
          data-testid="ai-save"
        >
          {save.isPending ? '保存中…' : '保存配置'}
        </button>
        <button
          type="button"
          onClick={() => void testConnection()}
          disabled={test.isPending}
          className="flex items-center gap-1 rounded border border-border px-2.5 py-1 text-[11px] text-muted hover:bg-hover disabled:opacity-50"
          data-testid="ai-test"
        >
          {test.isPending && <Loader2 size={11} className="animate-spin" />}
          测试连接
        </button>
        {config && (
          <button
            type="button"
            onClick={() => void deleteConfig()}
            className="ml-auto flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted hover:text-danger"
            data-testid="ai-clear"
          >
            <Trash2 size={11} /> 清空
          </button>
        )}
      </div>

      <div className="mt-3 rounded border border-warning/40 bg-warning/10 px-2 py-1.5 text-[11px] leading-5 text-warning">
        <div className="flex items-start gap-1.5">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            个人版 Token Plan 可能不允许自定义后端或批量调用；回填请确认套餐授权并注意额度。
          </span>
        </div>
      </div>

      <div className="mt-3 space-y-2 border-t border-border pt-3">
        <div className="flex items-center justify-between text-[11px] text-muted">
          <span>未打标签：{overview.data?.counts.untaggedNotes ?? 0}</span>
          <span>缺摘要：{overview.data?.counts.missingSummaryNotes ?? 0}</span>
        </div>
        <div className="flex items-center justify-between text-[11px] text-muted">
          <span>待回填：{overview.data?.counts.pendingNotes ?? 0}</span>
          <span>已处理：{activeBackfill?.completed ?? 0}/{activeBackfill?.total ?? 0}</span>
        </div>
        {activeBackfill && (
          <div className="h-1.5 overflow-hidden rounded bg-hover">
            <div
              className="h-full bg-accent transition-all"
              style={{
                width: `${activeBackfill.total > 0 ? Math.min(100, (activeBackfill.completed / activeBackfill.total) * 100) : 0}%`,
              }}
            />
          </div>
        )}
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => void startBackfill()}
            disabled={Boolean(activeBackfill) || backfill.isPending || !config?.enabled}
            className="flex-1 rounded border border-border px-2 py-1 text-[11px] text-muted hover:bg-hover disabled:opacity-40"
            data-testid="ai-backfill"
          >
            回填未处理笔记
          </button>
          {activeBackfill && (
            <button
              type="button"
              onClick={() => void cancel.mutateAsync(activeBackfill.id)}
              disabled={cancel.isPending}
              className="rounded border border-danger/40 px-2 py-1 text-[11px] text-danger hover:bg-danger/10 disabled:opacity-40"
              data-testid="ai-cancel-backfill"
            >
              取消
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
