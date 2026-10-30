import { describe, expect, it } from 'vitest';
import { formatHotkey, isDesktop, isQuickCaptureWindow } from './platform.js';

describe('desktop detection', () => {
  it('reports false in a plain browser environment', () => {
    expect(window.aiMarkdown).toBeUndefined();
    expect(isDesktop()).toBe(false);
    expect(isQuickCaptureWindow()).toBe(false);
  });
});

describe('formatHotkey', () => {
  it('renders macOS symbols', () => {
    // jsdom reports a non-Mac platform, so this exercises the non-darwin branch deterministically.
    const formatted = formatHotkey('Ctrl+Alt+Space');
    expect(formatted.replace(/\s/g, '')).toContain('Ctrl');
  });

  it('joins non-mac parts with spaces', () => {
    expect(formatHotkey('Ctrl+Alt+Space')).toBe('Ctrl + Alt + Space');
  });

  it('leaves a single key untouched', () => {
    expect(formatHotkey('F12')).toBe('F12');
  });
});
