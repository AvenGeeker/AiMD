import { AlertTriangle, NotebookPen, RefreshCw, ShieldCheck } from 'lucide-react';
import type { AppleNotesSchedule } from '@aimarkdown/shared';
import type { AppleNotesController } from '../hooks/useAppleNotes.js';

const SCHEDULES: Array<{ value: AppleNotesSchedule; label: string }> = [
  { value: 'off', label: '手动' },
  { value: '15m', label: '15 分钟' },
  { value: '30m', label: '30 分钟' },
  { value: '1h', label: '1 小时' },
  { value: '6h', label: '6 小时' },
  { value: 'daily', label: '每天' },
];

export function AppleNotesSettingsSection({ controller }: { controller: AppleNotesController }) {
  const status = controller.status;
  if (!controller.available) return null;
  if (!status) {
    return <div className="text-xs text-muted">正在读取备忘录同步状态…</div>;
  }
  const settings = status.settings;
  const running = status.running || controller.busy;

  return (
    <div className="space-y-2 rounded border border-border bg-background/40 p-3" data-testid="apple-notes-settings">
      <div className="flex items-center gap-2">
        <NotebookPen size={15} className="text-accent" />
        <span className="text-xs font-semibold">macOS 备忘录同步</span>
        <span className="rounded bg-hover px-1.5 py-0.5 text-[10px] text-muted">仅此 Mac</span>
      </div>
      <p className="text-[11px] leading-4 text-muted">
        默认 Apple 备忘录账户与 aiMarkdown 全库双向镜像；包含收集箱和归档，排除回收站。第一次启用会先预览，确认后才写入。
        同一账号只应在一台 Mac 上启用。
      </p>

      <label className="flex items-center justify-between gap-3">
        <span className="text-xs">启用备忘录同步</span>
        <input
          type="checkbox"
          checked={settings.enabled}
          disabled={controller.busy}
          onChange={(event) => void controller.setSettings({ enabled: event.target.checked })}
          data-testid="apple-notes-enabled"
          className="h-4 w-4"
        />
      </label>

      <div className="flex items-center justify-between gap-3">
        <span className="shrink-0 text-xs text-muted">同步频率</span>
        <select
          value={settings.schedule}
          disabled={!settings.enabled || controller.busy}
          onChange={(event) => void controller.setSettings({ schedule: event.target.value as AppleNotesSchedule })}
          data-testid="apple-notes-schedule"
          className="rounded border border-border bg-surface px-2 py-1 text-xs"
        >
          {SCHEDULES.map((entry) => (
            <option key={entry.value} value={entry.value}>{entry.label}</option>
          ))}
        </select>
      </div>

      <label className="flex items-center justify-between gap-3">
        <span className="text-xs">启动时同步</span>
        <input
          type="checkbox"
          checked={settings.syncOnLaunch}
          disabled={!settings.enabled || controller.busy}
          onChange={(event) => void controller.setSettings({ syncOnLaunch: event.target.checked })}
          className="h-4 w-4"
        />
      </label>

      <div className="flex items-center gap-1.5 text-[11px]">
        {status.permission === 'granted' ? (
          <ShieldCheck size={13} className="text-success" />
        ) : (
          <AlertTriangle size={13} className="text-warning" />
        )}
        <span className={status.permission === 'granted' ? 'text-success' : 'text-warning'}>
          {status.permission === 'granted'
            ? '已获得备忘录自动化权限'
            : status.permission === 'denied'
              ? '未获得备忘录自动化权限'
              : '尚未验证自动化权限'}
        </span>
        {status.permission !== 'granted' && (
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              className="rounded bg-accent px-2 py-0.5 text-[10px] text-accent-foreground disabled:opacity-50"
              disabled={controller.busy}
              onClick={() => void controller.requestPermission()}
              data-testid="apple-notes-request-permission"
            >
              请求授权
            </button>
            <button
              type="button"
              className="rounded border border-border px-2 py-0.5 text-[10px] hover:bg-hover"
              onClick={controller.openPrivacySettings}
            >
              打开系统设置
            </button>
          </div>
        )}
      </div>
      {status.permission === 'unknown' && (
        <p className="text-[10px] leading-4 text-muted">
          首次点击「请求授权」或「预览差异」时，macOS 才会弹出控制备忘录的授权框；授权前系统设置的自动化列表里不会出现 aiMarkdown。
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <button
          type="button"
          className="rounded border border-border px-2 py-1 text-[11px] hover:bg-hover"
          disabled={!settings.enabled || running}
          onClick={() => void controller.scan(false)}
          data-testid="apple-notes-preview"
        >
          预览差异
        </button>
        <button
          type="button"
          className="flex items-center gap-1 rounded bg-accent px-2 py-1 text-[11px] text-accent-foreground disabled:opacity-50"
          disabled={!settings.enabled || running}
          onClick={() => void controller.syncNow()}
          data-testid="apple-notes-sync-now"
        >
          {running ? <RefreshCw size={12} className="animate-spin" /> : null}
          {running ? '同步中…' : '立即同步'}
        </button>
        <button
          type="button"
          className="rounded border border-border px-2 py-1 text-[11px] hover:bg-hover"
          disabled={!settings.enabled || running}
          onClick={() => void controller.scan(true)}
          data-testid="apple-notes-deep-scan"
        >
          深度扫描
        </button>
        {running && (
          <button
            type="button"
            className="rounded border border-warning/50 px-2 py-1 text-[11px] text-warning hover:bg-warning/10"
            onClick={controller.cancel}
          >
            取消
          </button>
        )}
        {status.readOnlyCount > 0 && (
          <button
            type="button"
            className="rounded border border-border px-2 py-1 text-[11px] hover:bg-hover"
            disabled={running}
            onClick={() => void controller.recheckReadOnly()}
          >
            重新检查只读
          </button>
        )}
      </div>

      {status.error && (
        <div className="rounded border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] text-danger">
          {status.error.message}
        </div>
      )}
      {controller.error && !status.error && (
        <div className="rounded border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] text-danger">
          {controller.error}
        </div>
      )}
      {status.lastResult && (
        <div className="rounded border border-border bg-surface px-2 py-1 text-[11px] text-muted" data-testid="apple-notes-last-result">
          上次同步：新增 app {status.lastResult.createdAppNotes}，写回备忘录 {status.lastResult.createdAppleNotes + status.lastResult.updatedAppleNotes}，
          删除 {status.lastResult.trashedAppNotes + status.lastResult.trashedAppleNotes}，冲突 {status.lastResult.conflicts}，只读 {status.lastResult.readOnly}
          {status.lastResult.errors.length > 0 ? `，错误 ${status.lastResult.errors.length}` : ''}
        </div>
      )}
      {status.phase === 'needs-attention' && (
        <div className="rounded border border-warning/40 bg-warning/10 px-2 py-1 text-[11px] text-warning">
          同步已暂停。请先预览并确认，或处理上面的权限/删除阈值问题。
        </div>
      )}
    </div>
  );
}
