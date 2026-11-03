import { app, ipcMain, shell } from 'electron';
import { clearTokens, getState, saveState } from './store.js';
import {
  getHotkeyState,
  getHotkeyStates,
  HOTKEY_TARGETS,
  type HotkeyState,
  type HotkeyTarget,
} from './hotkey.js';
import { setLaunchAtLogin } from './login-item.js';
import { hideCaptureWindow, showMainWindow } from './windows.js';
import { setSyncLabel, setAppleNotesStatus, refreshTrayMenu } from './tray.js';
import { markAppMenuReady, updateAppMenuState } from './app-menu.js';
import { refreshDesktopSession } from './auth.js';
import type { AppleNotesSyncEngine } from './apple-notes/sync.js';
import { reconfigureAppleNotesScheduler } from './apple-notes/scheduler.js';
import type { AppleNotesSchedule } from '@aimarkdown/shared';

/**
 * IPC surface exposed to the renderer through the preload bridge.
 *
 * Every handler is defensively typed: the renderer is remote content, so nothing here trusts the
 * shape of what it receives.
 */

const asString = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);

export interface IpcDeps {
  /** Re-register one window shortcut and return its registration result. */
  onHotkeyChange(target: HotkeyTarget, accelerator: string): HotkeyState;
  appleNotes: AppleNotesSyncEngine;
}

function isHotkeyTarget(value: unknown): value is HotkeyTarget {
  return typeof value === 'string' && (HOTKEY_TARGETS as readonly string[]).includes(value);
}

function hotkeyPatch(target: HotkeyTarget, accelerator: string): Record<string, string> {
  if (target === 'capture') return { hotkey: accelerator };
  if (target === 'favorite') return { favoriteHotkey: accelerator };
  return { mainWindowHotkey: accelerator };
}

