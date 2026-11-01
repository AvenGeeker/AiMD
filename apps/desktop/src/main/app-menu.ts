import { app, Menu, type MenuItemConstructorOptions } from 'electron';
import { createMainWindow, getMainWindow, showMainWindow, toggleCaptureWindow } from './windows.js';
import { setQuitting } from './lifecycle.js';
import { APP_NAME } from './app-name.js';

/**
 * Native application menu.
 *
 * The web TitleBar already groups the workspace actions (view mode, rails, import/export, AI,
 * settings, account). macOS users expect the same capabilities in the system menu bar, so this
 * module mirrors them instead of leaving the default Electron menu in place.
 *
 * Two directions:
 *  - renderer → shell: `updateAppMenuState()` receives checked/labels/enabled flags so the menu
 *    stays truthful (radio mode, rail checkboxes, sync status, account details).
 *  - shell → renderer: clicks dispatch a typed command through the preload bridge, where the
 *    existing React handlers run. Commands queued before the renderer is ready are flushed once
 *    the workspace reports `amd:menu-ready`.
 */

export type MenuCommand =
  | 'new-note'
  | 'quick-capture'
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

export interface AppMenuState {
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

const DEFAULT_STATE: AppMenuState = {
  authenticated: false,
  syncStatus: 'unknown',
  pendingCount: 0,
  mode: 'split',
  sidebarVisible: true,
  outlineVisible: false,
  hasSelectedNote: false,
  user: null,
  appleNotesAvailable: false,
  appleNotesEnabled: false,
  appleNotesRunning: false,
  appleNotesPhase: 'disabled',
  appleNotesLastSyncAt: null,
  appleNotesAttention: 0,
};

let state: AppMenuState = { ...DEFAULT_STATE };
let quitHandler: (() => void) | null = null;
let readyWebContentsId: number | null = null;
let queuedCommands: MenuCommand[] = [];

export function setAppMenuQuitHandler(handler: () => void): void {
  quitHandler = handler;
}

const asString = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback;

/**
 * Merge a renderer snapshot into the menu state.
 *
 * The renderer is remote content, so every field is validated here rather than trusted. Rebuild
 * only when something actually changed: rebuilding while a menu is open would close it.
 */
export function updateAppMenuState(value: unknown): void {
  const input = (value ?? {}) as Record<string, unknown>;
  const next: AppMenuState = { ...state };

  if (typeof input.authenticated === 'boolean') next.authenticated = input.authenticated;
  if (typeof input.syncStatus === 'string') next.syncStatus = input.syncStatus;
  if (typeof input.pendingCount === 'number' && Number.isFinite(input.pendingCount)) {
    next.pendingCount = Math.max(0, Math.trunc(input.pendingCount));
  }
  if (input.mode === 'split' || input.mode === 'edit' || input.mode === 'preview') {
    next.mode = input.mode;
  }
  if (typeof input.sidebarVisible === 'boolean') next.sidebarVisible = input.sidebarVisible;
  if (typeof input.outlineVisible === 'boolean') next.outlineVisible = input.outlineVisible;
  if (typeof input.hasSelectedNote === 'boolean') next.hasSelectedNote = input.hasSelectedNote;
  if (typeof input.appleNotesAvailable === 'boolean') {
    next.appleNotesAvailable = input.appleNotesAvailable;
  }
  if (typeof input.appleNotesEnabled === 'boolean') next.appleNotesEnabled = input.appleNotesEnabled;
  if (typeof input.appleNotesRunning === 'boolean') next.appleNotesRunning = input.appleNotesRunning;
  if (typeof input.appleNotesPhase === 'string') next.appleNotesPhase = input.appleNotesPhase;
  if (typeof input.appleNotesLastSyncAt === 'string' || input.appleNotesLastSyncAt === null) {
    next.appleNotesLastSyncAt = input.appleNotesLastSyncAt;
  }
  if (typeof input.appleNotesAttention === 'number' && Number.isFinite(input.appleNotesAttention)) {
    next.appleNotesAttention = Math.max(0, Math.trunc(input.appleNotesAttention));
  }

  if (input.user === null) {
    next.user = null;
  } else if (input.user && typeof input.user === 'object') {
    const user = input.user as Record<string, unknown>;
    next.user = {
      displayName: asString(user.displayName, ''),
      email: asString(user.email, ''),
      createdAt: asString(user.createdAt, ''),
    };
  }

  if (!next.authenticated) {
    next.user = null;
    next.hasSelectedNote = false;
  }

  if (JSON.stringify(next) === JSON.stringify(state)) return;
  state = next;
  rebuildApplicationMenu();
}

/** Called by the main-window renderer once its command listener is installed. */
export function markAppMenuReady(webContentsId: number): void {
  readyWebContentsId = webContentsId;
  const pending = queuedCommands;
  queuedCommands = [];
  for (const command of pending) sendCommand(command);
}

function quitApplication(): void {
  setQuitting(true);
  if (quitHandler) quitHandler();
  else app.quit();
}

function dispatch(command: MenuCommand): void {
  // Menu actions operate on the workspace, so surface the main window even when the tray/capture
  // panel had focus. Commands before the bridge is ready wait instead of disappearing.
  if (!getMainWindow()) createMainWindow();
  showMainWindow();
  sendCommand(command);
}

function sendCommand(command: MenuCommand): void {
  const window = getMainWindow();
  if (!window) {
    if (!queuedCommands.includes(command)) queuedCommands.push(command);
    return;
  }
  if (window.webContents.id !== readyWebContentsId) {
    if (!queuedCommands.includes(command)) queuedCommands.push(command);
    return;
  }
  window.webContents.send('amd:menu-command', command);
}

function commandItem(
  label: string,
  command: MenuCommand,
  options: { accelerator?: string; enabled?: boolean } = {},
): MenuItemConstructorOptions {
  return {
    label,
    accelerator: options.accelerator,
    enabled: options.enabled ?? state.authenticated,
    click: () => dispatch(command),
  };
}

function syncLabel(): string {
  switch (state.syncStatus) {
    case 'connected':
      return state.pendingCount > 0 ? `已同步 · ${state.pendingCount} 篇待同步` : '已同步';
    case 'connecting':
      return '同步中…';
    case 'disconnected':
      return '离线（修改已本地保存）';
    case 'denied':
      return '同步被拒绝，请重新登录';
    default:
      return '同步状态未知';
  }
}

function appleNotesLabel(): string {
  if (!state.appleNotesEnabled) return '备忘录同步：未启用';
  if (state.appleNotesAttention > 0) {
    return `备忘录同步：${state.appleNotesAttention} 项需要处理`;
  }
  if (state.appleNotesPhase === 'error') return '备忘录同步：失败';
  if (state.appleNotesPhase === 'needs-attention') return '备忘录同步：需要处理';
  if (state.appleNotesRunning) return '备忘录同步：同步中…';
  if (!state.appleNotesLastSyncAt) return '备忘录同步：等待首次预览';
  const time = new Date(state.appleNotesLastSyncAt).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `备忘录同步：${time} 已同步`;
}

function formatJoinedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

function viewItems(): MenuItemConstructorOptions[] {
  return [
    {
      label: '分栏',
      type: 'radio',
      checked: state.mode === 'split',
      accelerator: 'CmdOrCtrl+1',
      enabled: state.authenticated,
      click: () => dispatch('mode-split'),
    },
    {
      label: '编辑',
      type: 'radio',
      checked: state.mode === 'edit',
      accelerator: 'CmdOrCtrl+2',
      enabled: state.authenticated,
      click: () => dispatch('mode-edit'),
    },
    {
      label: '预览',
      type: 'radio',
      checked: state.mode === 'preview',
      accelerator: 'CmdOrCtrl+3',
      enabled: state.authenticated,
      click: () => dispatch('mode-preview'),
    },
    { type: 'separator' },
    {
      label: '显示侧边栏',
      type: 'checkbox',
      checked: state.sidebarVisible,
      accelerator: 'CmdOrCtrl+\\',
      enabled: state.authenticated,
      click: () => dispatch('toggle-sidebar'),
    },
    {
      label: '显示大纲与标签',
      type: 'checkbox',
      checked: state.outlineVisible,
      accelerator: 'CmdOrCtrl+Shift+O',
      enabled: state.authenticated,
      click: () => dispatch('toggle-outline'),
    },
    { type: 'separator' },
    { label: `同步状态：${syncLabel()}`, enabled: false },
    ...(state.pendingCount > 0
      ? [{ label: `${state.pendingCount} 篇修改等待同步`, enabled: false } as MenuItemConstructorOptions]
      : []),
    { type: 'separator' },
    { role: 'resetZoom', label: '实际大小' },
    { role: 'zoomIn', label: '放大' },
    { role: 'zoomOut', label: '缩小' },
    { type: 'separator' },
    { role: 'togglefullscreen', label: '切换全屏幕' },
  ];
}

function toolsItems(): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [
    commandItem('AI 总结与待办', 'open-ai', { accelerator: 'CmdOrCtrl+Shift+A' }),
  ];

