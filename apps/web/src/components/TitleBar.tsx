import {
  AlertCircle,
  Cloud,
  CloudOff,
  Download,
  Import,
  Loader2,
  NotebookPen,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import type { SyncStatus } from '../lib/sync.js';
import { APP_NAME, type AppleNotesStatus, type UserDto } from '@aimarkdown/shared';
import { isDesktop, platform } from '../lib/platform.js';
import type { EditorMode } from './MarkdownEditor.js';
import { UserMenu } from './UserMenu.js';
import { ActionMenu, MenuItem } from './ui/Menu.js';
import { SegmentedControl } from './ui/SegmentedControl.js';
import {
  AiToolbarIcon,
  EditToolbarIcon,
  InspectorToolbarIcon,
  MoreToolbarIcon,
  PreviewToolbarIcon,
  SettingsToolbarIcon,
  SidebarToolbarIcon,
  SplitToolbarIcon,
} from './ui/ToolbarIcons.js';

/** Top bar: quiet workspace identity, sync state, view mode and global actions. */

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
  onOpenAi(): void;
  onExportVault(): void;
  onImport(): void;
  appleNotesAvailable?: boolean;
  appleNotesStatus?: AppleNotesStatus | null;
  onAppleNotesSync?(): void;
  user: UserDto;
  onLogout(): void;
}

const STATUS_META: Record<
  SyncStatus,
  { label: string; shortLabel: string; icon: typeof Cloud; textClass: string; iconClass: string }
> = {
  connected: {
    label: '已同步',
    shortLabel: '已同步',
    icon: Cloud,
    textClass: 'text-success',
    iconClass: 'text-success',
  },
  connecting: {
    label: '同步中',
    shortLabel: '同步中',
    icon: Loader2,
    textClass: 'text-muted',
    iconClass: 'text-muted animate-spin',
  },
  disconnected: {
    label: '离线（已本地保存）',
    shortLabel: '离线',
    icon: CloudOff,
    textClass: 'text-warning',
    iconClass: 'text-warning',
  },
  denied: {
    label: '同步被拒绝',
    shortLabel: '已拒绝',
    icon: ShieldAlert,
    textClass: 'text-danger',
    iconClass: 'text-danger',
  },
};

const MODES = [
  { value: 'split' as const, label: '分栏', icon: SplitToolbarIcon },
  { value: 'edit' as const, label: '编辑', icon: EditToolbarIcon },
  { value: 'preview' as const, label: '预览', icon: PreviewToolbarIcon },
];

export function TitleBar(props: TitleBarProps) {
  const status = STATUS_META[props.syncStatus];
  const StatusIcon = status.icon;
  const macTitleBar = isDesktop() && platform() === 'darwin';
  const appleAttention =
    (props.appleNotesStatus?.conflictCount ?? 0) + (props.appleNotesStatus?.readOnlyCount ?? 0);

  return (
    <header
      className="titlebar titlebar-drag flex shrink-0 items-center gap-2 px-3"
      data-testid="title-bar"
    >
      {macTitleBar && <div className="h-full w-[76px] shrink-0" aria-hidden />}

      <div className="titlebar-no-drag flex items-center gap-1.5">
        <button
          type="button"
          className={`icon-button ${props.sidebarVisible ? 'is-active' : ''}`}
          onClick={props.onToggleSidebar}
          title={props.sidebarVisible ? '隐藏左侧栏' : '显示左侧栏'}
          aria-label={props.sidebarVisible ? '隐藏左侧栏' : '显示左侧栏'}
          aria-pressed={props.sidebarVisible}
          data-testid="toggle-sidebar"
        >
          <SidebarToolbarIcon size={18} active={props.sidebarVisible} />
        </button>
        <div className="ml-1 flex items-center gap-2.5">
          <span className="brand-mark" aria-hidden>
            M
          </span>
          <div className="hidden min-w-0 sm:block">
            <div className="titlebar-wordmark">{APP_NAME}</div>
            <div className="titlebar-context">Markdown workspace</div>
          </div>
        </div>
      </div>

      <div className="flex-1" />

      <div className="titlebar-no-drag flex items-center gap-1.5">
        {props.appleNotesAvailable && (
          <button
            type="button"
            className={`icon-button ${
              props.appleNotesStatus?.phase === 'error' || props.appleNotesStatus?.phase === 'needs-attention'
                ? 'text-warning'
                : props.appleNotesStatus?.running
                  ? 'is-active'
                  : ''
            }`}
            onClick={props.onAppleNotesSync}
            title={
              props.appleNotesStatus?.settings.enabled
                ? props.appleNotesStatus.running
                  ? '正在同步 macOS 备忘录'
                  : '立即同步 macOS 备忘录'
                : '在设置中启用 macOS 备忘录同步'
            }
            aria-label="macOS 备忘录同步"
            data-testid="apple-notes-sync"
          >
            {props.appleNotesStatus?.running ? (
              <RefreshCw size={16} className="animate-spin" />
            ) : props.appleNotesStatus?.phase === 'error' ||
              props.appleNotesStatus?.phase === 'needs-attention' ? (
              <AlertCircle size={16} />
            ) : (
              <NotebookPen size={16} />
            )}
            {appleAttention > 0 && (
              <span className="absolute -right-0.5 -top-0.5 min-w-3.5 rounded-full bg-danger px-1 text-[9px] leading-3.5 text-white">
                {appleAttention}
              </span>
            )}
          </button>
        )}

        <div
          className={`status-pill ${status.textClass}`}
          title={props.pendingCount > 0 ? `${props.pendingCount} 篇待同步` : status.label}
          data-testid="sync-status"
          data-status={props.syncStatus}
        >
          <StatusIcon size={13} className={status.iconClass} />
          <span className="titlebar-label">{status.shortLabel}</span>
        </div>

        <SegmentedControl
          value={props.mode}
          options={MODES}
          onChange={props.onModeChange}
          ariaLabel="编辑视图"
          testIdPrefix="mode"
        />

        <button
          type="button"
          className="topbar-ai-button"
          onClick={props.onOpenAi}
          title="AI 总结与待办"
          aria-label="AI 总结与待办"
          data-testid="open-ai"
        >
          <AiToolbarIcon size={17} />
          <span className="titlebar-label">AI</span>
        </button>

        <div className="topbar-action-group">
          <ActionMenu
            label="更多操作"
            testId="open-more"
            trigger={<MoreToolbarIcon size={18} />}
          >
            <MenuItem icon={<Import size={14} />} onClick={props.onImport} testId="import">
              导入 Markdown / ZIP
            </MenuItem>
            <MenuItem icon={<Download size={14} />} onClick={props.onExportVault} testId="export-vault">
              导出整个笔记库
            </MenuItem>
          </ActionMenu>

          <button
            type="button"
            className={`icon-button ${props.outlineVisible ? 'is-active' : ''}`}
            onClick={props.onToggleOutline}
            title={props.outlineVisible ? '隐藏大纲' : '显示大纲'}
            aria-label={props.outlineVisible ? '隐藏大纲' : '显示大纲'}
            aria-pressed={props.outlineVisible}
            data-testid="toggle-outline"
          >
            <InspectorToolbarIcon size={18} active={props.outlineVisible} />
          </button>

          <button
            type="button"
            className="icon-button"
            onClick={props.onOpenSettings}
            title="设置"
            aria-label="设置"
            data-testid="open-settings"
          >
            <SettingsToolbarIcon size={18} />
          </button>
        </div>

        <UserMenu user={props.user} onLogout={props.onLogout} />
      </div>
    </header>
  );
}
