import { platform } from './platform.js';

/**
 * Turn a real key press into an Electron accelerator.
 *
 * Recording keys instead of asking users to type accelerator syntax avoids typos and makes the
 * stored value independent of keyboard layout for the common letter/number cases.
 */

export interface KeyboardChord {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export type HotkeyCapture =
  | { kind: 'pending' }
  | { kind: 'complete'; accelerator: string }
  | { kind: 'invalid'; error: string };

const MODIFIER_KEYS = new Set([
  'Alt',
  'AltGraph',
  'CapsLock',
  'Control',
  'Fn',
  'FnLock',
  'Meta',
  'NumLock',
  'OS',
  'ScrollLock',
  'Shift',
  'Symbol',
  'SymbolLock',
]);

const CODE_KEYS: Record<string, string> = {
  Backquote: '`',
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Equal: '=',
  Minus: '-',
  Period: '.',
  Quote: "'",
  Semicolon: ';',
  Slash: '/',
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
  NumpadDecimal: 'numdec',
};

function keyFromChord(chord: KeyboardChord): string | null {
  if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(chord.key)) return chord.key.toUpperCase();
  if (/^Key[A-Z]$/.test(chord.code)) return chord.code.slice(3);
  if (/^Digit[0-9]$/.test(chord.code)) return chord.code.slice(5);
  if (/^Numpad[0-9]$/.test(chord.code)) return `num${chord.code.slice(6)}`;
  const mapped = CODE_KEYS[chord.code];
  if (mapped) return mapped;
  // `key` is layout-dependent (Option+A becomes å on macOS), so only use it after `code` fails.
  if (chord.key.length === 1 && chord.key.trim().length > 0) return chord.key.toUpperCase();
  return null;
}

export function acceleratorFromKeyboardEvent(
  chord: KeyboardChord,
  platformName: NodeJS.Platform = platform(),
): HotkeyCapture {
  if (MODIFIER_KEYS.has(chord.key)) return { kind: 'pending' };
  if (chord.key === 'Dead' || chord.key === 'Unidentified' || chord.key === 'Process') {
    return { kind: 'pending' };
  }
  if (chord.key === 'Escape') return { kind: 'invalid', error: 'Esc 用于取消录制，请换一个组合键' };

  const key = keyFromChord(chord);
  if (!key) return { kind: 'invalid', error: '无法识别该按键，请换一个组合键' };

  const modifiers: string[] = [];
  const primaryIsMeta = platformName === 'darwin';
  if (primaryIsMeta ? chord.metaKey : chord.ctrlKey) modifiers.push('CommandOrControl');
  if (primaryIsMeta && chord.ctrlKey) modifiers.push('Control');
  if (!primaryIsMeta && chord.metaKey) modifiers.push('Super');
  if (chord.altKey) modifiers.push('Alt');
  if (chord.shiftKey) modifiers.push('Shift');

  if (modifiers.length === 0 && !/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) {
    return { kind: 'invalid', error: '请同时按住至少一个修饰键，或使用 F1–F24' };
  }

  return { kind: 'complete', accelerator: [...modifiers, key].join('+') };
}