  if (process.platform !== 'darwin') {
    items.push({ type: 'separator' });
    items.push(commandItem('设置…', 'open-settings', { accelerator: 'CmdOrCtrl+,' }));
  }

  if (state.appleNotesAvailable) {
    items.push({ type: 'separator' });
    items.push({
      label: 'macOS 备忘录',
      submenu: [
        { label: appleNotesLabel(), enabled: false },
        {
          label: state.appleNotesEnabled ? '立即同步备忘录' : '启用备忘录同步…',
          enabled: state.authenticated && !state.appleNotesRunning,
          click: () =>
            dispatch(state.appleNotesEnabled ? 'apple-notes-sync' : 'apple-notes-settings'),
        },
        commandItem('打开备忘录同步设置…', 'apple-notes-settings'),
      ],
    });
  }

  return items;
}

function accountItems(): MenuItemConstructorOptions[] {
  if (!state.user) {
    return [{ label: '尚未登录', enabled: false }];
  }
  return [
    { label: state.user.displayName || '（未命名）', enabled: false },
    { label: state.user.email, enabled: false },
    { label: `注册于 ${formatJoinedAt(state.user.createdAt)}`, enabled: false },
    { type: 'separator' },
    commandItem('退出登录…', 'logout'),
  ];
}

function buildTemplate(): MenuItemConstructorOptions[] {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [];

  if (isMac) {
    template.push({
      label: APP_NAME,
      submenu: [
        { role: 'about', label: `关于 ${APP_NAME}` },
        { type: 'separator' },
        commandItem('设置…', 'open-settings', { accelerator: 'CmdOrCtrl+,' }),
        { type: 'separator' },
        { role: 'services', label: '服务' },
        { type: 'separator' },
        { role: 'hide', label: `隐藏 ${APP_NAME}` },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '显示全部' },
        { type: 'separator' },
        {
          label: `退出 ${APP_NAME}`,
          accelerator: 'CmdOrCtrl+Q',
          click: () => quitApplication(),
        },
      ],
    });
  }

  template.push({
    label: '文件',
    submenu: [
      commandItem('新建笔记', 'new-note', { accelerator: 'CmdOrCtrl+N' }),
      commandItem('速记…', 'quick-capture', { accelerator: 'CmdOrCtrl+Shift+Q' }),
      { type: 'separator' },
      commandItem('导入 Markdown / ZIP…', 'import', { accelerator: 'CmdOrCtrl+Shift+I' }),
      commandItem('导出当前笔记…', 'export-note', {
        accelerator: 'CmdOrCtrl+Shift+E',
        enabled: state.authenticated && state.hasSelectedNote,
      }),
      commandItem('导出整个笔记库…', 'export-vault'),
      { type: 'separator' },
      { role: 'close', label: '关闭窗口' },
      ...(!isMac
        ? [
            { type: 'separator' as const },
            { label: `退出 ${APP_NAME}`, click: () => quitApplication() },
          ]
        : []),
    ],
  });

  template.push({
    label: '编辑',
    submenu: [
      { role: 'undo', label: '撤销' },
      { role: 'redo', label: '重做' },
      { type: 'separator' },
      { role: 'cut', label: '剪切' },
      { role: 'copy', label: '复制' },
      { role: 'paste', label: '粘贴' },
      { role: 'selectAll', label: '全选' },
    ],
  });

  template.push({ label: '视图', submenu: viewItems() });
  template.push({ label: '工具', submenu: toolsItems() });
  template.push({ label: '账户', submenu: accountItems() });

  template.push({
    label: '窗口',
    submenu: [
      { role: 'minimize', label: '最小化' },
      { role: 'zoom', label: '缩放' },
      { type: 'separator' },
      { label: '打开主窗口', click: () => showMainWindow() },
      { label: '唤起速记窗口', click: () => toggleCaptureWindow() },
      { type: 'separator' },
      ...(isMac
        ? [
            { role: 'front' as const, label: '前置全部窗口' },
            { type: 'separator' as const },
          ]
        : []),
      { role: 'toggleDevTools', label: '开发者工具' },
    ],
  });

  if (!isMac) {
    template.push({ label: '帮助', submenu: [{ role: 'about', label: `关于 ${APP_NAME}` }] });
  }

  return template;
}

export function rebuildApplicationMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildTemplate()));
}

/** Install the menu at boot, before the renderer has reported any state. */
export function installApplicationMenu(): void {
  rebuildApplicationMenu();
}
