import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload for the quick-capture window.
 *
 * The presence of `quickCapture` on the bridge is what tells the shared web bundle to render the
 * capture UI instead of the full workspace — one bundle, three surfaces.
 */

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args);

const api = {
  get platform() {
    return process.platform;
  },
  get appVersion() {
    return '';
  },
  getServerUrl: () => invoke<string>('amd:get-server-url'),
  setServerUrl: (url: string) => invoke<string>('amd:set-server-url', url),
  getTokens: () => invoke<{ accessToken: string | null; refreshToken: string | null }>('amd:get-tokens'),
  setTokens: (tokens: { accessToken: string | null; refreshToken: string | null }) =>
    invoke<boolean>('amd:set-tokens', tokens),
  setHotkey: (accelerator: string) => invoke<{ ok: boolean; error?: string }>('amd:set-hotkey', accelerator),
  getHotkeyState: () =>
    invoke<{ accelerator: string; registered: boolean; error?: string }>('amd:get-hotkey-state'),
  showMainWindow: () => invoke<boolean>('amd:show-main'),

  quickCapture: {
    getContext: () =>
      invoke<{ noteId: string | null; accessToken: string | null; serverUrl: string; stampFormat: string }>(
        'amd:capture-context',
      ),
    dismiss: () => invoke<boolean>('amd:dismiss-capture'),
    /** Fired by the main process just before the window is hidden. */
    onFlush: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('amd:capture-flush', listener);
      return () => ipcRenderer.removeListener('amd:capture-flush', listener);
    },
    /** Fired when the window becomes visible so the editor can be re-focused. */
    onShown: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('amd:capture-shown', listener);
      return () => ipcRenderer.removeListener('amd:capture-shown', listener);
    },
  },
};

contextBridge.exposeInMainWorld('aiMarkdown', api);

export type QuickCaptureBridge = typeof api;
