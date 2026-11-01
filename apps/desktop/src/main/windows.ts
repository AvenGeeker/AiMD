import { BrowserWindow, screen } from 'electron';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getState } from './store.js';
import { isQuitting } from './lifecycle.js';
import { ensureRegularActivation } from './activation.js';

/** Window management: the main shell and the always-on-top quick-capture panel. */

// `__dirname` rather than `import.meta.url`: the main process is compiled to CommonJS, which is
// what Electron requires for a sandboxed preload to resolve correctly.
const MAIN_PRELOAD = resolve(__dirname, '../preload/main.js');
const CAPTURE_PRELOAD = resolve(__dirname, '../preload/quick-capture.js');
const RENDERER_DIR = resolve(__dirname, '../../renderer');

let mainWindow: BrowserWindow | null = null;
let captureWindow: BrowserWindow | null = null;

/**
 * Resolve the renderer entry.
 *
 * Dev mode points at the Vite server so the editor hot-reloads; packaged builds load the staged
 * bundle from `file://`. Relative asset paths in the Vite build (`base: './'`) are what make the
 * `file://` case work without a custom protocol.
 */
export function rendererUrl(route = ''): string {
  const devUrl = process.env.AIMARKDOWN_RENDERER_URL;
  if (devUrl) return `${devUrl.replace(/\/+$/, '')}/${route}`.replace(/([^:])\/\/$/, '$1/');

  const indexHtml = join(RENDERER_DIR, 'index.html');
  if (!existsSync(indexHtml)) {
    throw new Error(
      `renderer bundle missing at ${indexHtml}; build apps/web and run scripts/copy-renderer.mjs`,
    );
  }
  // Electron requires an explicit file:// URL; a bare path fails on Windows.
  return `file://${indexHtml}`;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

export function createMainWindow(): BrowserWindow {
  const existing = getMainWindow();
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return existing;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 560,
    show: false,
    backgroundColor: '#ffffff',
    title: 'aiMarkdown',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: MAIN_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    ensureRegularActivation();
    mainWindow?.show();
  });

  // Closing hides to the tray when the user asked for it, so a global-hotkey capture still works.
  mainWindow.on('close', (event: { preventDefault(): void }) => {
    if (getState().minimizeToTray && !isQuitting()) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  void mainWindow.loadURL(rendererUrl());
  return mainWindow;
}

export function showMainWindow(): void {
  ensureRegularActivation();
  const window = getMainWindow() ?? createMainWindow();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

export function getCaptureWindow(): BrowserWindow | null {
  return captureWindow && !captureWindow.isDestroyed() ? captureWindow : null;
}

/**
 * Create the quick-capture panel.
 *
 * It is created hidden and *never destroyed* on dismiss — hiding keeps the renderer (and its
 * Hocuspocus provider) warm, so the next capture opens instantly and any pending CRDT update
 * still gets flushed in the background.
 */
export function createCaptureWindow(): BrowserWindow {
  const existing = getCaptureWindow();
  if (existing) return existing;

  const { width: screenWidth } = screen.getPrimaryDisplay()?.workAreaSize ?? { width: 1440 };
  const width = Math.min(680, Math.max(420, Math.round(screenWidth * 0.45)));

  captureWindow = new BrowserWindow({
    width,
    height: 420,
    frame: false,
    transparent: false,
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    hasShadow: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: CAPTURE_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  // Float above full-screen apps and appear on every macOS Space. Keep macOS at the
  // `floating` level: AppKit places IME candidate panels around level 20, so the old
  // `screen-saver` level (1000) covered Chinese/Japanese input candidates. `floating`
  // still sits above normal windows, and `fullscreenable: false` (above) plus
  // `visibleOnFullScreen` keeps the panel visible over full-screen apps.
  captureWindow.setAlwaysOnTop(
    true,
    process.platform === 'darwin' ? 'floating' : 'screen-saver',
  );
  captureWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Bound at creation; `applySettings` recreates the window when the preference changes so the
  // listener cannot be left behind from a previous value.
  if (getState().hideOnBlur) {
    captureWindow.on('blur', () => hideCaptureWindow());
  }

  captureWindow.on('closed', () => {
    captureWindow = null;
  });

  void captureWindow.loadURL(rendererUrl());
  return captureWindow;
}

/** Toggle the capture panel: the hotkey both summons and dismisses it. */
export function toggleCaptureWindow(): void {
  const window = getCaptureWindow() ?? createCaptureWindow();
  if (window.isVisible() && window.isFocused()) {
    hideCaptureWindow();
    return;
  }
  window.center();
  window.show();
  window.focus();
  // Nudge the renderer to clear its buffer and refocus the editor.
  window.webContents.send('amd:capture-shown');
}

export function hideCaptureWindow(): void {
  const window = getCaptureWindow();
  if (!window) return;
  // Ask the renderer to flush pending CRDT updates before we hide it.
  window.webContents.send('amd:capture-flush');
  window.hide();
}

export function destroyAllWindows(): void {
  getCaptureWindow()?.destroy();
  captureWindow = null;
  const main = getMainWindow();
  if (main) {
    main.removeAllListeners('close');
    main.destroy();
  }
  mainWindow = null;
}
