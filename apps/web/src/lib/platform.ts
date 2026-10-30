/**
 * Runtime platform abstraction.
 *
 * The same bundle runs in a browser tab and inside the Electron shell. The desktop app exposes
 * a small bridge on `window.aiMarkdown` for the things a web page cannot do: persist tokens in
 * the OS keychain, register a global hotkey, and drive the quick-capture window.
 */

export interface DesktopBridge {
  /** Platform reported by the Electron main process. */
  platform: NodeJS.Platform;
  appVersion: string;
  /** Server base URL configured on first launch (empty until the user sets it). */
  getServerUrl(): Promise<string>;
  setServerUrl(url: string): Promise<void>;
  /** Tokens live in the OS keychain via `safeStorage`, never in localStorage. */
  getTokens(): Promise<{ accessToken: string | null; refreshToken: string | null }>;
  setTokens(tokens: { accessToken: string | null; refreshToken: string | null }): Promise<void>;
  /** Ask the main process to re-register the global quick-capture hotkey. */
  setHotkey(accelerator: string): Promise<{ ok: boolean; error?: string }>;
  getHotkeyState(): Promise<{ accelerator: string; registered: boolean; error?: string }>;
  showMainWindow(): Promise<void>;
  hideQuickCapture(): Promise<void>;
  /**
   * Present only when this window *is* the quick-capture window.
   *
   * The renderer writes the capture straight into the inbox `Y.Doc` (so it works offline and
   * merges with concurrent edits); the main process is only asked to supply context and to hide
   * the window afterwards.
   */
  quickCapture?: {
    getContext(): Promise<QuickCaptureContext>;
    /** Hide the window. Called after a successful capture and on Escape. */
    dismiss(): Promise<void>;
  };
}

declare global {
  interface Window {
    aiMarkdown?: DesktopBridge;
  }
}

export interface QuickCaptureContext {
  /** Inbox note the capture is appended to; null until the user has signed in once. */
  noteId: string | null;
  accessToken: string | null;
  serverUrl: string;
  stampFormat: string;
}

export function getBridge(): DesktopBridge | null {
  return typeof window === 'undefined' ? null : (window.aiMarkdown ?? null);
}

export function isDesktop(): boolean {
  return getBridge() !== null;
}

export function isQuickCaptureWindow(): boolean {
  return getBridge()?.quickCapture !== undefined;
}

export function platform(): NodeJS.Platform {
  const bridge = getBridge();
  if (bridge?.platform) return bridge.platform;
  if (typeof navigator === 'undefined') return 'linux';
  const ua = navigator.userAgent;
  if (/Mac/i.test(ua)) return 'darwin';
  if (/Win/i.test(ua)) return 'win32';
  return 'linux';
}

/** Human-readable accelerator hint for the current platform, e.g. `⌥Space`. */
export function formatHotkey(accelerator: string): string {
  if (platform() !== 'darwin') return accelerator.replace(/\+/g, ' + ');
  return accelerator
    .split('+')
    .map((part) => {
      switch (part.trim().toLowerCase()) {
        case 'command':
        case 'cmd':
          return '⌘';
        case 'alt':
        case 'option':
          return '⌥';
        case 'shift':
          return '⇧';
        case 'control':
        case 'ctrl':
          return '⌃';
        case 'space':
          return 'Space';
        default:
          return part.trim();
      }
    })
    .join('');
}
