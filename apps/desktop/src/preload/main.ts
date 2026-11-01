import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppleNotesChangedEvent,
  AppleNotesPreview,
  AppleNotesSettings,
  AppleNotesStatus,
  AppleNotesSyncOptions,
} from '@aimarkdown/shared';

/**
 * Preload for the main window.
 *
 * Exposes the narrow `window.aiMarkdown` bridge the web bundle expects. Deliberately no
 * `quickCapture` key: its presence is how the bundle decides it is running in the capture window.
 * No Node primitives are exposed and context isolation stays on.
 */

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args);

const api = {
  get platform() {
    return process.platform;
  },
  get appVersion() {
    return process.env.npm_package_version ?? '';
  },
  getServerUrl: () => invoke<string>('amd:get-server-url'),
  setServerUrl: (url: string) => invoke<string>('amd:set-server-url', url),
  getTokens: () =>
    invoke<{ accessToken: string | null; refreshToken: string | null }>('amd:get-tokens'),
  setTokens: (tokens: { accessToken: string | null; refreshToken: string | null }) =>
    invoke<boolean>('amd:set-tokens', tokens),
  refreshSession: () =>
    invoke<{ accessToken: string; refreshToken: string } | null>('amd:refresh-session'),
  setHotkey: (accelerator: string) =>
    invoke<{ ok: boolean; error?: string }>('amd:set-hotkey', accelerator),
  getHotkeyState: () =>
    invoke<{ accelerator: string; registered: boolean; error?: string }>('amd:get-hotkey-state'),
  showMainWindow: () => invoke<boolean>('amd:show-main'),
  /** Report connectivity so the tray label reflects reality. */
  reportSyncStatus: (payload: { status: string; pending: number }) => {
    ipcRenderer.send('amd:sync-status', payload);
  },
  /** Mirror server-synced settings into the shell (hotkey, inbox, tray behaviour). */
  applySettings: (settings: Record<string, unknown>) =>
    invoke<{ accelerator: string; registered: boolean; error?: string }>('amd:apply-settings', settings),
  appleNotes: {
    getStatus: () => invoke<AppleNotesStatus>('amd:apple-notes:get-status'),
    setSettings: (patch: Partial<AppleNotesSettings>) =>
      invoke<AppleNotesStatus>('amd:apple-notes:set-settings', patch),
    probe: () => invoke<AppleNotesStatus>('amd:apple-notes:probe'),
    preview: (deep?: boolean) => invoke<AppleNotesPreview>('amd:apple-notes:preview', deep === true),
    apply: (token: string) => invoke<AppleNotesStatus>('amd:apple-notes:apply', token),
    syncNow: (options?: AppleNotesSyncOptions) =>
      invoke<AppleNotesStatus>('amd:apple-notes:sync-now', options ?? {}),
    cancel: () => invoke<boolean>('amd:apple-notes:cancel'),
    recheckReadOnly: () => invoke<AppleNotesStatus>('amd:apple-notes:recheck-read-only'),
    openPrivacySettings: () => invoke<boolean>('amd:apple-notes:open-privacy'),
    onStatus: (callback: (status: AppleNotesStatus) => void) => {
      const listener = (_event: unknown, status: AppleNotesStatus) => callback(status);
      ipcRenderer.on('amd:apple-notes:status', listener);
      return () => ipcRenderer.removeListener('amd:apple-notes:status', listener);
    },
    onChanged: (callback: (event: AppleNotesChangedEvent) => void) => {
      const listener = (_event: unknown, event: AppleNotesChangedEvent) => callback(event);
      ipcRenderer.on('amd:apple-notes:changed', listener);
      return () => ipcRenderer.removeListener('amd:apple-notes:changed', listener);
    },
  },
  onHotkeyWarning: (callback: (state: { accelerator: string; registered: boolean; error?: string }) => void) => {
    const listener = (_event: unknown, state: { accelerator: string; registered: boolean; error?: string }) =>
      callback(state);
    ipcRenderer.on('amd:hotkey-warning', listener);
    return () => ipcRenderer.removeListener('amd:hotkey-warning', listener);
  },
};

contextBridge.exposeInMainWorld('aiMarkdown', api);

export type MainBridge = typeof api;
