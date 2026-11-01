import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const send = vi.fn();
  const window = { webContents: { id: 7, send } };
  return {
    send,
    window,
    setApplicationMenu: vi.fn(),
    showMainWindow: vi.fn(),
    toggleCaptureWindow: vi.fn(),
    getMainWindow: vi.fn(() => window),
    createMainWindow: vi.fn(() => window),
  };
});

vi.mock('electron', () => ({
  app: { name: 'aiMarkdown', quit: vi.fn() },
  Menu: {
    buildFromTemplate: (template: unknown) => template,
    setApplicationMenu: mocks.setApplicationMenu,
  },
}));

vi.mock('../src/main/windows.js', () => ({
  createMainWindow: mocks.createMainWindow,
  getMainWindow: mocks.getMainWindow,
  showMainWindow: mocks.showMainWindow,
  toggleCaptureWindow: mocks.toggleCaptureWindow,
}));

import {
  installApplicationMenu,
  markAppMenuReady,
  updateAppMenuState,
} from '../src/main/app-menu.js';

interface MenuItem {
  label?: string;
  type?: string;
  checked?: boolean;
  enabled?: boolean;
  submenu?: MenuItem[];
  click?: () => void;
}

function currentTemplate(): MenuItem[] {
  const calls = mocks.setApplicationMenu.mock.calls;
  return calls[calls.length - 1]?.[0] as MenuItem[];
}

function menu(label: string): MenuItem {
  const found = currentTemplate().find((item) => item.label === label);
  if (!found) throw new Error(`missing menu ${label}`);
  return found;
}

describe('desktop application menu', () => {
  beforeEach(() => {
    mocks.send.mockClear();
    mocks.showMainWindow.mockClear();
    updateAppMenuState({
      authenticated: true,
      syncStatus: 'connected',
      pendingCount: 3,
      mode: 'preview',
      sidebarVisible: false,
      outlineVisible: true,
      hasSelectedNote: true,
      user: { displayName: '测试用户', email: 'test@example.com', createdAt: '2026-01-02T03:04:05.000Z' },
      appleNotesAvailable: true,
      appleNotesEnabled: true,
      appleNotesRunning: false,
      appleNotesPhase: 'idle',
      appleNotesLastSyncAt: null,
    });
    installApplicationMenu();
  });

  it('groups the TitleBar actions and mirrors their state', () => {
    const labels = currentTemplate().map((item) => item.label);
    expect(labels).toEqual(
      expect.arrayContaining(['文件', '编辑', '视图', '工具', '账户', '窗口']),
    );

    const view = menu('视图').submenu ?? [];
    expect(view.find((item) => item.label === '预览')).toMatchObject({
      type: 'radio',
      checked: true,
    });
    expect(view.find((item) => item.label === '编辑')).toMatchObject({ checked: false });
    expect(view.find((item) => item.label === '显示侧边栏')).toMatchObject({
      type: 'checkbox',
      checked: false,
    });
    expect(view.find((item) => item.label === '显示大纲与标签')).toMatchObject({ checked: true });
    expect(view.find((item) => item.label === '同步状态：已同步 · 3 篇待同步')).toMatchObject({
      enabled: false,
    });

    const file = menu('文件').submenu ?? [];
    expect(file.find((item) => item.label === '导出当前笔记…')).toMatchObject({ enabled: true });

    const account = menu('账户').submenu ?? [];
    expect(account.map((item) => item.label)).toEqual(
      expect.arrayContaining(['测试用户', 'test@example.com', '退出登录…']),
    );
  });

  it('routes a menu click into the workspace command channel', () => {
    markAppMenuReady(7);
    const preview = (menu('视图').submenu ?? []).find((item) => item.label === '预览');
    preview?.click?.();

    expect(mocks.showMainWindow).toHaveBeenCalled();
    expect(mocks.send).toHaveBeenCalledWith('amd:menu-command', 'mode-preview');
  });
});
