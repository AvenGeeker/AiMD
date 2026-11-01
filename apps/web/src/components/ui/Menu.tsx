import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { MoreToolbarIcon } from './ToolbarIcons.js';

const CloseMenuContext = createContext<() => void>(() => undefined);

export interface ActionMenuProps {
  label: string;
  children: ReactNode;
  trigger?: ReactNode;
  testId?: string;
  className?: string;
  align?: 'start' | 'end';
}

/** A small, keyboard-dismissable action menu used by the top bar and note header. */
export function ActionMenu({
  label,
  children,
  trigger,
  testId,
  className = '',
  align = 'end',
}: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

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
    return () => {
      document.removeEventListener('mousedown', closeOnOutsidePress);
      document.removeEventListener('touchstart', closeOnOutsidePress);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        className="icon-button"
        onClick={() => setOpen((value) => !value)}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={testId}
      >
        {trigger ?? <MoreToolbarIcon size={18} />}
      </button>
      {open && (
        <div
          role="menu"
          className={`menu-surface absolute top-full z-50 mt-2 ${align === 'end' ? 'right-0' : 'left-0'}`}
        >
          <CloseMenuContext.Provider value={() => setOpen(false)}>{children}</CloseMenuContext.Provider>
        </div>
      )}
    </div>
  );
}

export interface MenuItemProps {
  children: ReactNode;
  icon?: ReactNode;
  onClick(): void;
  danger?: boolean;
  disabled?: boolean;
  testId?: string;
}

export function MenuItem({ children, icon, onClick, danger, disabled, testId }: MenuItemProps) {
  const close = useContext(CloseMenuContext);
  return (
    <button
      type="button"
      role="menuitem"
      className={`menu-item ${danger ? 'is-danger' : ''}`}
      disabled={disabled}
      onClick={() => {
        close();
        onClick();
      }}
      data-testid={testId}
    >
      {icon}
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}
