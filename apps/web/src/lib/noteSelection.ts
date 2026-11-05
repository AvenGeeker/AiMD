/**
 * Multi-select state for the note lists.
 *
 * The mobile shell (long-press) and the desktop shell (Cmd/Ctrl-click, Shift-range) share one
 * state machine so "what is selected" cannot drift between surfaces. These are pure reducers:
 * the shells hold the state in React and hand it over, which keeps the semantics unit-testable
 * without a DOM.
 */

export interface NoteSelectionState {
  /** True while a list is in selection mode. */
  active: boolean;
  /** Selected note ids, in the order they were picked. */
  ids: string[];
  /** Last individually toggled id: the fixed end of a Shift range. */
  anchorId: string | null;
}

export const EMPTY_NOTE_SELECTION: NoteSelectionState = {
  active: false,
  ids: [],
  anchorId: null,
};

export function isSelected(state: NoteSelectionState, id: string): boolean {
  return state.ids.includes(id);
}

/** Enter selection mode, optionally with the row that triggered it already selected. */
export function enterSelection(id?: string | null): NoteSelectionState {
  return {
    active: true,
    ids: id ? [id] : [],
    anchorId: id ?? null,
  };
}

export function exitSelection(): NoteSelectionState {
  return EMPTY_NOTE_SELECTION;
}

/** Add or remove one id. Cmd/Ctrl-click and a tap in selection mode both land here. */
export function toggleSelection(
  state: NoteSelectionState,
  id: string,
): NoteSelectionState {
  const ids = state.ids.includes(id) ? state.ids.filter((entry) => entry !== id) : [...state.ids, id];
  return { active: true, ids, anchorId: id };
}

/**
 * Shift-click: select exactly the span between the anchor and `id` in the current list order.
 *
 * The previous selection is replaced rather than unioned, matching Finder/Gmail. Without an
 * anchor (or when the anchor is no longer in the list) it degrades to a single toggle.
 */
export function rangeSelection(
  state: NoteSelectionState,
  id: string,
  orderedIds: string[],
): NoteSelectionState {
  const anchor = state.anchorId;
  const endIndex = orderedIds.indexOf(id);
  const anchorIndex = anchor === null ? -1 : orderedIds.indexOf(anchor);
  if (endIndex === -1 || anchor === null || anchorIndex === -1) {
    return toggleSelection(state, id);
  }
  const from = Math.min(anchorIndex, endIndex);
  const to = Math.max(anchorIndex, endIndex);
  return { active: true, ids: orderedIds.slice(from, to + 1), anchorId: anchor };
}

export function selectAll(orderedIds: string[]): NoteSelectionState {
  return { active: true, ids: [...orderedIds], anchorId: null };
}

export function clearSelection(): NoteSelectionState {
  return EMPTY_NOTE_SELECTION;
}

/**
 * Drop ids the current list no longer contains.
 *
 * Runs after every refetch and after a batch mutation: a note that moved to another folder, or
 * was deleted on another device, must not stay silently selected. Selection mode is left only
 * when every selected note disappeared, so an empty "选择" mode started from the header survives
 * an unrelated refresh.
 */
export function pruneSelection(
  state: NoteSelectionState,
  availableIds: readonly string[],
): NoteSelectionState {
  const available = new Set(availableIds);
  const ids = state.ids.filter((id) => available.has(id));
  if (ids.length === state.ids.length && (state.anchorId === null || available.has(state.anchorId))) {
    return state;
  }
  if (state.active && ids.length === 0 && state.ids.length > 0) return EMPTY_NOTE_SELECTION;
  return {
    ...state,
    ids,
    anchorId: state.anchorId !== null && available.has(state.anchorId) ? state.anchorId : null,
  };
}

/** True when every selected note is already pinned; drives the 置顶/取消置顶 toolbar label. */
export function allPinned(
  state: NoteSelectionState,
  pinnedById: (id: string) => boolean,
): boolean {
  return state.ids.length > 0 && state.ids.every(pinnedById);
}
