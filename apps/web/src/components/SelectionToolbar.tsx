import type { ReactNode } from 'react';
import { CheckCheck, FolderInput, Pin, PinOff, RotateCcw, Tags, Trash, Trash2 } from 'lucide-react';
import type { NoteBatchController } from '../hooks/useNoteBatch.js';
import type { NoteSummaryDto } from '@aimarkdown/shared';
import { allPinned } from '../lib/noteSelection.js';
import { hapticTap } from '../lib/haptics.js';

/**
 * Batch action bar shown while notes are selected.
 *
 * One component, two containers: the mobile shell docks it where the tab bar was, the desktop
 * rail floats it as a pill. The action set is identical, and in the trash view the destructive
 * verbs swap for 恢复 / 彻底删除 / 清空回收站.
 */

export interface SelectionToolbarProps {
  variant?: 'mobile' | 'desktop';
  count: number;
  busy?: boolean;
  inTrash: boolean;
  allSelected: boolean;
  pinnedById(id: string): boolean;
  selectedIds: string[];
  onCancel(): void;
  onToggleSelectAll(): void;
  onPin(pinned: boolean): void;
  onMove(): void;
  onTags(): void;
  onTrash(): void;
  onRestore(): void;
  onDestroy(): void;
  onEmptyTrash(): void;
}

interface ToolbarAction {
  key: string;
  label: string;
  icon: ReactNode;
  tone?: 'danger';
  testId: string;
  disabled?: boolean;
  onClick(): void;
}

export function SelectionToolbar(props: SelectionToolbarProps) {
  const {
    variant = 'mobile',
    count,
    busy = false,
    inTrash,
    allSelected,
    pinnedById,
    selectedIds,
    onCancel,
    onToggleSelectAll,
    onPin,
    onMove,
    onTags,
    onTrash,
    onRestore,
    onDestroy,
    onEmptyTrash,
  } = props;

  const everyPinned = allPinned(
    { active: true, ids: selectedIds, anchorId: null },
    pinnedById,
  );
  const none = count === 0;

  const actions: ToolbarAction[] = inTrash
    ? [
        {
          key: 'restore',
          label: '恢复',
          icon: <RotateCcw size={16} />,
          testId: 'selection-restore',
          disabled: none || busy,
          onClick: onRestore,
        },
        {
          key: 'destroy',
          label: '彻底删除',
          icon: <Trash size={16} />,
          tone: 'danger',
          testId: 'selection-destroy',
          disabled: none || busy,
          onClick: onDestroy,
        },
        {
          key: 'empty',
          label: '清空',
          icon: <Trash2 size={16} />,
          tone: 'danger',
          testId: 'selection-empty-trash',
          disabled: busy,
          onClick: onEmptyTrash,
        },
      ]
    : [
        {
          key: 'pin',
          label: everyPinned ? '取消置顶' : '置顶',
          icon: everyPinned ? <PinOff size={16} /> : <Pin size={16} />,
          testId: 'selection-pin',
          disabled: none || busy,
          onClick: () => onPin(!everyPinned),
        },
        {
          key: 'move',
          label: '移动',
          icon: <FolderInput size={16} />,
          testId: 'selection-move',
          disabled: none || busy,
          onClick: onMove,
        },
        {
          key: 'tags',
          label: '标签',
          icon: <Tags size={16} />,
          testId: 'selection-tags',
          disabled: none || busy,
          onClick: onTags,
        },
        {
          key: 'trash',
          label: '删除',
          icon: <Trash2 size={16} />,
          tone: 'danger',
          testId: 'selection-trash',
          disabled: none || busy,
          onClick: onTrash,
        },
      ];

  return (
    <div
      className={`selection-toolbar selection-toolbar-${variant}`}
      role="toolbar"
      aria-label="批量操作"
      data-testid="selection-toolbar"
      data-count={count}
    >
      <button
        type="button"
        className="selection-toolbar-cancel"
        onClick={() => {
          hapticTap();
          onCancel();
        }}
        data-testid="selection-cancel"
      >
        取消
      </button>

      <button
        type="button"
        className="selection-toolbar-count"
        onClick={() => {
          hapticTap();
          onToggleSelectAll();
        }}
        data-testid="selection-count"
        aria-label={allSelected ? '取消全选' : '全选'}
      >
        <span className="selection-toolbar-count-value">
          {allSelected ? `已选全部 ${count} 项` : `已选 ${count} 项`}
        </span>
        <span className="selection-toolbar-count-hint">
          <CheckCheck size={12} />
          {allSelected ? '取消全选' : '全选'}
        </span>
      </button>

      <div className="selection-toolbar-actions">
        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            className={`selection-toolbar-action ${action.tone === 'danger' ? 'is-danger' : ''}`}
            disabled={action.disabled}
            data-testid={action.testId}
            aria-label={action.label}
            title={action.label}
            onClick={() => {
              hapticTap();
              action.onClick();
            }}
          >
            {action.icon}
            <span className="selection-toolbar-action-label">{action.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Convenience wrapper so shells do not have to re-derive the toolbar props from the controller. */
export function selectionToolbarProps(options: {
  batch: NoteBatchController;
  notes: NoteSummaryDto[];
  inTrash: boolean;
  orderedIds: string[];
  onMove(): void;
  onTags(): void;
}): Omit<SelectionToolbarProps, 'variant'> {
  const { batch, notes, inTrash, orderedIds, onMove, onTags } = options;
  const byId = new Map(notes.map((note) => [note.id, note]));
  const count = batch.selection.ids.length;
  return {
    count,
    busy: batch.busy,
    inTrash,
    allSelected: count > 0 && count === orderedIds.length,
    pinnedById: (id) => byId.get(id)?.pinned ?? false,
    selectedIds: batch.selection.ids,
    onCancel: batch.exit,
    onToggleSelectAll: () => {
      if (count > 0 && count === orderedIds.length) batch.exit();
      else batch.selectAll(orderedIds);
    },
    onPin: (pinned) => batch.pin(pinned),
    onMove,
    onTags,
    onTrash: () => batch.trash(),
    onRestore: () => batch.restore(),
    onDestroy: () => batch.destroy(),
    onEmptyTrash: () => batch.emptyTrash(),
  };
}
