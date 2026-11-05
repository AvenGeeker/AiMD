import { Cloud, CloudOff, Loader2, ShieldAlert } from 'lucide-react';
import type { SyncStatus } from '../lib/sync.js';

/**
 * One description of every sync state, shared by the mobile header, the profile page and the
 * desktop title bar so the wording and colour cannot drift between surfaces.
 */

export const SYNC_STATUS_META: Record<
  SyncStatus,
  { label: string; icon: typeof Cloud; className: string }
> = {
  connected: { label: '已同步', icon: Cloud, className: 'text-success' },
  connecting: { label: '同步中', icon: Loader2, className: 'text-muted animate-spin' },
  disconnected: { label: '离线（已本地保存）', icon: CloudOff, className: 'text-warning' },
  denied: { label: '同步被拒绝', icon: ShieldAlert, className: 'text-danger' },
};

export function SyncBadge({ status }: { status: SyncStatus }) {
  const meta = SYNC_STATUS_META[status];
  const Icon = meta.icon;
  return (
    <div
      className="flex items-center"
      title={meta.label}
      aria-label={meta.label}
      data-testid="sync-status"
      data-status={status}
    >
      <Icon size={15} className={meta.className} />
    </div>
  );
}
