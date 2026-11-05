import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NoteBatchDto, NoteBatchOp } from '@aimarkdown/shared';
import { useBatchNotes } from '../lib/queries.js';
import {
  clearSelection,
  enterSelection,
  pruneSelection,
  rangeSelection,
  selectAll,
  toggleSelection,
  type NoteSelectionState,
} from '../lib/noteSelection.js';
import { hapticSuccess, hapticWarn } from '../lib/haptics.js';

/**
 * Batch operations controller shared by the mobile and desktop note lists.
 *
 * Owns the selection state machine, the undo window after a soft delete, and the confirmation
 * step for the irreversible ops, so both shells get identical behaviour from one implementation.
 * Every write goes through `POST /api/notes/batch`, which mutates the notes' CRDT documents —
 * never the Postgres projection.
 */

/** How long the undo affordance stays available after moving notes to the trash. */
export const UNDO_WINDOW_MS = 5_000;

export interface UndoState {
  message: string;
  ids: string[];
  /** Bumped per toast so the component can key its own timer/animation. */
  nonce: number;
}

export interface BatchConfirmState {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm(): void;
}

export interface NoteBatchController {
  selection: NoteSelectionState;
  busy: boolean;
  setSelection(next: NoteSelectionState | ((prev: NoteSelectionState) => NoteSelectionState)): void;
  enter(id?: string | null): void;
  exit(): void;
  toggle(id: string): void;
  range(id: string, orderedIds: string[]): void;
  selectAll(orderedIds: string[]): void;
  pin(pinned: boolean): void;
  move(folderId: string | null): void;
  addTags(tagIds: string[]): void;
  /** Soft-delete; defaults to the current selection and offers an undo. */
  trash(ids?: string[]): void;
  restore(ids?: string[]): void;
  /** Permanent delete; asks for confirmation first. */
  destroy(ids?: string[]): void;
  /** Wipes the whole trash server-side; asks for confirmation first. */
  emptyTrash(): void;
  undo: UndoState | null;
  runUndo(): void;
  dismissUndo(): void;
  confirm: BatchConfirmState | null;
  dismissConfirm(): void;
}

function summarise(result: NoteBatchDto, done: string): { message: string; failed: number } {
  if (result.op === 'destroy') {
    return { message: `已彻底删除 ${result.succeeded} 篇笔记`, failed: result.failed };
  }
  return { message: `${done} ${result.succeeded} 篇`, failed: result.failed };
}

