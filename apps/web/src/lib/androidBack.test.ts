import { describe, expect, it } from 'vitest';
import {
  createBackRunner,
  resolveAndroidBackAction,
  type AndroidBackState,
  type BackLayerAction,
} from './androidBack.js';

const ROOT: AndroidBackState = {
  settingsOpen: false,
  aiOpen: false,
  tagsOpen: false,
  batchTagsOpen: false,
  moveSheetOpen: false,
  filterOpen: false,
  drawerOpen: false,
  profileOpen: false,
  selectMode: false,
  swipeRowOpen: false,
  view: 'list',
};

/** Every layer at once: the resolver must peel the topmost one only. */
const EVERYTHING: AndroidBackState = {
  ...ROOT,
  settingsOpen: true,
  aiOpen: true,
  tagsOpen: true,
  batchTagsOpen: true,
  moveSheetOpen: true,
  filterOpen: true,
  drawerOpen: true,
  profileOpen: true,
  selectMode: true,
  swipeRowOpen: true,
  view: 'editor',
};

describe('Android back navigation', () => {
  it('closes visible overlays before leaving the page', () => {
    expect(resolveAndroidBackAction({ ...ROOT, settingsOpen: true, view: 'editor' })).toBe('close-settings');
    expect(resolveAndroidBackAction({ ...ROOT, aiOpen: true, view: 'editor' })).toBe('close-ai');
    expect(resolveAndroidBackAction({ ...ROOT, tagsOpen: true, view: 'editor' })).toBe('close-tags');
    expect(resolveAndroidBackAction({ ...ROOT, batchTagsOpen: true })).toBe('close-batch-tags');
    expect(resolveAndroidBackAction({ ...ROOT, moveSheetOpen: true })).toBe('close-move-sheet');
    expect(resolveAndroidBackAction({ ...ROOT, filterOpen: true })).toBe('close-filter');
    expect(resolveAndroidBackAction({ ...ROOT, drawerOpen: true })).toBe('close-drawer');
  });

  it('peels layers in a fixed order, topmost first', () => {
    const order: BackLayerAction[] = [];
    const state = { ...EVERYTHING };
    // Walk the whole stack the way a user holding the back key would.
    const steps: [keyof AndroidBackState, BackLayerAction][] = [
      ['settingsOpen', 'close-settings'],
      ['aiOpen', 'close-ai'],
      ['tagsOpen', 'close-tags'],
      ['batchTagsOpen', 'close-batch-tags'],
      ['moveSheetOpen', 'close-move-sheet'],
      ['filterOpen', 'close-filter'],
      ['drawerOpen', 'close-drawer'],
      ['profileOpen', 'close-profile'],
      ['selectMode', 'exit-selection'],
      ['swipeRowOpen', 'close-swipe-row'],
    ];
    for (const [key, expected] of steps) {
      expect(resolveAndroidBackAction(state)).toBe(expected);
      state[key] = false;
      order.push(expected);
    }
    expect(order).toEqual(steps.map(([, action]) => action));
    // With every layer closed the editor still has one step left before the app may exit.
    expect(resolveAndroidBackAction(state)).toBe('show-list');
    state.view = 'list';
    expect(resolveAndroidBackAction(state)).toBe('exit');
  });

  it('leaves multi-select before anything below it', () => {
    expect(resolveAndroidBackAction({ ...ROOT, selectMode: true })).toBe('exit-selection');
    // Selection only exists on the list surface, so it still wins over a stale editor view.
    expect(resolveAndroidBackAction({ ...ROOT, selectMode: true, view: 'editor' })).toBe(
      'exit-selection',
    );
  });

  it('closes an open swipe row before navigating', () => {
    expect(resolveAndroidBackAction({ ...ROOT, swipeRowOpen: true })).toBe('close-swipe-row');
  });

  it('returns from the profile tab to the note list', () => {
    expect(resolveAndroidBackAction({ ...ROOT, profileOpen: true })).toBe('close-profile');
  });

  it('returns from the editor to the note list', () => {
    expect(resolveAndroidBackAction({ ...ROOT, view: 'editor' })).toBe('show-list');
  });

  it('only exits once the root list has nothing left to close', () => {
    expect(resolveAndroidBackAction(ROOT)).toBe('exit');
  });
});

describe('shell back runner', () => {
  it('answers exit without applying anything at the root list', () => {
    const applied: BackLayerAction[] = [];
    const run = createBackRunner(() => ROOT, (action) => applied.push(action));

    expect(run()).toBe('exit');
    expect(applied).toEqual([]);
  });

  it('applies exactly one layer and answers handled', () => {
    const applied: BackLayerAction[] = [];
    const run = createBackRunner(
      () => ({ ...ROOT, view: 'editor', settingsOpen: true }),
      (action) => applied.push(action),
    );

    expect(run()).toBe('handled');
    expect(applied).toEqual(['close-settings']);
  });

  it('exits selection mode through the runner', () => {
    const applied: BackLayerAction[] = [];
    const run = createBackRunner(() => ({ ...ROOT, selectMode: true }), (action) => applied.push(action));

    expect(run()).toBe('handled');
    expect(applied).toEqual(['exit-selection']);
  });
});
