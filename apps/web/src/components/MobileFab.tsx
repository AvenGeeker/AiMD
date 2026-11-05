import { BookmarkPlus, NotebookPen, Plus } from 'lucide-react';
import { hapticTap } from '../lib/haptics.js';

/**
 * Context-aware floating action button.
 *
 * The primary action follows the active tab, so the header stays free of buttons: 笔记 creates a
 * note, 收藏 opens the link capture, 速记 expands the inline composer. It is hidden on the editor
 * page, on the profile page and while notes are selected (the selection toolbar owns that edge).
 */

export type MobileFabAction = 'note' | 'favorite' | 'capture';

const ACTIONS: Record<MobileFabAction, { label: string; icon: typeof Plus; testId: string }> = {
  note: { label: '新建笔记', icon: Plus, testId: 'mobile-new-note' },
  favorite: { label: '收藏链接', icon: BookmarkPlus, testId: 'mobile-new-favorite' },
  capture: { label: '记一条速记', icon: NotebookPen, testId: 'mobile-new-capture' },
};

export interface MobileFabProps {
  action: MobileFabAction | null;
  onClick(): void;
}

export function MobileFab({ action, onClick }: MobileFabProps) {
  if (!action) return null;
  const meta = ACTIONS[action];
  const Icon = meta.icon;
  return (
    <button
      type="button"
      className="mobile-fab"
      aria-label={meta.label}
      title={meta.label}
      data-testid={meta.testId}
      onClick={() => {
        hapticTap();
        onClick();
      }}
    >
      <Icon size={24} />
    </button>
  );
}