export function useNoteBatch(options: {
  /** Current list order, used for select-all and for pruning ids that vanished. */
  availableIds: string[];
  selectedNoteId: string | null;
  /** Called when the note open in the editor was deleted or restored away. */
  onSelectedNoteGone(id: string): void;
  flash(message: string): void;
}): NoteBatchController {
  const { availableIds, selectedNoteId, onSelectedNoteGone, flash } = options;
  const batchNotes = useBatchNotes();
  const [selection, setSelectionState] = useState<NoteSelectionState>(clearSelection);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [confirm, setConfirm] = useState<BatchConfirmState | null>(null);
  const undoTimer = useRef<number | null>(null);

  const availableKey = availableIds.join('|');

  // Drop selections that no longer exist (batch applied elsewhere, folder switched, note deleted
  // on another device). `pruneSelection` returns the same object when nothing changed.
  useEffect(() => {
    const ids = availableKey === '' ? [] : availableKey.split('|');
    setSelectionState((prev) => pruneSelection(prev, ids));
  }, [availableKey]);

  const clearUndoTimer = useCallback(() => {
    if (undoTimer.current !== null) window.clearTimeout(undoTimer.current);
    undoTimer.current = null;
  }, []);

  useEffect(() => clearUndoTimer, [clearUndoTimer]);

  const setSelection = useCallback(
    (next: NoteSelectionState | ((prev: NoteSelectionState) => NoteSelectionState)) => {
      setSelectionState(next);
    },
    [],
  );

  const armUndo = useCallback(
    (message: string, ids: string[]) => {
      clearUndoTimer();
      const nonce = Date.now();
      setUndo({ message, ids, nonce });
      undoTimer.current = window.setTimeout(() => setUndo(null), UNDO_WINDOW_MS);
    },
    [clearUndoTimer],
  );

  const dismissUndo = useCallback(() => {
    clearUndoTimer();
    setUndo(null);
  }, [clearUndoTimer]);

  const report = useCallback(
    (result: NoteBatchDto, done: string) => {
      const { message, failed } = summarise(result, done);
      if (failed > 0) {
        hapticWarn();
        flash(`${message}，${failed} 篇失败`);
      } else {
        hapticSuccess();
        flash(message);
      }
      if (result.truncated) flash('一次最多处理 200 篇，请再执行一次处理剩余笔记');
    },
    [flash],
  );

  /** Forget the selection and drop the editor when it was showing one of the affected notes. */
  const afterMutation = useCallback(
    (ids: string[], gone: boolean) => {
      setSelectionState(clearSelection());
      if (!gone) return;
      for (const id of ids) {
        if (id === selectedNoteId) {
          onSelectedNoteGone(id);
          break;
        }
      }
    },
    [onSelectedNoteGone, selectedNoteId],
  );

  const run = useCallback(
    async (
      op: NoteBatchOp,
      payload: { ids?: string[]; scope?: 'trashed'; folderId?: string | null; tagIds?: string[] },
      done: string,
      options: { undoMessage?: (result: NoteBatchDto, ids: string[]) => string | null; ids?: string[] } = {},
    ) => {
      try {
        const result = await batchNotes.mutateAsync({ op, ...payload });
        report(result, done);
        const undoIds = options.ids ?? payload.ids ?? [];
        const undoMessage = options.undoMessage?.(result, undoIds);
        if (undoMessage) armUndo(undoMessage, undoIds);
        // Only notes that left the current view (trash / destroy) must clear the editor.
        afterMutation(undoIds, op === 'trash' || op === 'destroy');
        return result;
      } catch (error) {
        hapticWarn();
        flash(`操作失败：${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    },
    [afterMutation, armUndo, batchNotes, flash, report],
  );

  const controller = useMemo<NoteBatchController>(() => {
    const idsOf = (explicit?: string[]) => explicit ?? selection.ids;
    return {
      selection,
      busy: batchNotes.isPending,
      setSelection,
      enter: (id) => setSelectionState(enterSelection(id)),
      exit: () => setSelectionState(clearSelection()),
      toggle: (id) => setSelectionState((prev) => toggleSelection(prev, id)),
      range: (id, orderedIds) => setSelectionState((prev) => rangeSelection(prev, id, orderedIds)),
      selectAll: (orderedIds) => setSelectionState(selectAll(orderedIds)),
      pin: (pinned) => {
        void run(pinned ? 'pin' : 'unpin', { ids: selection.ids }, pinned ? '已置顶' : '已取消置顶');
      },
      move: (folderId) => {
        void run('move', { ids: selection.ids, folderId }, '已移动');
      },
      addTags: (tagIds) => {
        void run('addTags', { ids: selection.ids, tagIds }, '已添加标签');
      },
      trash: (ids) => {
        const targets = idsOf(ids);
        if (targets.length === 0) return;
        void run(
          'trash',
          { ids: targets },
          '已移到回收站',
          {
            ids: targets,
            undoMessage: (_result, undoIds) =>
              undoIds.length === 1 ? '已移到回收站' : `已移动 ${undoIds.length} 篇到回收站`,
          },
        );
      },
      restore: (ids) => {
        const targets = idsOf(ids);
        if (targets.length === 0) return;
        void run('restore', { ids: targets }, '已恢复', { ids: targets });
      },
      destroy: (ids) => {
        const targets = idsOf(ids);
        if (targets.length === 0) return;
        setConfirm({
          title: targets.length === 1 ? '彻底删除这篇笔记？' : `彻底删除 ${targets.length} 篇笔记？`,
          body: '此操作不可撤销，笔记与附件会一并从服务器移除。',
          confirmLabel: '彻底删除',
          onConfirm: () => {
            setConfirm(null);
            void run('destroy', { ids: targets }, '已彻底删除', { ids: targets });
          },
        });
      },
      emptyTrash: () => {
        setConfirm({
          title: '清空回收站？',
          body: '回收站里的全部笔记都会被彻底删除，此操作不可撤销。',
          confirmLabel: '清空回收站',
          onConfirm: () => {
            setConfirm(null);
            // The scope is resolved server-side; pass the loaded trash ids so an editor that is
            // showing one of them is cleared instead of pointing at a deleted note.
            void run('destroy', { scope: 'trashed' }, '已清空回收站', { ids: availableIds });
          },
        });
      },
      undo,
      runUndo: () => {
        const pending = undo;
        dismissUndo();
        if (!pending) return;
        void run('restore', { ids: pending.ids }, '已恢复', { ids: pending.ids });
      },
      dismissUndo,
      confirm,
      dismissConfirm: () => setConfirm(null),
    };
  }, [
    availableIds,
    batchNotes.isPending,
    confirm,
    dismissUndo,
    run,
    selection,
    setSelection,
    undo,
  ]);

  return controller;
}
