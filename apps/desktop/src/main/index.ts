import { app, BrowserWindow, Notification } from 'electron';
import { getState, loadState, saveState } from './store.js';
import { isQuitting } from './lifecycle.js';
import { registerHotkey, unregisterAll, getHotkeyState } from './hotkey.js';
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
    loadState();
    const state = getState();
    // Read-before-write: on macOS an unsigned/dev build cannot always change login items, and
    // calling this unconditionally on every boot produces a spurious "Operation not permitted".
    const loginItem = setLaunchAtLogin(state.launchAtLogin);
    if (!loginItem.applied && state.launchAtLogin) {
      console.warn(`[aiMarkdown] 无法设置登录时启动：${loginItem.error ?? '未知原因'}`);
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

    registerIpc({
      onHotkeyChange: () => toggleCaptureWindow(),
      appleNotes: appleNotesEngine,
    });

    startAppleNotesScheduler(appleNotesEngine);

    createMainWindow();
    // Pre-create (hidden) so the first hotkey press is instant rather than paying window+webview
    // startup the moment the user is trying to jot something down.
    createCaptureWindow();
    createTray();
    setQuitHandler(() => shutdown());

    const hotkeyState = registerHotkey(state.hotkey, () => toggleCaptureWindow());
    if (!hotkeyState.registered) {
      // Surface the failure instead of silently having no hotkey; the tray menu repeats it and
      // the settings dialog offers a way to change the combination.
      console.warn(`[aiMarkdown] global hotkey "${state.hotkey}" not registered: ${hotkeyState.error}`);
      const window = BrowserWindow.getAllWindows()[0];
      window?.webContents.once('did-finish-load', () => {
        window.webContents.send('amd:hotkey-warning', hotkeyState);
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

export { getHotkeyState, saveState };
