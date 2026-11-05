import type { MouseEvent } from 'react';
import {
  BookmarkPlus,
  Check,
  CheckSquare,
  FileText,
  MessageSquareText,
  Pin,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import type { NoteSummaryDto } from '@aimarkdown/shared';
import type { NoteBatchController } from '../hooks/useNoteBatch.js';
import { NoteRowContent } from './NoteRowContent.js';
import { SelectionToolbar, selectionToolbarProps } from './SelectionToolbar.js';

/**
 * Middle rail: the notes matching the current sidebar selection.
 *
 * Hover actions stay for pointer users, and the same batch controller the phone shell uses adds
 * Cmd/Ctrl-click, Shift-range and an explicit 选择 button, so a desktop user gets multi-select
 * without the list changing how it looks.
 */

interface NoteListProps {
  notes: NoteSummaryDto[];
  selectedId: string | null;
  onOpen(id: string): void;
  onTogglePin(note: NoteSummaryDto): void;
  onDelete(id: string): void;
  onRestore(id: string): void;
  inTrash: boolean;
  loading: boolean;
  onCreateNote?(): void;
  onCreateFavorite?(): void;
  onAskAi?(): void;
  /** Present when the workspace wires up batch operations. */
  batch?: NoteBatchController;
  onOpenMovePicker?(): void;
  onOpenBatchTags?(): void;
}

export function NoteList({
  notes,
  selectedId,
  onOpen,
  onTogglePin,
  onDelete,
  onRestore,
  inTrash,
  loading,
  onCreateNote,
  onCreateFavorite,
  onAskAi,
  batch,
  onOpenMovePicker,
  onOpenBatchTags,
}: NoteListProps) {
  const selecting = batch?.selection.active ?? false;
  const orderedIds = notes.map((note) => note.id);

  const handleRowClick = (note: NoteSummaryDto, event: MouseEvent) => {
    if (!batch) {
      onOpen(note.id);
      return;
    }
    if (selecting) {
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
    <div className="notes-panel flex h-full flex-col" data-testid="note-list">
      <div className="notes-header flex shrink-0 items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold text-foreground">{inTrash ? '回收站' : '笔记'}</span>
          <span className="nav-count-chip">{notes.length}</span>
        </div>
        <div className="flex items-center gap-1">
          {batch && (
            <button
              type="button"
              className="icon-button !h-7 !w-7"
              onClick={() => (selecting ? batch.exit() : batch.enter())}
              title={selecting ? '退出多选' : '选择笔记'}
              aria-label={selecting ? '退出多选' : '选择笔记'}
              aria-pressed={selecting}
              data-testid="note-list-select"
            >
              {selecting ? <X size={14} /> : <CheckSquare size={14} />}
            </button>
          )}
          {!inTrash && onAskAi && (
            <button type="button" className="icon-button !h-7 !w-7" onClick={onAskAi} title="问 AI" aria-label="问 AI">
              <MessageSquareText size={14} />
            </button>
          )}
          {!inTrash && onCreateFavorite && (
            <button
              type="button"
              className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-muted transition-colors hover:bg-hover hover:text-foreground"
              onClick={onCreateFavorite}
              title="收藏链接"
              aria-label="收藏链接"
              data-testid="note-list-favorite-add"
            >
              <BookmarkPlus size={14} />
              收藏
            </button>
          )}
          {!inTrash && onCreateNote && (
            <button
              type="button"
              className="icon-button !h-7 !w-7"
              onClick={onCreateNote}
              title="新建笔记"
              aria-label="新建笔记"
              data-testid="note-list-new-note"
            >
              <Plus size={15} />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && notes.length === 0 && (
          <div className="space-y-3 p-4" aria-label="正在加载笔记">
            {[0, 1, 2].map((index) => (
              <div key={index} className="animate-pulse space-y-2">
                <div className="h-3 w-3/4 rounded bg-hover" />
                <div className="h-2.5 w-full rounded bg-hover/70" />
                <div className="h-2.5 w-1/2 rounded bg-hover/60" />
              </div>
            ))}
          </div>
        )}
        {!loading && notes.length === 0 && (
          <div className="empty-state mx-4 mt-6" data-testid="note-list-empty">
            <span className="empty-state-icon">
              <FileText size={19} />
            </span>
            <div className="text-xs text-muted">这里还没有笔记</div>
            {!inTrash && onCreateNote && (
              <button type="button" className="button-secondary mt-1" onClick={onCreateNote}>
                <Plus size={14} />
                新建笔记
              </button>
            )}
          </div>
        )}
        {notes.map((note) => {
          const checked = selecting && (batch?.selection.ids.includes(note.id) ?? false);
          return (
            <div
              key={note.id}
              draggable={!inTrash && !selecting}
              onDragStart={(event) => event.dataTransfer.setData('text/aimarkdown-note', note.id)}
              onClick={(event) => handleRowClick(note, event)}
              className={`note-row group cursor-pointer ${selectedId === note.id ? 'is-selected' : ''} ${
                checked ? 'is-selected-row' : ''
              }`}
              data-testid={`note-item-${note.id}`}
              aria-current={selectedId === note.id ? 'page' : undefined}
              aria-pressed={selecting ? checked : undefined}
            >
              <div className="note-row-inner">
                {selecting && (
                  <span
                    className={`note-row-check ${checked ? 'is-checked' : ''}`}
                    data-testid={`note-check-${note.id}`}
                  >
                    {checked && <Check size={11} strokeWidth={3} />}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <NoteRowContent note={note} variant="desktop" />
                </div>
              </div>

              <div className="note-row-actions mt-1.5 flex items-center gap-0.5">
                {!inTrash ? (
                  <>
                    <button
                      type="button"
                      className="icon-button !h-6 !w-6"
                      title={note.pinned ? '取消置顶' : '置顶'}
                      aria-label={note.pinned ? '取消置顶' : '置顶'}
                      onClick={(event) => {
                        event.stopPropagation();
                        onTogglePin(note);
                      }}
                    >
                      <Pin size={12} />
                    </button>
                    <button
                      type="button"
                      className="icon-button is-danger !h-6 !w-6"
                      title="移到回收站"
                      aria-label="移到回收站"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDelete(note.id);
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="flex h-6 items-center gap-1 rounded px-1.5 text-[10.5px] text-muted hover:bg-hover hover:text-foreground"
                      onClick={(event) => {
                        event.stopPropagation();
                        onRestore(note.id);
                      }}
                    >
                      <RotateCcw size={11} /> 恢复
                    </button>
                    <button
                      type="button"
                      className="flex h-6 items-center gap-1 rounded px-1.5 text-[10.5px] text-muted hover:bg-danger-soft hover:text-danger"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDelete(note.id);
                      }}
                    >
                      <Trash2 size={11} /> 彻底删除
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {batch && selecting && (
        <SelectionToolbar
          variant="desktop"
          {...selectionToolbarProps({
            batch,
            notes,
            inTrash,
            orderedIds,
            onMove: () => onOpenMovePicker?.(),
            onTags: () => onOpenBatchTags?.(),
          })}
        />
      )}
    </div>
  );
}
