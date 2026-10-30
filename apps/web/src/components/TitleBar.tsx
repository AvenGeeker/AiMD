import {
  Cloud,
  CloudOff,
  Columns2,
  Download,
  Eye,
  Loader2,
  Pencil,
  Settings,
  ShieldAlert,
  Upload,
} from 'lucide-react';
import type { SyncStatus } from '../lib/sync.js';
import type { EditorMode } from './MarkdownEditor.js';

/** Top bar: title, sync state, view-mode switch and global actions. */

export interface TitleBarProps {
  title: string;
  onTitleChange(value: string): void;
  titleEditable: boolean;
  syncStatus: SyncStatus;
  pendingCount: number;
  mode: EditorMode;
  onModeChange(mode: EditorMode): void;
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

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface px-3" data-testid="title-bar">
      <span className="select-none text-sm font-semibold tracking-tight">aiMarkdown</span>

      <input
        value={props.title}
        disabled={!props.titleEditable}
        onChange={(event) => props.onTitleChange(event.target.value)}
        placeholder="无标题"
        className="min-w-0 flex-1 truncate rounded border border-transparent bg-transparent px-2 py-1 text-sm outline-none hover:border-border focus:border-accent disabled:cursor-default"
        data-testid="note-title-input"
      />

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
    </header>
  );
}
