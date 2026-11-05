import { afterEach, describe, expect, it } from 'vitest';
import { applyStatusBarStyle } from './statusBar.js';

/**
 * ArkWeb's bridge is the one call path that can hand back a non-Promise from an "async" method,
 * which previously escaped as a synchronous throw inside a React effect and blanked the app.
 */

type Bridge = {
  get?(key: string): Promise<string | null>;
  set?(key: string, value: string): Promise<void>;
  remove?(key: string): Promise<void>;
  setStatusBarDark?(dark: boolean): void | Promise<void>;
};

function setBridge(bridge: Bridge | null): void {
  const host = window as unknown as { aiMarkdownHarmony?: Bridge };
  if (bridge) host.aiMarkdownHarmony = bridge;
  else delete host.aiMarkdownHarmony;
}

afterEach(() => setBridge(null));

describe('applyStatusBarStyle on HarmonyOS', () => {
  it('tolerates a bridge method that returns undefined (no Promise)', () => {
    let called: boolean | null = null;
    setBridge({
      setStatusBarDark: (dark: boolean) => {
        called = dark;
        return undefined;
      },
    });
    expect(() => applyStatusBarStyle(true)).not.toThrow();
    expect(called).toBe(true);
  });

  it('tolerates a rejected promise', async () => {
    setBridge({ setStatusBarDark: () => Promise.reject(new Error('nope')) });
    expect(() => applyStatusBarStyle(false)).not.toThrow();
    await Promise.resolve();
  });

  it('tolerates a synchronous throw from the bridge', () => {
    setBridge({
      setStatusBarDark: () => {
        throw new Error('bridge not ready');
      },
    });
    expect(() => applyStatusBarStyle(true)).not.toThrow();
  });

  it('does nothing when the bridge does not expose the method', () => {
    setBridge({});
    expect(() => applyStatusBarStyle(true)).not.toThrow();
  });
});

describe('applyStatusBarStyle elsewhere', () => {
  it('is a no-op in a plain browser', () => {
    expect(() => applyStatusBarStyle(false)).not.toThrow();
  });
});
