import { harmonyBridge, mobilePlatform } from './platform.js';

/**
 * Immersive system bars (status bar + navigation bar / home indicator).
 *
 * The renderer already lays its chrome out with `env(safe-area-inset-*)`, and `index.html` sets
 * `viewport-fit=cover`, so once the native window draws edge-to-edge the web side only has to
 * keep the bar icon colour readable: dark icons on light themes, light icons on dark ones.
 *
 * - Android: the window goes edge-to-edge natively (MainActivity + theme; Android 15+ enforces it
 *   platform-wide). This module only syncs the icon colour with the app theme.
 * - iOS: WKWebView already extends under both bars; only the icon style is synced.
 * - HarmonyOS: the ArkTS window is full-screen (EntryAbility) and receives the colour through the
 *   existing `window.aiMarkdownHarmony` bridge.
 * - Browser / Electron: no-op.
 */

type StatusBarModule = typeof import('@capacitor/status-bar');

let modulePromise: Promise<StatusBarModule | null> | null = null;

function loadStatusBar(): Promise<StatusBarModule | null> {
  const platform = mobilePlatform();
  if (platform !== 'android' && platform !== 'ios') return Promise.resolve(null);
  modulePromise ??= import('@capacitor/status-bar').catch(() => null);
  return modulePromise;
}

/** Sync the status/navigation bar icon colour with the resolved app theme. */
export function applyStatusBarStyle(dark: boolean): void {
  const platform = mobilePlatform();

  if (platform === 'harmony') {
    const bridge = harmonyBridge();
    if (bridge?.setStatusBarDark) {
      // ArkWeb may return a Promise, a thenable, or nothing at all depending on the SDK, and a
      // synchronous throw here would land in the React effect and blank the workspace. Swallow
      // every shape: the icon colour is cosmetic.
      try {
        const result: unknown = bridge.setStatusBarDark(dark);
        if (result && typeof (result as Promise<void>).catch === 'function') {
          void (result as Promise<void>).catch(() => undefined);
        }
      } catch {
        /* cosmetic only */
      }
    }
    return;
  }

  void loadStatusBar()
    .then((mod) => {
      if (!mod) return;
      const { StatusBar, Style } = mod;
      // `Style.Dark` = light icons for dark backgrounds, `Style.Light` = dark icons for light.
      return StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
    })
    .catch(() => undefined);
}
