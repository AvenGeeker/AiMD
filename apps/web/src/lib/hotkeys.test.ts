import { describe, expect, it } from 'vitest';
import { acceleratorFromKeyboardEvent, type KeyboardChord } from './hotkeys.js';

function chord(overrides: Partial<KeyboardChord>): KeyboardChord {
  return {
    key: '',
    code: '',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  };
}

describe('acceleratorFromKeyboardEvent', () => {
  it('maps the platform primary modifier to CommandOrControl', () => {
    expect(
      acceleratorFromKeyboardEvent(chord({ key: 'm', code: 'KeyM', metaKey: true, shiftKey: true }), 'darwin'),
    ).toEqual({ kind: 'complete', accelerator: 'CommandOrControl+Shift+M' });
    expect(
      acceleratorFromKeyboardEvent(chord({ key: 'm', code: 'KeyM', ctrlKey: true, shiftKey: true }), 'win32'),
    ).toEqual({ kind: 'complete', accelerator: 'CommandOrControl+Shift+M' });
  });

  it('uses physical letter keys so Option-modified characters still record correctly', () => {
    expect(
      acceleratorFromKeyboardEvent(chord({ key: 'å', code: 'KeyA', metaKey: true, altKey: true }), 'darwin'),
    ).toEqual({ kind: 'complete', accelerator: 'CommandOrControl+Alt+A' });
  });

  it('records named keys and function keys', () => {
    expect(
      acceleratorFromKeyboardEvent(chord({ key: ' ', code: 'Space', altKey: true }), 'darwin'),
    ).toEqual({ kind: 'complete', accelerator: 'Alt+Space' });
    expect(acceleratorFromKeyboardEvent(chord({ key: 'F12', code: 'F12' }), 'win32')).toEqual({
      kind: 'complete',
      accelerator: 'F12',
    });
  });

  it('waits for a non-modifier key while only modifiers are held', () => {
    expect(acceleratorFromKeyboardEvent(chord({ key: 'Meta', code: 'MetaLeft', metaKey: true }), 'darwin')).toEqual({
      kind: 'pending',
    });
  });

  it('rejects typing keys and Escape with a helpful message', () => {
    expect(acceleratorFromKeyboardEvent(chord({ key: 'a', code: 'KeyA' }), 'linux').kind).toBe('invalid');
    expect(acceleratorFromKeyboardEvent(chord({ key: 'Escape', code: 'Escape' }), 'linux')).toMatchObject({
      kind: 'invalid',
      error: expect.stringContaining('Esc'),
    });
  });
});
