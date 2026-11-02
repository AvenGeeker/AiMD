import { AlertTriangle, NotebookPen, RefreshCw, ShieldCheck } from 'lucide-react';
import { APP_NAME, type AppleNotesSchedule } from '@aimarkdown/shared';
import type { AppleNotesController } from '../hooks/useAppleNotes.js';
import { ToggleSwitch } from './ui/ToggleSwitch.js';

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
    <div className="space-y-4" data-testid="apple-notes-settings">
      <div className="rounded-xl border border-border-subtle bg-panel/45 p-4">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <NotebookPen size={14} />
          </span>
          <span className="text-[11.5px] font-semibold">双向镜像</span>
          <span className="rounded-full bg-hover px-2 py-0.5 text-[9.5px] text-muted">仅此 Mac</span>
        </div>
        <p className="mt-3 text-[10.5px] leading-5 text-muted">
          {`默认 Apple 备忘录账户与 ${APP_NAME} 全库双向镜像；包含收集箱和归档，排除回收站。第一次启用会先预览，确认后才写入。`}
          同一账号只应在一台 Mac 上启用。
        </p>

        <div className="mt-4 space-y-3.5">
          <ToggleSwitch
            label="启用备忘录同步"
            checked={settings.enabled}
            disabled={controller.busy}
            onChange={(value) => void controller.setSettings({ enabled: value })}
            testId="apple-notes-enabled"
          />

          <div className="flex items-center justify-between gap-3">
            <span className="shrink-0 text-[10.5px] text-muted">同步频率</span>
            <select
              value={settings.schedule}
              disabled={!settings.enabled || controller.busy}
              onChange={(event) => void controller.setSettings({ schedule: event.target.value as AppleNotesSchedule })}
              data-testid="apple-notes-schedule"
              className="select-base min-h-8 text-[10.5px]"
            >
              {SCHEDULES.map((entry) => (
                <option key={entry.value} value={entry.value}>{entry.label}</option>
              ))}
            </select>
          </div>

          <ToggleSwitch
            label="启动时同步"
            checked={settings.syncOnLaunch}
            disabled={!settings.enabled || controller.busy}
            onChange={(value) => void controller.setSettings({ syncOnLaunch: value })}
          />
        </div>
      </div>

      <div className="rounded-xl border border-border-subtle p-3.5">
        <div className="flex items-start gap-2 text-[10.5px] leading-5">
          {status.permission === 'granted' ? (
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-success" />
          ) : (
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />
          )}
          <div className="min-w-0 flex-1">
            <span className={status.permission === 'granted' ? 'text-success' : 'text-warning'}>
              {status.permission === 'granted'
                ? '已获得备忘录自动化权限'
                : status.permission === 'denied'
                  ? '未获得备忘录自动化权限'
                  : '尚未验证自动化权限'}
            </span>
            {status.permission === 'unknown' && (
              <p className="mt-1 text-[10px] leading-4 text-muted">
                首次点击「请求授权」或「预览差异」时，macOS 才会弹出控制备忘录的授权框。
              </p>
            )}
          </div>
        </div>
        {status.permission !== 'granted' && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="button-primary !min-h-8 !px-3 text-[10px]"
              disabled={controller.busy}
              onClick={() => void controller.requestPermission()}
              data-testid="apple-notes-request-permission"
            >
              请求授权
            </button>
            <button
              type="button"
              className="button-secondary !min-h-8 !px-3 text-[10px]"
              onClick={controller.openPrivacySettings}
            >
              打开系统设置
            </button>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border-subtle bg-panel/45 p-3.5">
        <div className="mb-3 text-[11px] font-semibold">同步操作</div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="button-secondary !min-h-8 !px-3 text-[10px]"
            disabled={!settings.enabled || running}
            onClick={() => void controller.scan(false)}
            data-testid="apple-notes-preview"
          >
            预览差异
          </button>
          <button
            type="button"
            className="button-primary !min-h-8 !px-3 text-[10px]"
            disabled={!settings.enabled || running}
            onClick={() => void controller.syncNow()}
            data-testid="apple-notes-sync-now"
          >
            {running ? <RefreshCw size={12} className="animate-spin" /> : null}
            {running ? '同步中…' : '立即同步'}
          </button>
          <button
            type="button"
            className="button-secondary !min-h-8 !px-3 text-[10px]"
            disabled={!settings.enabled || running}
            onClick={() => void controller.scan(true)}
            data-testid="apple-notes-deep-scan"
          >
            深度扫描
          </button>
          {running && (
            <button
              type="button"
              className="rounded-md border border-warning/35 px-2.5 py-1 text-[10px] text-warning hover:bg-warning-soft"
              onClick={controller.cancel}
            >
              取消
            </button>
          )}
          {status.readOnlyCount > 0 && (
            <button
              type="button"
              className="button-secondary !min-h-8 !px-3 text-[10px]"
              disabled={running}
              onClick={() => void controller.recheckReadOnly()}
            >
              重新检查只读
            </button>
          )}
        </div>
      </div>

      {status.error && (
        <div className="rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-[10.5px] text-danger">
          <div>{status.error.message}</div>
          {status.error.code === 'MAPPING_REQUIRES_PREVIEW' && (
            <button
              type="button"
              className="button-secondary mt-2 !min-h-8 !px-3 text-[10px]"
              disabled={running}
              onClick={() => void controller.scan(false)}
              data-testid="apple-notes-rebuild-mapping"
            >
              预览并重新建立映射
            </button>
          )}
        </div>
      )}
      {controller.error && !status.error && (
        <div className="rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-[10.5px] text-danger">
          {controller.error}
        </div>
      )}
      {status.lastResult && (
        <div className="rounded-lg border border-border-subtle bg-panel px-3 py-2 text-[10.5px] leading-5 text-muted" data-testid="apple-notes-last-result">
          上次同步：新增 app {status.lastResult.createdAppNotes}，写回备忘录 {status.lastResult.createdAppleNotes + status.lastResult.updatedAppleNotes}，
          删除 {status.lastResult.trashedAppNotes + status.lastResult.trashedAppleNotes}，冲突 {status.lastResult.conflicts}，只读 {status.lastResult.readOnly}
          {status.lastResult.errors.length > 0 ? `，错误 ${status.lastResult.errors.length}` : ''}
        </div>
      )}
      {status.phase === 'needs-attention' && (
        <div className="rounded-lg border border-warning/35 bg-warning-soft px-3 py-2 text-[10.5px] text-warning">
          同步已暂停。请先按上面的提示处理；任何需要重建映射或超过安全阈值的写入都会先要求预览确认。
        </div>
      )}
    </div>
  );
}
