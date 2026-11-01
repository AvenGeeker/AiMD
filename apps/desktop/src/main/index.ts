import { app, BrowserWindow, Notification } from 'electron';
import { getState, loadState, saveState } from './store.js';
import { isQuitting } from './lifecycle.js';
import {
  registerHotkey,
  unregisterAll,
  getHotkeyState,
  getHotkeyStates,
  type HotkeyTarget,
} from './hotkey.js';
import {
  createCaptureWindow,
  createMainWindow,
  destroyAllWindows,
  showMainWindow,
  toggleCaptureWindow,
} from './windows.js';
import { createTray, destroyTray, setQuitHandler } from './tray.js';
import { registerIpc } from './ipc.js';
import { setQuitting } from './lifecycle.js';
import { setLaunchAtLogin } from './login-item.js';
import { AppleNotesSyncEngine } from './apple-notes/sync.js';
import { startAppleNotesScheduler, stopAppleNotesScheduler } from './apple-notes/scheduler.js';
import { setAppleNotesStatus } from './tray.js';
import { installApplicationMenu, setAppMenuQuitHandler } from './app-menu.js';
import { ensureRegularActivation } from './activation.js';
import { APP_NAME } from './app-name.js';
import type { AppleNotesChangedEvent, AppleNotesStatus } from '@aimarkdown/shared';

/**
 * Desktop shell entrypoint.
 *
 * The shell owns three things a web page cannot: the global quick-capture hotkey, the tray that
 * keeps the app alive after the window closes, and keychain-backed token storage. Everything else
 * — including the editor itself — is the same web bundle the browser loads.
 */

let appleNotesEngineRef: AppleNotesSyncEngine | null = null;

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  // A second launch just surfaces the running instance rather than opening a competing window.
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });

  const bootstrap = (): void => {
    app.setAboutPanelOptions({ applicationName: APP_NAME, applicationVersion: app.getVersion() });
    ensureRegularActivation();
    loadState();
    const state = getState();
    // Read-before-write: on macOS an unsigned/dev build cannot always change login items, and
    // calling this unconditionally on every boot produces a spurious "Operation not permitted".
    const loginItem = setLaunchAtLogin(state.launchAtLogin);
    if (!loginItem.applied && state.launchAtLogin) {
      console.warn(`[${APP_NAME}] 无法设置登录时启动：${loginItem.error ?? '未知原因'}`);
    }

    const broadcast = (channel: string, payload: unknown) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(channel, payload);
      }
    };
    const appleNotesEngine = new AppleNotesSyncEngine({
      onStatus: (status: AppleNotesStatus) => {
        broadcast('amd:apple-notes:status', status);
        setAppleNotesStatus(status, () => void appleNotesEngine.syncNow({}));
      },
      onChanged: (reason: AppleNotesChangedEvent['reason']) => {
        broadcast('amd:apple-notes:changed', { reason, at: new Date().toISOString() });
      },
      onNotify: (title, body) => {
        try {
          if (Notification.isSupported()) new Notification({ title, body }).show();
        } catch {
          /* notifications are best-effort */
        }
      },
    });

    appleNotesEngineRef = appleNotesEngine;

    const applyHotkey = (target: HotkeyTarget, accelerator: string) =>
      registerHotkey(target, accelerator, () =>
        target === 'capture' ? toggleCaptureWindow() : showMainWindow(),
      );

    registerIpc({
      onHotkeyChange: applyHotkey,
      appleNotes: appleNotesEngine,
    });

    startAppleNotesScheduler(appleNotesEngine);

    createMainWindow();
    // Pre-create (hidden) so the first hotkey press is instant rather than paying window+webview
    // startup the moment the user is trying to jot something down.
    createCaptureWindow();
    setQuitHandler(() => shutdown());
    setAppMenuQuitHandler(() => shutdown());

    const captureState = applyHotkey('capture', state.hotkey);
    const mainState = applyHotkey('main', state.mainWindowHotkey);
    const failed = [captureState, mainState].filter((hotkey) => !hotkey.registered);
    // Create the tray after registration so its shortcut labels reflect the real state.
    createTray();
    installApplicationMenu();
    if (failed.length > 0) {
      // Surface failures instead of silently leaving a shortcut unavailable; the tray menu
      // repeats them and the settings dialog offers a way to record a different combination.
      for (const failure of failed) {
        console.warn(
          `[${APP_NAME}] global hotkey "${failure.accelerator}" not registered: ${failure.error}`,
        );
      }
      const window = BrowserWindow.getAllWindows()[0];
      window?.webContents.once('did-finish-load', () => {
        window.webContents.send('amd:hotkey-warning', getHotkeyStates());
      });
    }
  };

  const shutdown = (): void => {
    setQuitting(true);
    stopAppleNotesScheduler();
    unregisterAll();
    destroyAllWindows();
    destroyTray();
    app.quit();
  };

  void app.whenReady().then(bootstrap);

  app.on('window-all-closed', () => {
    // Stay resident: the tray + hotkey are the product. Only macOS-style quit ends the process,
    // and even then only when the user asked for it.
    if (isQuitting()) app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    else showMainWindow();
  });

  app.on('before-quit', () => {
    setQuitting(true);
    appleNotesEngineRef?.cancel();
  });

  app.on('will-quit', () => {
    unregisterAll();
  });

  process.on('SIGINT', () => shutdown());
  process.on('SIGTERM', () => shutdown());
}

export { getHotkeyState, getHotkeyStates, saveState };
