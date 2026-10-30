import { app, ipcMain } from 'electron';
import { clearTokens, getState, saveState } from './store.js';
import { getHotkeyState, registerHotkey } from './hotkey.js';
import { hideCaptureWindow, showMainWindow } from './windows.js';
import { setSyncLabel } from './tray.js';

/**
 * IPC surface exposed to the renderer through the preload bridge.
 *
 * Every handler is defensively typed: the renderer is remote content, so nothing here trusts the
 * shape of what it receives.
 */

const asString = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);

export interface IpcDeps {
  /** Called after the hotkey preference changes so the main process re-registers it. */
  onHotkeyChange(accelerator: string): void;
}

export function registerIpc(deps: IpcDeps): void {
  ipcMain.handle('amd:platform', () => ({
    platform: process.platform,
    appVersion: app.getVersion(),
  }));

  ipcMain.handle('amd:get-server-url', () => getState().serverUrl);

  ipcMain.handle('amd:set-server-url', (_event, url: unknown) => {
    saveState({ serverUrl: asString(url).replace(/\/+$/, '') });
    return getState().serverUrl;
  });

  ipcMain.handle('amd:get-tokens', () => {
    const state = getState();
    return { accessToken: state.accessToken, refreshToken: state.refreshToken };
  });

  ipcMain.handle('amd:set-tokens', (_event, tokens: unknown) => {
    const value = (tokens ?? {}) as Record<string, unknown>;
    saveState({
      accessToken: typeof value.accessToken === 'string' ? value.accessToken : null,
      refreshToken: typeof value.refreshToken === 'string' ? value.refreshToken : null,
    });
    return true;
  });

  ipcMain.handle('amd:clear-tokens', () => {
    clearTokens();
    return true;
  });

  ipcMain.handle('amd:get-hotkey-state', () => getHotkeyState());

  ipcMain.handle('amd:set-hotkey', (_event, accelerator: unknown) => {
    const next = asString(accelerator).trim();
    const state = registerHotkey(next, () => deps.onHotkeyChange(next));
    // Persist even when registration failed, so the user sees the value they asked for and the
    // warning next to it.
    saveState({ hotkey: next });
    return { ok: state.registered, error: state.error ?? null };
  });

  ipcMain.handle('amd:show-main', () => {
    showMainWindow();
    return true;
  });

  ipcMain.handle('amd:dismiss-capture', () => {
    hideCaptureWindow();
    return true;
  });

  /** Context the capture renderer needs to open the inbox document. */
  ipcMain.handle('amd:capture-context', () => {
    const state = getState();
    return {
      noteId: state.inboxNoteId,
      accessToken: state.accessToken,
      serverUrl: state.serverUrl,
      stampFormat: state.stampFormat,
    };
  });

  /** The renderer reports connectivity so the tray can show something truthful. */
  ipcMain.on('amd:sync-status', (_event, payload: unknown) => {
    const value = (payload ?? {}) as Record<string, unknown>;
    const status = asString(value.status, 'unknown');
    const pending = typeof value.pending === 'number' ? value.pending : 0;
    const labels: Record<string, string> = {
      connected: pending > 0 ? `已连接 · ${pending} 篇待同步` : '已连接 · 已同步',
      connecting: '连接中…',
      disconnected: '离线 · 修改已本地保存',
      denied: '同步被拒绝 · 请重新登录',
    };
    setSyncLabel(labels[status] ?? `状态：${status}`);
  });

  /**
   * The renderer mirrors its server-synced settings into the shell, so the hotkey, inbox target
   * and tray behaviour follow whatever the user changed on any device.
   */
  ipcMain.handle('amd:apply-settings', (_event, settings: unknown) => {
    const value = (settings ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};

    if (typeof value.hotkey === 'string' && value.hotkey.trim().length > 0) {
      patch.hotkey = value.hotkey.trim();
    }
    if (typeof value.inboxNoteId === 'string' || value.inboxNoteId === null) {
      patch.inboxNoteId = value.inboxNoteId;
    }
    if (typeof value.stampFormat === 'string') patch.stampFormat = value.stampFormat;
    if (typeof value.hideOnBlur === 'boolean') patch.hideOnBlur = value.hideOnBlur;
    if (typeof value.minimizeToTray === 'boolean') patch.minimizeToTray = value.minimizeToTray;
    if (typeof value.launchAtLogin === 'boolean') {
      patch.launchAtLogin = value.launchAtLogin;
      app.setLoginItemSettings({ openAtLogin: value.launchAtLogin });
    }

    saveState(patch);

    const nextHotkey = typeof patch.hotkey === 'string' ? patch.hotkey : getState().hotkey;
    if (nextHotkey !== getHotkeyState().accelerator || !getHotkeyState().registered) {
      registerHotkey(nextHotkey, () => deps.onHotkeyChange(nextHotkey));
    }
    return getHotkeyState();
  });
}
