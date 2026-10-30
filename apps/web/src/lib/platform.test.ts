import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formatHotkey,
  harmonyBridge,
  isDesktop,
  isHarmony,
  isMobile,
  isQuickCaptureWindow,
  mobilePlatform,
  type HarmonyBridge,
} from './platform.js';

const originalWindowCapacitor = (window as unknown as Record<string, unknown>).Capacitor;
const originalHarmonyBridge = (window as unknown as Record<string, unknown>).aiMarkdownHarmony;

afterEach(() => {
  if (originalWindowCapacitor === undefined) {
    delete (window as unknown as Record<string, unknown>).Capacitor;
  } else {
    (window as unknown as Record<string, unknown>).Capacitor = originalWindowCapacitor;
  }
  if (originalHarmonyBridge === undefined) {
    delete (window as unknown as Record<string, unknown>).aiMarkdownHarmony;
  } else {
    (window as unknown as Record<string, unknown>).aiMarkdownHarmony = originalHarmonyBridge;
  }
});

describe('desktop detection', () => {
  it('reports false in a plain browser environment', () => {
    expect(window.aiMarkdown).toBeUndefined();
    expect(isDesktop()).toBe(false);
    expect(isQuickCaptureWindow()).toBe(false);
  });
});

describe('mobile detection', () => {
  it('reports web in a plain browser environment', () => {
    expect(isMobile()).toBe(false);
    expect(mobilePlatform()).toBe('web');
    expect(isHarmony()).toBe(false);
  });

  it('recognises android and ios through the injected Capacitor runtime', () => {
    (window as unknown as Record<string, unknown>).Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
    };
    expect(isMobile()).toBe(true);
    expect(mobilePlatform()).toBe('android');

    (window as unknown as Record<string, unknown>).Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'ios',
    };
    expect(mobilePlatform()).toBe('ios');
  });

  it('treats any other native platform as harmony', () => {
    (window as unknown as Record<string, unknown>).Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'ohos',
    };
    expect(isMobile()).toBe(true);
    expect(mobilePlatform()).toBe('harmony');
    expect(isHarmony()).toBe(true);
  });

  it('recognises the minimal ArkWeb harness bridge without Capacitor', () => {
    expect(harmonyBridge()).toBeNull();
    const bridge: HarmonyBridge = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    };
    (window as unknown as Record<string, unknown>).aiMarkdownHarmony = bridge;
    expect(harmonyBridge()).toBe(bridge);
    expect(isMobile()).toBe(true);
    expect(mobilePlatform()).toBe('harmony');
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
