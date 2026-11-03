import { globalShortcut } from 'electron';

/**
 * Global desktop shortcuts.
 *
 * Two independent bindings live in the shell: one for the quick-capture (data-entry) window and
 * one for bringing the main workspace window forward. Registration can fail — another app
 * (Raycast, Alfred, a window manager) may already own the combination. That must never be
 * silent: each result is reported to the tray and the settings UI.
 */

export const HOTKEY_TARGETS = ['capture', 'main', 'favorite'] as const;
export type HotkeyTarget = (typeof HOTKEY_TARGETS)[number];

export interface HotkeyState {
  accelerator: string;
  registered: boolean;
  error?: string;
}

export type HotkeyStates = Record<HotkeyTarget, HotkeyState>;

const TARGET_LABEL: Record<HotkeyTarget, string> = {
  capture: '打开数据窗口',
  main: '打开主窗口',
  favorite: '收藏链接',
};

let states: HotkeyStates = {
  capture: { accelerator: '', registered: false },
  main: { accelerator: '', registered: false },
  favorite: { accelerator: '', registered: false },
};
const handlers: Partial<Record<HotkeyTarget, () => void>> = {};

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

export function getHotkeyStates(): HotkeyStates {
  return {
    capture: { ...states.capture },
    main: { ...states.main },
    favorite: { ...states.favorite },
  };
}

export function getHotkeyState(target: HotkeyTarget): HotkeyState {
  return { ...states[target] };
}

/** True when both configured shortcuts are valid and currently owned by this app. */
export function allHotkeysRegistered(): boolean {
  return HOTKEY_TARGETS.every((target) => states[target].registered);
}

function sameAccelerator(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Register one target's accelerator. The other target is left untouched so changing one
 * shortcut cannot silently disable the other.
 */
export function registerHotkey(
  target: HotkeyTarget,
  accelerator: string,
  onTrigger: () => void,
): HotkeyState {
  handlers[target] = onTrigger;
  const next = accelerator.trim();

  if (!next) {
    unregisterHotkey(target);
    states[target] = { accelerator: '', registered: false, error: '尚未设置快捷键' };
    return { ...states[target] };
  }

  if (!looksLikeAccelerator(next)) {
    unregisterHotkey(target);
    states[target] = {
      accelerator: next,
      registered: false,
      error: '快捷键格式无效，需要包含修饰键（如 Alt+Space）或功能键（如 F12）',
    };
    return { ...states[target] };
  }

  const conflict = HOTKEY_TARGETS.find(
    (other) => other !== target && states[other].accelerator && sameAccelerator(states[other].accelerator, next),
  );
  if (conflict) {
    unregisterHotkey(target);
    states[target] = {
      accelerator: next,
      registered: false,
      error: `该组合键已用于${TARGET_LABEL[conflict]}`,
    };
    return { ...states[target] };
  }

  unregisterHotkey(target);
  try {
    const ok = globalShortcut.register(next, () => handlers[target]?.());
    states[target] = ok
      ? { accelerator: next, registered: true }
      : { accelerator: next, registered: false, error: '该组合键已被其他应用占用' };
  } catch (error) {
    states[target] = {
      accelerator: next,
      registered: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return { ...states[target] };
}

export function unregisterHotkey(target: HotkeyTarget): void {
  const current = states[target];
  if (current.registered && current.accelerator) {
    try {
      globalShortcut.unregister(current.accelerator);
    } catch {
      /* already released */
    }
  }
  states[target] = { ...current, registered: false };
}

export function unregisterAll(): void {
  try {
    globalShortcut.unregisterAll();
  } catch {
    /* ignore */
  }
  states = {
    capture: { accelerator: states.capture.accelerator, registered: false },
    main: { accelerator: states.main.accelerator, registered: false },
    favorite: { accelerator: states.favorite.accelerator, registered: false },
  };
}
