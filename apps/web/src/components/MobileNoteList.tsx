import { type MouseEvent } from 'react';
import { Check, FileText, Loader2, Pin, PinOff, Plus, RotateCcw, Trash, Trash2 } from 'lucide-react';
import type { NoteSummaryDto, TagDto } from '@aimarkdown/shared';
import type { NoteBatchController } from '../hooks/useNoteBatch.js';
import { groupNotesByDay, type NoteGroup } from '../lib/relativeTime.js';
import { usePullToRefresh } from '../hooks/usePullToRefresh.js';
import { hapticTap } from '../lib/haptics.js';
import { NoteRowContent } from './NoteRowContent.js';
import { SwipeRow, type SwipeAction } from './SwipeRow.js';

/**
 * Touch-first note list.
 *
 * Grouped iOS-style cards (置顶 / 今天 / 昨天 / 更早), swipe actions per row, long-press
 * multi-select and pull-to-refresh. The header (large title, search, sort, filter) belongs to the
 * shell, so this component is only the scroller — which also lets the same list serve the
 * two- and three-pane foldable layouts.
 */

export interface MobileNoteListProps {
  notes: NoteSummaryDto[];
  tags: TagDto[];
  selectedNoteId: string | null;
  loading: boolean;
  inTrash: boolean;
  /** Day grouping only matches the default 最近更新 sort; other sorts render one flat group. */
  grouped: boolean;
  batch: NoteBatchController;
  /** Exactly one row may reveal its swipe actions; the shell owns it so back can close it. */
  openRowId: string | null;
  onOpenRowIdChange(id: string | null): void;
  onOpen(id: string): void;
  onTogglePin(note: NoteSummaryDto): void;
  onCreateNote(): void;
  onRefresh(): Promise<void>;
  /** Reports the scroll offset so the shell can collapse the large title. */
  onScrollOffset?(offset: number): void;
  emptyTitle?: string;
  emptyHint?: string;
}

