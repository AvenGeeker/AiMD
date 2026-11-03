import type {
  AppleNotesChangedEvent,
  AppleNotesPreview,
  AppleNotesSettings,
  AppleNotesStatus,
  AppleNotesSyncOptions,
} from '@aimarkdown/shared';

/**
 * Runtime platform abstraction.
 *
 * The same bundle runs in a browser tab and inside the Electron shell. The desktop app exposes
 * a small bridge on `window.aiMarkdown` for the things a web page cannot do: persist tokens in
 * the OS keychain, register a global hotkey, and drive the quick-capture window.
 */

export type HotkeyTarget = 'capture' | 'main' | 'favorite';

export interface HotkeyState {
  accelerator: string;
  registered: boolean;
  error?: string;
}

export type HotkeyStates = Record<HotkeyTarget, HotkeyState>;

/** Actions the native macOS menu can send into the workspace. */
export type MenuCommand =
  | 'new-note'
  | 'quick-capture'
  | 'open-favorite'
  | 'import'
  | 'export-note'
  | 'export-vault'
  | 'open-ai'
  | 'open-settings'
  | 'mode-split'
  | 'mode-edit'
  | 'mode-preview'
  | 'toggle-sidebar'
  | 'toggle-outline'
  | 'logout'
  | 'apple-notes-sync'
  | 'apple-notes-settings';

/**
 * Everything the native menu needs to render checked states, enabled items and status labels.
 *
 * The renderer is the source of truth for these values; the shell only mirrors them.
 */
export interface MenuStateSnapshot {
  authenticated: boolean;
  syncStatus: string;
  pendingCount: number;
  mode: 'split' | 'edit' | 'preview';
  sidebarVisible: boolean;
  outlineVisible: boolean;
  hasSelectedNote: boolean;
  user: { displayName: string; email: string; createdAt: string } | null;
  appleNotesAvailable: boolean;
  appleNotesEnabled: boolean;
  appleNotesRunning: boolean;
  appleNotesPhase: string;
  appleNotesLastSyncAt: string | null;
  appleNotesAttention: number;
}

export interface DesktopBridge {
  /** Platform reported by the Electron main process. */
  platform: NodeJS.Platform;
  appVersion: string;
  /** Server base URL configured on first launch (empty until the user sets it). */
  getServerUrl(): Promise<string>;
  setServerUrl(url: string): Promise<void>;
  /** Tokens live in the OS keychain via `safeStorage`, never in localStorage. */
  getTokens(): Promise<{ accessToken: string | null; refreshToken: string | null }>;
  /** Desktop-only single-flight refresh shared by the renderer and background sync. */
  refreshSession?(): Promise<{ accessToken: string; refreshToken: string } | null>;
  setTokens(tokens: { accessToken: string | null; refreshToken: string | null }): Promise<void>;
  /** Re-register one of the two global window shortcuts. */
  setHotkey(target: HotkeyTarget, accelerator: string): Promise<{ ok: boolean; error?: string }>;
  getHotkeyStates(): Promise<HotkeyStates>;
  /** Legacy single-shortcut getter for older desktop shells. */
  getHotkeyState?(): Promise<HotkeyState>;
  showMainWindow(): Promise<void>;
  hideQuickCapture(): Promise<void>;
  /** Mirror the top-bar state into the native application menu. */
  reportMenuState?(state: Partial<MenuStateSnapshot>): void;
  /** Declare the menu command listener installed so queued clicks can be released. */
  menuReady?(): void;
  onMenuCommand?(callback: (command: MenuCommand) => void): () => void;
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
    /** Fired by the shell just before the window is hidden, so pending CRDT updates can flush. */
    onFlush?(callback: () => void): () => void;
    /** Fired when the window becomes visible so the editor can be re-focused. */
    onShown?(callback: () => void): () => void;
  };
  /** macOS Notes integration; absent on browser, mobile and older desktop builds. */
  appleNotes?: {
    getStatus(): Promise<AppleNotesStatus>;
    probe(): Promise<AppleNotesStatus>;
    setSettings(patch: Partial<AppleNotesSettings>): Promise<AppleNotesStatus>;
    preview(deep?: boolean): Promise<AppleNotesPreview>;
    apply(token: string): Promise<AppleNotesStatus>;
    syncNow(options?: AppleNotesSyncOptions): Promise<AppleNotesStatus>;
    cancel(): Promise<boolean>;
    recheckReadOnly(): Promise<AppleNotesStatus>;
    openPrivacySettings(): Promise<boolean>;
    onStatus(callback: (status: AppleNotesStatus) => void): () => void;
    onChanged(callback: (event: AppleNotesChangedEvent) => void): () => void;
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
  const isMac = platform() === 'darwin';
  return accelerator
    .split('+')
    .map((part) => {
      const key = part.trim();
      switch (key.toLowerCase()) {
        case 'commandorcontrol':
        case 'cmdorctrl':
          return isMac ? '⌘' : 'Ctrl';
        case 'command':
        case 'cmd':
        case 'super':
        case 'meta':
          return isMac ? '⌘' : key;
        case 'alt':
        case 'option':
          return isMac ? '⌥' : 'Alt';
        case 'shift':
          return isMac ? '⇧' : 'Shift';
        case 'control':
        case 'ctrl':
          return isMac ? '⌃' : 'Ctrl';
        case 'space':
          return 'Space';
        default:
          return key;
      }
    })
    .join(isMac ? '' : ' + ');
}

/* ------------------------------ mobile shell ------------------------------ */

/**
 * Runtime detection for the Capacitor-based mobile app (Android / iOS / HarmonyOS).
 *
 * Capacitor injects `window.Capacitor` into the WebView at runtime; it is absent in a plain
 * browser tab. The HarmonyOS port is a community harness that reuses the same Core bridge, so it
 * reports a platform other than `android`/`ios`. The minimal ArkWeb harness we ship as a fallback
 * injects `window.aiMarkdownHarmony` instead, which is recognised here as well.
 */

export type MobilePlatform = 'android' | 'ios' | 'harmony' | 'web';

interface CapacitorRuntime {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

export interface HarmonyBridge {
  /** Load a value from HarmonyOS secure storage (or null when absent / unsupported). */
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

function capacitorRuntime(): CapacitorRuntime | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { Capacitor?: CapacitorRuntime }).Capacitor ?? null;
}

export function harmonyBridge(): HarmonyBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { aiMarkdownHarmony?: HarmonyBridge }).aiMarkdownHarmony ?? null;
}

/** Which native surface this bundle is running in, if any. */
export function mobilePlatform(): MobilePlatform {
  const runtime = capacitorRuntime();
  if (runtime?.isNativePlatform?.()) {
    const name = runtime.getPlatform?.();
    if (name === 'android') return 'android';
    if (name === 'ios') return 'ios';
    // Any other native platform is the HarmonyOS / OpenHarmony port.
    return 'harmony';
  }
  if (harmonyBridge()) return 'harmony';
  return 'web';
}

/** True when the bundle runs inside the Capacitor mobile app. */
export function isMobile(): boolean {
  return mobilePlatform() !== 'web';
}

export function isHarmony(): boolean {
  return mobilePlatform() === 'harmony';
}
