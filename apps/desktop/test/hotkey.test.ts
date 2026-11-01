import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const registered = new Map<string, () => void>();
  return {
    registered,
    register: vi.fn((accelerator: string, callback: () => void) => {
      if (registered.has(accelerator)) return false;
      registered.set(accelerator, callback);
      return true;
    }),
    unregister: vi.fn((accelerator: string) => {
      registered.delete(accelerator);
    }),
    unregisterAll: vi.fn(() => {
      registered.clear();
    }),
  };
});

vi.mock('electron', () => ({
  globalShortcut: {
    register: mocks.register,
    unregister: mocks.unregister,
    unregisterAll: mocks.unregisterAll,
  },
}));

import { unregisterAll, registerHotkey } from '../src/main/hotkey.js';

describe('desktop hotkeys', () => {
  beforeEach(() => {
    mocks.registered.clear();
    mocks.register.mockClear();
    mocks.unregister.mockClear();
    mocks.unregisterAll.mockClear();
    unregisterAll();
    mocks.registered.clear();
  });

  it('registers the main and capture shortcuts independently', () => {
    const capture = vi.fn();
    const main = vi.fn();

    expect(registerHotkey('capture', 'Alt+Space', capture)).toMatchObject({ registered: true });
    expect(registerHotkey('main', 'CommandOrControl+Shift+M', main)).toMatchObject({ registered: true });

    mocks.registered.get('Alt+Space')?.();
    mocks.registered.get('CommandOrControl+Shift+M')?.();
    expect(capture).toHaveBeenCalledOnce();
    expect(main).toHaveBeenCalledOnce();
  });

  it('rejects a shortcut already used by the other window', () => {
    registerHotkey('capture', 'Alt+Space', vi.fn());
    const result = registerHotkey('main', 'Alt+Space', vi.fn());

    expect(result.registered).toBe(false);
    expect(result.error).toContain('打开数据窗口');
    expect(mocks.registered.has('Alt+Space')).toBe(true);
  });

  it('releases the previous accelerator when one window shortcut changes', () => {
    registerHotkey('capture', 'Alt+Space', vi.fn());
    const result = registerHotkey('capture', 'Ctrl+Alt+Space', vi.fn());

    expect(result).toMatchObject({ accelerator: 'Ctrl+Alt+Space', registered: true });
    expect(mocks.registered.has('Alt+Space')).toBe(false);
    expect(mocks.registered.has('Ctrl+Alt+Space')).toBe(true);
  });
});
