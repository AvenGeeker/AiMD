import { useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  Bookmark,
  ChevronRight,
  Download,
  LogOut,
  RefreshCw,
  Settings,
  Trash2,
  Upload,
} from 'lucide-react';
import { APP_NAME, type Theme, type UserDto } from '@aimarkdown/shared';
import type { SyncStatus } from '../lib/sync.js';
import { SYNC_STATUS_META } from './SyncStatusBadge.js';
import { ConfirmDialog } from './ui/ConfirmDialog.js';
import { hapticTap } from '../lib/haptics.js';

/**
 * The 我的 tab: account, sync, appearance, data and sign-out in one scrollable page.
 *
 * Replacing the drawer's footer strip means the phone shell no longer needs a hamburger at all —
 * navigation is the tab bar, and everything account-level lives here. The detailed settings stay
 * in the existing full-screen `SettingsDialog`, opened from the 设置 row.
 */

export interface MobileProfilePageProps {
  user: UserDto;
  status: SyncStatus;
  pendingCount: number;
  theme: Theme;
  serverUrl: string;
  trashCount: number;
  favoriteCount: number;
  onBack(): void;
  onOpenSettings(): void;
  onOpenTrash(): void;
  onOpenFavorites(): void;
  onImport(): void;
  onExportVault(): void;
  onThemeChange(theme: Theme): void;
  onSyncNow(): void;
  onLogout(): void;
}

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

interface RowProps {
  icon: ReactNode;
  label: string;
  hint?: string;
  trailing?: ReactNode;
  danger?: boolean;
  testId?: string;
  onClick(): void;
}

function ProfileRow({ icon, label, hint, trailing, danger, testId, onClick }: RowProps) {
  return (
    <button
      type="button"
      className={`profile-row ${danger ? 'is-danger' : ''}`}
      data-testid={testId}
      onClick={() => {
        hapticTap();
        onClick();
      }}
    >
      <span className="profile-row-icon">{icon}</span>
      <span className="profile-row-label">{label}</span>
      {hint && <span className="profile-row-hint">{hint}</span>}
      {trailing ?? <ChevronRight size={16} className="profile-row-chevron" />}
    </button>
  );
}

export function MobileProfilePage(props: MobileProfilePageProps) {
  const {
    user,
    status,
    pendingCount,
    theme,
    serverUrl,
    trashCount,
    favoriteCount,
    onBack,
    onOpenSettings,
    onOpenTrash,
    onOpenFavorites,
    onImport,
    onExportVault,
    onThemeChange,
    onSyncNow,
    onLogout,
  } = props;
  const [confirmLogout, setConfirmLogout] = useState(false);
  const meta = SYNC_STATUS_META[status];
  const StatusIcon = meta.icon;
  const initial = Array.from(user.displayName.trim())[0]?.toUpperCase() ?? '?';
  const createdAt = new Date(user.createdAt);

  return (
    <div className="mobile-profile" data-testid="mobile-profile">
      <header className="mobile-header profile-header">
        <button
          type="button"
          className="profile-back"
          aria-label="返回笔记"
          onClick={onBack}
          data-testid="profile-back"
        >
          <ArrowLeft size={20} />
        </button>
        <span className="profile-header-title">我的</span>
        <span className="profile-header-spacer" />
      </header>

      <div className="profile-scroll">
        <section className="profile-card profile-account">
          <span className="profile-avatar">{initial}</span>
          <div className="profile-account-body">
            <div className="profile-name">{user.displayName}</div>
            <div className="profile-email">{user.email}</div>
            <div className="profile-meta">
              注册于 {Number.isNaN(createdAt.getTime()) ? '—' : `${createdAt.getFullYear()}/${createdAt.getMonth() + 1}/${createdAt.getDate()}`}
            </div>
          </div>
        </section>

        <section className="profile-card">
          <div className="profile-row is-static">
            <span className="profile-row-icon">
              <StatusIcon size={16} className={meta.className} />
            </span>
            <span className="profile-row-label">同步状态</span>
            <span className="profile-row-hint" data-testid="profile-sync-label">
              {meta.label}
            </span>
          </div>
          <ProfileRow
            icon={<RefreshCw size={16} />}
            label="立即同步"
            hint={pendingCount > 0 ? `${pendingCount} 篇待上传` : '已全部同步'}
            testId="profile-sync-now"
            onClick={onSyncNow}
          />
          <div className="profile-row is-static">
            <span className="profile-row-icon">
              <Settings size={16} />
            </span>
            <span className="profile-row-label">服务器</span>
            <span className="profile-row-hint profile-row-ellipsis">{serverUrl || '未配置'}</span>
          </div>
        </section>

        <section className="profile-card">
          <div className="profile-section-title">外观</div>
          <div className="profile-theme" role="group" aria-label="主题">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`profile-theme-option ${theme === option.value ? 'is-active' : ''}`}
                aria-pressed={theme === option.value}
                data-testid={`profile-theme-${option.value}`}
                onClick={() => {
                  hapticTap();
                  onThemeChange(option.value);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        <section className="profile-card">
          <ProfileRow
            icon={<Bookmark size={16} />}
            label="我的收藏"
            hint={`${favoriteCount} 条`}
            testId="profile-favorites"
            onClick={onOpenFavorites}
          />
          <ProfileRow
            icon={<Trash2 size={16} />}
            label="回收站"
            hint={`${trashCount} 篇`}
            testId="profile-trash"
            onClick={onOpenTrash}
          />
          <ProfileRow
            icon={<Upload size={16} />}
            label="导入 Markdown / ZIP"
            testId="profile-import"
            onClick={onImport}
          />
          <ProfileRow
            icon={<Download size={16} />}
            label="导出整个笔记库"
            testId="profile-export"
            onClick={onExportVault}
          />
          <ProfileRow
            icon={<Settings size={16} />}
            label="设置"
            testId="open-settings"
            onClick={onOpenSettings}
          />
        </section>

        <section className="profile-card">
          <ProfileRow
            icon={<LogOut size={16} />}
            label="退出登录"
            danger
            testId="mobile-logout"
            onClick={() => setConfirmLogout(true)}
          />
        </section>

        <div className="profile-footer">
          {APP_NAME} · 自托管多端同步笔记
        </div>
      </div>

      <ConfirmDialog
        open={confirmLogout}
        title="退出登录？"
        body="本机缓存会保留，重新登录后继续同步。"
        confirmLabel="退出登录"
        danger
        onConfirm={() => {
          setConfirmLogout(false);
          onLogout();
        }}
        onClose={() => setConfirmLogout(false)}
      />
    </div>
  );
}