const APPLE_NOTES_SCHEDULES = new Set(['off', '15m', '30m', '1h', '6h', 'daily']);

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

  ipcMain.handle('amd:get-hotkey-states', () => getHotkeyStates());
  // Kept for older renderer bundles that only knew about the capture shortcut.
  ipcMain.handle('amd:get-hotkey-state', () => getHotkeyState('capture'));

  ipcMain.handle('amd:set-hotkey', (_event, target: unknown, accelerator: unknown) => {
    if (!isHotkeyTarget(target)) {
      return { ok: false, error: '无效的快捷键目标', state: null };
    }
    const next = asString(accelerator).trim();
    if (!next) return { ok: false, error: '快捷键不能为空', state: null };
    const state = deps.onHotkeyChange(target, next);
    // Persist even when registration failed, so the user sees the value they asked for and the
    // warning next to it.
    saveState(hotkeyPatch(target, next));
    refreshTrayMenu();
    return { ok: state.registered, error: state.error ?? null, state };
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

  /**
   * The renderer mirrors its top-bar state into the native menu: view mode, rail visibility,
   * sync label, account details and the macOS Notes badge. Field validation happens in
   * `app-menu.ts`, where the menu is rebuilt only when something actually changed.
   */
  ipcMain.on('amd:menu-state', (_event, payload: unknown) => {
    updateAppMenuState(payload);
  });

  /** The workspace installs its command listener after mount, then releases queued clicks. */
  ipcMain.on('amd:menu-ready', (event) => {
    markAppMenuReady(event.sender.id);
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
    if (typeof value.mainWindowHotkey === 'string' && value.mainWindowHotkey.trim().length > 0) {
      patch.mainWindowHotkey = value.mainWindowHotkey.trim();
    }
    if (typeof value.favoriteHotkey === 'string' && value.favoriteHotkey.trim().length > 0) {
      patch.favoriteHotkey = value.favoriteHotkey.trim();
    }
    if (typeof value.inboxNoteId === 'string' || value.inboxNoteId === null) {
      patch.inboxNoteId = value.inboxNoteId;
    }
    if (typeof value.stampFormat === 'string') patch.stampFormat = value.stampFormat;
    if (typeof value.hideOnBlur === 'boolean') patch.hideOnBlur = value.hideOnBlur;
    if (typeof value.minimizeToTray === 'boolean') patch.minimizeToTray = value.minimizeToTray;
    let loginItemError: string | undefined;
    if (typeof value.launchAtLogin === 'boolean') {
      patch.launchAtLogin = value.launchAtLogin;
      const result = setLaunchAtLogin(value.launchAtLogin);
      if (!result.applied) loginItemError = result.error;
    }

    saveState(patch);

    const current = getState();
    if (current.hotkey !== getHotkeyState('capture').accelerator || !getHotkeyState('capture').registered) {
      deps.onHotkeyChange('capture', current.hotkey);
    }
    if (
      current.mainWindowHotkey !== getHotkeyState('main').accelerator ||
      !getHotkeyState('main').registered
    ) {
      deps.onHotkeyChange('main', current.mainWindowHotkey);
    }
    if (
      current.favoriteHotkey !== getHotkeyState('favorite').accelerator ||
      !getHotkeyState('favorite').registered
    ) {
      deps.onHotkeyChange('favorite', current.favoriteHotkey);
    }
    refreshTrayMenu();
    // Surface a login-item failure and both registration results to the settings dialog.
    return {
      hotkeys: getHotkeyStates(),
      ...(loginItemError ? { loginItemError } : {}),
    };
  });

  /* ------------------------- macOS Notes integration ------------------------ */

  ipcMain.handle('amd:refresh-session', () => refreshDesktopSession());

  ipcMain.handle('amd:apple-notes:get-status', () => deps.appleNotes.getStatus());

  ipcMain.handle('amd:apple-notes:set-settings', (_event, value: unknown) => {
    const input = (value ?? {}) as Record<string, unknown>;
    const patch: { enabled?: boolean; schedule?: AppleNotesSchedule; syncOnLaunch?: boolean } = {};
    if (typeof input.enabled === 'boolean') patch.enabled = input.enabled;
    if (typeof input.syncOnLaunch === 'boolean') patch.syncOnLaunch = input.syncOnLaunch;
    if (typeof input.schedule === 'string' && APPLE_NOTES_SCHEDULES.has(input.schedule)) {
      patch.schedule = input.schedule as AppleNotesSchedule;
    }
    const status = deps.appleNotes.setSettings(patch);
    reconfigureAppleNotesScheduler();
    setAppleNotesStatus(status, () => void deps.appleNotes.syncNow({}));
    return status;
  });

  ipcMain.handle('amd:apple-notes:probe', async () => {
    const status = await deps.appleNotes.probe();
    setAppleNotesStatus(status, () => void deps.appleNotes.syncNow({}));
    return status;
  });

  ipcMain.handle('amd:apple-notes:preview', async (_event, deep: unknown) => {
    const preview = await deps.appleNotes.preview(deep === true);
    setAppleNotesStatus(deps.appleNotes.getStatus(), () => void deps.appleNotes.syncNow({}));
    return preview;
  });

  ipcMain.handle('amd:apple-notes:apply', async (_event, token: unknown) => {
    const status = await deps.appleNotes.applyPreview(asString(token));
    reconfigureAppleNotesScheduler();
    setAppleNotesStatus(status, () => void deps.appleNotes.syncNow({}));
    return status;
  });

  ipcMain.handle('amd:apple-notes:sync-now', async () => {
    const status = await deps.appleNotes.syncNow({});
    reconfigureAppleNotesScheduler();
    setAppleNotesStatus(status, () => void deps.appleNotes.syncNow({}));
    return status;
  });

  ipcMain.handle('amd:apple-notes:cancel', () => {
    deps.appleNotes.cancel();
    return true;
  });

  ipcMain.handle('amd:apple-notes:recheck-read-only', async () => {
    const status = await deps.appleNotes.syncNow({ deep: true });
    setAppleNotesStatus(status, () => void deps.appleNotes.syncNow({}));
    return status;
  });

  ipcMain.handle('amd:apple-notes:open-privacy', async () => {
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Automation');
    return true;
  });
}
