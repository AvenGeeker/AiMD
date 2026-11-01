import { useEffect, useRef, useState } from 'react';
import { ChevronDown, LogOut, X } from 'lucide-react';
import type { UserDto } from '@aimarkdown/shared';

/** Account trigger and details popover. Opening it must never change the session. */

export interface UserMenuProps {
  user: UserDto;
  onLogout(): void;
}

function formatJoinedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function UserMenu({ user, onLogout }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePress = (event: MouseEvent | TouchEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', closeOnOutsidePress);
    document.addEventListener('touchstart', closeOnOutsidePress);
    document.addEventListener('keydown', closeOnEscape);
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('mousedown', closeOnOutsidePress);
      document.removeEventListener('touchstart', closeOnOutsidePress);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const initial = Array.from(user.displayName.trim())[0]?.toUpperCase() ?? '?';

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        className={`flex h-8 max-w-44 items-center gap-2 rounded-full border px-1.5 pr-2 transition-colors ${
          open
            ? 'border-border bg-elevated text-foreground'
            : 'border-transparent text-muted hover:border-border hover:bg-hover hover:text-foreground'
        }`}
        onClick={() => setOpen((value) => !value)}
        title="个人详情"
        aria-label={open ? '收起个人详情' : '打开个人详情'}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? 'user-menu-panel' : undefined}
        data-testid="user-menu-button"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[10px] font-semibold text-accent">
          {initial}
        </span>
        <span className="titlebar-label min-w-0 truncate text-[11px]">{user.displayName}</span>
        <ChevronDown
          size={12}
          className={`titlebar-label shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          ref={panelRef}
          id="user-menu-panel"
          role="dialog"
          aria-label="个人详情"
          tabIndex={-1}
          className="menu-surface absolute right-0 top-full z-50 mt-2 w-72 p-4 text-left outline-none"
          data-testid="user-menu"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] font-semibold tracking-wide text-muted">个人详情</span>
            <button
              type="button"
              className="icon-button !h-6 !w-6"
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
              }}
              aria-label="关闭个人详情"
              data-testid="user-menu-close"
            >
              <X size={13} />
            </button>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-accent/20 bg-accent-soft text-sm font-semibold text-accent">
              {initial}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{user.displayName}</div>
              <div className="mt-0.5 text-[10.5px] text-muted">已安全登录</div>
            </div>
          </div>

          <dl className="mt-4 space-y-2 rounded-lg border border-border-subtle bg-panel/70 px-3 py-2.5 text-[10.5px]">
            <div className="flex items-start justify-between gap-3">
              <dt className="shrink-0 text-muted">邮箱</dt>
              <dd className="min-w-0 break-all text-right text-muted-strong">{user.email}</dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="shrink-0 text-muted">注册时间</dt>
              <dd className="text-right text-muted-strong">{formatJoinedAt(user.createdAt)}</dd>
            </div>
          </dl>

          <button
            type="button"
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-danger/35 px-3 py-2 text-xs text-danger transition-colors hover:bg-danger-soft"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            data-testid="logout"
          >
            <LogOut size={14} />
            退出登录
          </button>
        </div>
      )}
    </div>
  );
}
