import { globalShortcut } from 'electron';

/**
 * Global quick-capture hotkey.
 *
 * Registration can fail — another app (Raycast, Alfred, a window manager) may already own the
 * combination. That must never be silent: the result is reported to the tray and the settings UI
 * so the user knows to pick a different accelerator.
 */

export interface HotkeyState {
  accelerator: string;
  registered: boolean;
  error?: string;
}

let current: HotkeyState = { accelerator: '', registered: false };
let handler: (() => void) | null = null;

/** Validate an Electron accelerator loosely; the real check is whether registration succeeds. */
export function looksLikeAccelerator(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return false;
  // Must contain at least one modifier or be a function key, otherwise it would swallow typing.
  const hasModifier = /(CommandOrControl|CmdOrCtrl|Command|Cmd|Control|Ctrl|Alt|Option|Shift|Super|Meta)\s*\+/i.test(
    trimmed,
  );
  const isFunctionKey = /^F([1-9]|1[0-9]|2[0-4])$/i.test(trimmed);
  return hasModifier || isFunctionKey;
}

export function getHotkeyState(): HotkeyState {
  return current;
}

/** Register `accelerator` to trigger `onTrigger`. Unregisters any previous binding first. */
export function registerHotkey(accelerator: string, onTrigger: () => void): HotkeyState {
  handler = onTrigger;

  if (!looksLikeAccelerator(accelerator)) {
    current = {
      accelerator,
      registered: false,
      error: '快捷键格式无效，需要包含修饰键（如 Alt+Space）或功能键（如 F12）',
    };
    return current;
  }

  unregisterHotkey();
  try {
    const ok = globalShortcut.register(accelerator, () => handler?.());
    current = ok
      ? { accelerator, registered: true }
      : { accelerator, registered: false, error: '该组合键已被其他应用占用' };
  } catch (error) {
    current = {
      accelerator,
      registered: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return current;
}

export function unregisterHotkey(): void {
  if (current.registered && current.accelerator) {
    try {
      globalShortcut.unregister(current.accelerator);
    } catch {
      /* already released */
    }
  }
  current = { ...current, registered: false };
}

export function unregisterAll(): void {
  try {
    globalShortcut.unregisterAll();
  } catch {
    /* ignore */
  }
  current = { accelerator: current.accelerator, registered: false };
}
