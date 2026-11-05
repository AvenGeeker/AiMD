import { describe, expect, it } from 'vitest';
import {
  EMPTY_NOTE_SELECTION,
  allPinned,
  clearSelection,
  enterSelection,
  isSelected,
  pruneSelection,
  rangeSelection,
  selectAll,
  toggleSelection,
} from './noteSelection.js';

const ORDER = ['a', 'b', 'c', 'd', 'e'];

describe('note selection state machine', () => {
  it('starts empty and enters selection with the row that triggered it', () => {
    expect(EMPTY_NOTE_SELECTION).toEqual({ active: false, ids: [], anchorId: null });
    expect(enterSelection()).toEqual({ active: true, ids: [], anchorId: null });
    expect(enterSelection('b')).toEqual({ active: true, ids: ['b'], anchorId: 'b' });
  });

  it('toggles ids and keeps the last one as the range anchor', () => {
    const one = toggleSelection(EMPTY_NOTE_SELECTION, 'a');
    expect(one).toEqual({ active: true, ids: ['a'], anchorId: 'a' });

    const two = toggleSelection(one, 'c');
    expect(two.ids).toEqual(['a', 'c']);
    expect(two.anchorId).toBe('c');

    const back = toggleSelection(two, 'a');
    expect(back.ids).toEqual(['c']);
    expect(isSelected(back, 'a')).toBe(false);
    expect(isSelected(back, 'c')).toBe(true);
  });

  it('selects the inclusive span between the anchor and the shift-clicked row', () => {
    const anchored = toggleSelection(EMPTY_NOTE_SELECTION, 'b');
    expect(rangeSelection(anchored, 'd', ORDER).ids).toEqual(['b', 'c', 'd']);
    // Selecting upwards keeps the anchor and still produces an ordered span.
    expect(rangeSelection(anchored, 'a', ORDER).ids).toEqual(['a', 'b']);
  });

  it('degrades to a toggle without a usable anchor', () => {
    expect(rangeSelection(EMPTY_NOTE_SELECTION, 'c', ORDER)).toEqual({
      active: true,
      ids: ['c'],
      anchorId: 'c',
    });
    const stale = { active: true, ids: ['a'], anchorId: 'gone' };
    expect(rangeSelection(stale, 'c', ORDER).ids).toEqual(['a', 'c']);
  });

  it('replaces the range instead of unioning, so a second shift-click is predictable', () => {
    const anchored = toggleSelection(EMPTY_NOTE_SELECTION, 'a');
    const wide = rangeSelection(anchored, 'd', ORDER);
    expect(wide.ids).toEqual(['a', 'b', 'c', 'd']);
    expect(rangeSelection(anchored, 'b', ORDER).ids).toEqual(['a', 'b']);
  });

  it('selects and clears everything', () => {
    expect(selectAll(ORDER).ids).toEqual(ORDER);
    expect(clearSelection()).toEqual(EMPTY_NOTE_SELECTION);
  });

  it('prunes ids that left the list and keeps an intentionally empty selection', () => {
    const selected = selectAll(ORDER);
    expect(pruneSelection(selected, ['a', 'c', 'e']).ids).toEqual(['a', 'c', 'e']);

    // A refetch that drops every selected note leaves nothing to act on: exit selection.
    expect(pruneSelection(selected, ['zz'])).toEqual(EMPTY_NOTE_SELECTION);

    // Selection mode opened from the header has no ids yet and must survive a refresh.
    const empty = enterSelection();
    expect(pruneSelection(empty, ORDER)).toBe(empty);
  });

  it('returns the same object when nothing changed so setState does not re-render', () => {
    const selected = selectAll(ORDER);
    expect(pruneSelection(selected, ORDER)).toBe(selected);
  });

  it('drops a stale anchor while keeping the rest of the selection', () => {
    const state = { active: true, ids: ['a', 'b'], anchorId: 'b' };
    const pruned = pruneSelection(state, ['a']);
    expect(pruned).toEqual({ active: true, ids: ['a'], anchorId: null });
  });

  it('knows whether every selected note is pinned', () => {
    const pinned = new Set(['a', 'b']);
    const isPinned = (id: string) => pinned.has(id);
    expect(allPinned({ active: true, ids: ['a', 'b'], anchorId: null }, isPinned)).toBe(true);
    expect(allPinned({ active: true, ids: ['a', 'c'], anchorId: null }, isPinned)).toBe(false);
    expect(allPinned(EMPTY_NOTE_SELECTION, isPinned)).toBe(false);
  });
});