export function MobileNoteList({
  notes,
  tags,
  selectedNoteId,
  loading,
  inTrash,
  grouped,
  batch,
  openRowId,
  onOpenRowIdChange,
  onOpen,
  onTogglePin,
  onCreateNote,
  onRefresh,
  onScrollOffset,
  emptyTitle = '这里还没有笔记',
  emptyHint,
}: MobileNoteListProps) {
  const selecting = batch.selection.active;
  const pull = usePullToRefresh({
    enabled: !selecting && openRowId === null,
    onRefresh,
  });

  const orderedIds = notes.map((note) => note.id);
  const tagNames = new Map(tags.map((tag) => [tag.id, tag.name]));
  const groups: NoteGroup<NoteSummaryDto>[] = grouped
    ? groupNotesByDay(notes, {
        at: (note) => note.contentUpdatedAt,
        pinned: (note) => note.pinned,
      })
    : notes.length > 0
      ? [{ key: 'earlier', label: '', items: notes }]
      : [];

  const rowActions = (note: NoteSummaryDto): SwipeAction[] =>
    inTrash
      ? [
          {
            key: 'restore',
            label: '恢复',
            icon: <RotateCcw size={17} />,
            testId: `swipe-restore-${note.id}`,
            onClick: () => batch.restore([note.id]),
          },
          {
            key: 'destroy',
            label: '删除',
            icon: <Trash size={17} />,
            tone: 'danger',
            testId: `swipe-destroy-${note.id}`,
            onClick: () => batch.destroy([note.id]),
          },
        ]
      : [
          {
            key: 'pin',
            label: note.pinned ? '取消置顶' : '置顶',
            icon: note.pinned ? <PinOff size={17} /> : <Pin size={17} />,
            testId: `swipe-pin-${note.id}`,
            onClick: () => onTogglePin(note),
          },
          {
            key: 'trash',
            label: '删除',
            icon: <Trash2 size={17} />,
            tone: 'danger',
            testId: `swipe-trash-${note.id}`,
            onClick: () => batch.trash([note.id]),
          },
        ];

  const handleRowClick = (note: NoteSummaryDto, event: MouseEvent) => {
    // A revealed row closes on tap, exactly like a native list; opening it would feel like the
    // swipe did nothing.
    if (openRowId === note.id) {
      onOpenRowIdChange(null);
      return;
    }
    if (selecting) {
      hapticTap();
      batch.toggle(note.id);
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      batch.toggle(note.id);
      return;
    }
    if (event.shiftKey) {
      batch.range(note.id, orderedIds);
      return;
    }
    onOpen(note.id);
  };

  return (
    <div className="notes-panel mobile-note-list flex h-full flex-col" data-testid="note-list">
      <div
        ref={pull.ref}
        className="mobile-list-scroll"
        onScroll={(event) => onScrollOffset?.(event.currentTarget.scrollTop)}
        data-testid="note-list-scroll"
      >
        <div
          className="ptr-indicator"
          style={{
            height: pull.refreshing ? 34 : pull.offset,
            opacity: pull.refreshing ? 1 : pull.progress,
          }}
          aria-hidden={!pull.refreshing && pull.offset === 0}
          data-testid="pull-to-refresh"
          data-refreshing={pull.refreshing ? 'true' : 'false'}
        >
          {pull.refreshing ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <span
              className="ptr-arrow"
              style={{ transform: `rotate(${pull.progress * 180}deg)` }}
            />
          )}
        </div>

        {loading && notes.length === 0 && (
          <div className="mnote-skeletons" aria-label="正在加载笔记">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="mnote-skeleton">
                <span className="mnote-skeleton-title" />
                <span className="mnote-skeleton-line" />
                <span className="mnote-skeleton-line is-short" />
              </div>
            ))}
          </div>
        )}

        {!loading && notes.length === 0 && (
          <div className="mobile-empty" data-testid="note-list-empty">
            <span className="mobile-empty-icon">
              <FileText size={22} />
            </span>
            <div className="mobile-empty-title">{emptyTitle}</div>
            {emptyHint && <div className="mobile-empty-hint">{emptyHint}</div>}
            {!inTrash && (
              <button type="button" className="button-primary mt-2" onClick={onCreateNote}>
                <Plus size={15} />
                新建笔记
              </button>
            )}
          </div>
        )}

        {groups.map((group) => (
          <section key={group.key} className="mnote-group" data-testid={`note-group-${group.key}`}>
            {group.label && <div className="mnote-group-title">{group.label}</div>}
            <div className="mnote-card">
              {group.items.map((note) => {
                const checked = batch.selection.ids.includes(note.id);
                return (
                  <SwipeRow
                    key={note.id}
                    testId={`note-row-${note.id}`}
                    enabled={!selecting}
                    open={openRowId === note.id}
                    onOpenChange={(next) => onOpenRowIdChange(next ? note.id : null)}
                    onCommit={() =>
                      inTrash ? batch.destroy([note.id]) : batch.trash([note.id])
                    }
                    onLeading={() =>
                      inTrash ? batch.restore([note.id]) : onTogglePin(note)
                    }
                    onLongPress={() => batch.enter(note.id)}
                    actions={rowActions(note)}
                  >
                    <div
                      className={`mnote-row ${selectedNoteId === note.id ? 'is-current' : ''} ${
                        checked ? 'is-checked' : ''
                      } ${selecting ? 'is-selecting' : ''}`}
                      data-testid={`note-item-${note.id}`}
                      role="button"
                      tabIndex={0}
                      aria-pressed={selecting ? checked : undefined}
                      aria-current={selectedNoteId === note.id ? 'page' : undefined}
                      onClick={(event) => handleRowClick(note, event)}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        event.preventDefault();
                        if (selecting) batch.toggle(note.id);
                        else onOpen(note.id);
                      }}
                    >
                      {selecting && (
                        <span
                          className={`mnote-check ${checked ? 'is-checked' : ''}`}
                          data-testid={`note-check-${note.id}`}
                        >
                          {checked && <Check size={13} strokeWidth={3} />}
                        </span>
                      )}
                      <NoteRowContent
                        note={note}
                        variant="mobile"
                        tagNames={note.tagIds
                          .map((id) => tagNames.get(id))
                          .filter((name): name is string => Boolean(name))}
                      />
                    </div>
                  </SwipeRow>
                );
              })}
            </div>
          </section>
        ))}

        {/* Bottom breathing room so the FAB never covers the last row. */}
        <div className="mnote-tail" aria-hidden />
      </div>
    </div>
  );
}
