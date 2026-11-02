import { describe, expect, it } from 'vitest';
import { resolveAndroidBackAction, type AndroidBackState } from './androidBack.js';

const ROOT: AndroidBackState = {
  settingsOpen: false,
  aiOpen: false,
  tagsOpen: false,
  drawerOpen: false,
  view: 'list',
};

describe('Android back navigation', () => {
  it('closes visible overlays before leaving the page', () => {
    expect(resolveAndroidBackAction({ ...ROOT, settingsOpen: true, view: 'editor' })).toBe('close-settings');
    expect(resolveAndroidBackAction({ ...ROOT, aiOpen: true, view: 'editor' })).toBe('close-ai');
    expect(resolveAndroidBackAction({ ...ROOT, tagsOpen: true, view: 'editor' })).toBe('close-tags');
    expect(resolveAndroidBackAction({ ...ROOT, drawerOpen: true })).toBe('close-drawer');
  });

  it('returns from the editor to the note list', () => {
    expect(resolveAndroidBackAction({ ...ROOT, view: 'editor' })).toBe('show-list');
  });

  it('only exits once the root list has nothing left to close', () => {
    expect(resolveAndroidBackAction(ROOT)).toBe('exit');
  });
});
