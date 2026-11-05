import { Bookmark, NotebookText, PenLine, User } from 'lucide-react';
import { hapticTap } from '../lib/haptics.js';

/**
 * Bottom tab bar for the phone-width shell.
 *
 * Only rendered below 600px: an unfolded foldable or tablet already has room for the real
 * navigation rail, and duplicating both would waste vertical space. The bar carries no state of
 * its own — the active tab is derived from the workspace selection so deep links, the hardware
 * back key and tab taps cannot disagree.
 */

export type MobileTab = 'notes' | 'favorites' | 'captures' | 'me';

interface TabDefinition {
  id: MobileTab;
  label: string;
  icon: typeof NotebookText;
}

const TABS: TabDefinition[] = [
  { id: 'notes', label: '笔记', icon: NotebookText },
  { id: 'favorites', label: '收藏', icon: Bookmark },
  { id: 'captures', label: '速记', icon: PenLine },
  { id: 'me', label: '我的', icon: User },
];

export interface MobileTabBarProps {
  active: MobileTab;
  /** Pending favourite classifications. */
  favoritesBadge?: number;
  /** Number of quick captures in the inbox. */
  capturesBadge?: number;
  onChange(tab: MobileTab): void;
}

export function MobileTabBar({
  active,
  favoritesBadge = 0,
  capturesBadge = 0,
  onChange,
}: MobileTabBarProps) {
  return (
    <nav
      className="mobile-tabbar"
      role="tablist"
      aria-label="主导航"
      data-testid="mobile-tabbar"
    >
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const badge = tab.id === 'favorites' ? favoritesBadge : tab.id === 'captures' ? capturesBadge : 0;
        const selected = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-label={tab.label}
            className={`mobile-tab ${selected ? 'is-active' : ''}`}
            data-testid={`mobile-tab-${tab.id}`}
            onClick={() => {
              if (!selected) hapticTap();
              onChange(tab.id);
            }}
          >
            <span className="mobile-tab-icon">
              <Icon size={21} />
              {badge > 0 && (
                <span className="mobile-tab-badge" data-testid={`mobile-tab-badge-${tab.id}`}>
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </span>
            <span className="mobile-tab-label">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
