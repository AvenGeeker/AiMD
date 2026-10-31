import {
  Cloud,
  CloudOff,
  Columns2,
  Download,
  Eye,
  Loader2,
  PanelLeft,
  PanelRight,
  Pencil,
  Settings,
  ShieldAlert,
  Upload,
} from 'lucide-react';
import type { SyncStatus } from '../lib/sync.js';
import { isDesktop, platform } from '../lib/platform.js';
import type { EditorMode } from './MarkdownEditor.js';

/** Top bar: sync state, view-mode switch, rail toggles and global actions. */

export interface TitleBarProps {
  syncStatus: SyncStatus;
  pendingCount: number;
  mode: EditorMode;
  onModeChange(mode: EditorMode): void;
  sidebarVisible: boolean;
  onToggleSidebar(): void;
  outlineVisible: boolean;
  onToggleOutline(): void;
  onOpenSettings(): void;
  onExportNote(): void;
  onExportVault(): void;
  onImport(files: File[]): void;
  userName: string;
  onLogout(): void;
}

const STATUS_META: Record<SyncStatus, { label: string; icon: typeof Cloud; className: string }> = {
  connected: { label: '已同步', icon: Cloud, className: 'text-success' },
  connecting: { label: '同步中', icon: Loader2, className: 'text-muted animate-spin' },
  disconnected: { label: '离线（已本地保存）', icon: CloudOff, className: 'text-warning' },
  denied: { label: '同步被拒绝', icon: ShieldAlert, className: 'text-danger' },
};

const MODES: { value: EditorMode; label: string; icon: typeof Columns2 }[] = [
  { value: 'split', label: '分栏', icon: Columns2 },
  { value: 'edit', label: '编辑', icon: Pencil },
  { value: 'preview', label: '预览', icon: Eye },
];

export function TitleBar(props: TitleBarProps) {
  const status = STATUS_META[props.syncStatus];
  const StatusIcon = status.icon;
  // `hiddenInset` keeps the macOS traffic lights over the renderer. Reserve their corner so the
  // controls never sit underneath them; in a browser tab there is nothing to avoid.
  const macTitleBar = isDesktop() && platform() === 'darwin';

  return (
    <header
      className="titlebar-drag flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface px-3"
      data-testid="title-bar"
    >
      {macTitleBar && <div className="h-full w-[72px] shrink-0" aria-hidden />}
      <div className="flex-1" />

      <div className="titlebar-no-drag flex items-center gap-2">
        <div
          className="flex items-center gap-1.5 text-[11px]"
          title={props.pendingCount > 0 ? `${props.pendingCount} 篇待同步` : undefined}
          data-testid="sync-status"
          data-status={props.syncStatus}
        >
          <StatusIcon size={14} className={status.className} />
          <span className={status.className === 'text-muted animate-spin' ? 'text-muted' : status.className}>
            {status.label}
          </span>
        </div>

        <div className="flex items-center rounded border border-border p-0.5">
          {MODES.map((entry) => {
            const Icon = entry.icon;
            const active = props.mode === entry.value;
            return (
              <button
                key={entry.value}
                type="button"
                title={entry.label}
                onClick={() => props.onModeChange(entry.value)}
                className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] ${
                  active ? 'bg-accent text-accent-foreground' : 'text-muted hover:bg-hover'
                }`}
                data-testid={`mode-${entry.value}`}
              >
                <Icon size={13} />
                {entry.label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className={`rounded p-1.5 ${
            props.sidebarVisible ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-hover'
          }`}
          onClick={props.onToggleSidebar}
          title={props.sidebarVisible ? '隐藏左侧栏' : '显示左侧栏'}
          aria-label={props.sidebarVisible ? '隐藏左侧栏' : '显示左侧栏'}
          aria-pressed={props.sidebarVisible}
          data-testid="toggle-sidebar"
        >
          <PanelLeft size={16} />
        </button>

        <button
          type="button"
          className={`rounded p-1.5 ${
            props.outlineVisible ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-hover'
          }`}
          onClick={props.onToggleOutline}
          title={props.outlineVisible ? '隐藏大纲' : '显示大纲'}
          aria-label={props.outlineVisible ? '隐藏大纲' : '显示大纲'}
          aria-pressed={props.outlineVisible}
          data-testid="toggle-outline"
        >
          <PanelRight size={16} />
        </button>

        <label
          className="flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-[11px] text-muted hover:bg-hover"
          title="导入 Markdown / ZIP"
        >
          <Upload size={14} />
          导入
          <input
            type="file"
            multiple
            accept=".md,.markdown,.txt,.zip"
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              if (files.length > 0) props.onImport(files);
              event.target.value = '';
            }}
          />
        </label>

        <button
          type="button"
          className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-muted hover:bg-hover"
          onClick={props.onExportNote}
          title="导出当前笔记"
          data-testid="export-note"
        >
          <Download size={14} />
          导出
        </button>

        <button
          type="button"
          className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-muted hover:bg-hover"
          onClick={props.onExportVault}
          title="导出整个笔记库"
          data-testid="export-vault"
        >
          <Download size={14} />
          全部
        </button>

        <button
          type="button"
          className="rounded p-1.5 text-muted hover:bg-hover"
          onClick={props.onOpenSettings}
          title="设置"
          data-testid="open-settings"
        >
          <Settings size={16} />
        </button>

        <button
          type="button"
          className="rounded px-2 py-1 text-[11px] text-muted hover:bg-hover"
          onClick={props.onLogout}
          title="退出登录"
          data-testid="logout"
        >
          {props.userName}
        </button>
      </div>
    </header>
  );
}
