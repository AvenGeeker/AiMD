import { expect, test } from '@playwright/test';
import {
  createNote,
  loginThroughUi,
  registerThroughUi,
  typeInEditor,
  uniqueEmail,
} from './helpers.js';

/**
 * Core workspace flows through the real UI, API and database.
 *
 * `workers: 1` in the config keeps these serial: they share one database and the assertions
 * depend on note counts.
 */

test.describe('workspace basics', () => {
  test('registers, creates a note and sees it in the list', async ({ page }) => {
    await registerThroughUi(page);

    const noteId = await createNote(page);
    expect(noteId).toBeTruthy();

    await typeInEditor(page, '# 我的第一篇笔记\n\n这是正文内容。\n');

    // The title is derived from the first heading once the CRDT round-trip lands.
    await expect(page.locator(`[data-testid="note-item-${noteId}"]`)).toContainText('我的第一篇笔记', {
      timeout: 15_000,
    });
  });

  test('renders markdown in the split preview as you type', async ({ page }) => {
    await registerThroughUi(page);
    await createNote(page);

    await expect(page.getByTestId('mode-split')).toHaveClass(/bg-accent/);

    await typeInEditor(page, '# 标题\n\n**加粗** 和 `代码`\n\n- [ ] 待办事项\n');

    const preview = page.locator('.markdown-preview');
    await expect(preview.locator('h1')).toHaveText('标题');
    await expect(preview.locator('strong')).toHaveText('加粗');
    await expect(preview.locator('code')).toHaveText('代码');
    await expect(preview.locator('input.task-list-item-checkbox')).toBeVisible();
  });

  test('switches between split, edit-only and preview-only', async ({ page }) => {
    await registerThroughUi(page);
    await createNote(page);
    await typeInEditor(page, '# 视图切换\n');

    await page.getByTestId('mode-preview').click();
    await expect(page.locator('.markdown-preview h1')).toHaveText('视图切换');
    await expect(page.locator('.cm-content')).toHaveCount(0);

    await page.getByTestId('mode-edit').click();
    await expect(page.locator('.cm-content')).toHaveCount(1);
    await expect(page.locator('.markdown-preview')).toHaveCount(0);

    await page.getByTestId('mode-split').click();
    await expect(page.locator('.cm-content')).toHaveCount(1);
    await expect(page.locator('.markdown-preview')).toHaveCount(1);
  });

  test('creates a folder, moves a note into it and filters by it', async ({ page }) => {
    await registerThroughUi(page);
    const noteId = await createNote(page);
    await typeInEditor(page, '# 归档笔记\n');

    // Create a folder through the sidebar prompt.
    page.once('dialog', (dialog) => void dialog.accept('工作'));
    await page.getByTestId('new-folder').click();
    await expect(page.getByText('工作').first()).toBeVisible();

    // Drag the note onto the folder row.
    const noteRow = page.locator(`[data-testid="note-item-${noteId}"]`);
    const folderRow = page.locator('[data-testid="sidebar"]').getByText('工作').first();
    await noteRow.dragTo(folderRow);

    // The note disappears from "all notes in root" only when a root filter is active; selecting
    // the folder must show it.
    await folderRow.click();
    await expect(page.locator(`[data-testid="note-item-${noteId}"]`)).toBeVisible();
  });

  test('shows quick captures in the dedicated sidebar view', async ({ page }) => {
    const email = uniqueEmail('captures');
    await registerThroughUi(page, email);

    const treeResponse = await page.request.get('/api/tree');
    const tree = (await treeResponse.json()) as { settings: { inboxNoteId: string | null } };
    const inboxId = tree.settings.inboxNoteId;
    expect(inboxId).toBeTruthy();

    const text = `速记里的内容-${Date.now()}`;
    const captureResponse = await page.request.post(`/api/notes/${inboxId}/capture`, {
      data: { text, stampFormat: 'heading' },
    });
    expect(captureResponse.ok()).toBe(true);

    await page.getByTestId('captures-link').click();
    await expect(page.getByTestId('capture-list')).toBeVisible();
    await expect(page.getByTestId('capture-item').first()).toContainText(text, { timeout: 20_000 });

    // Opening an entry reveals the inbox note itself, so it can still be edited in place.
    await page.getByTestId('capture-item').first().click();
    await expect(page.getByTestId('editor-host')).toHaveAttribute('data-note-id', inboxId!, {
      timeout: 20_000,
    });
    await expect(page.locator('.cm-content')).toContainText(text, { timeout: 20_000 });
  });

  test('tags a note through the right-rail editor and filters by it', async ({ page }) => {
    await registerThroughUi(page);
    const taggedId = await createNote(page);
    await typeInEditor(page, '# 带标签的笔记\n');
    await expect(page.locator(`[data-testid="note-item-${taggedId}"]`)).toContainText('带标签的笔记', {
      timeout: 15_000,
    });

    // The tag editor shares the collapsed right rail, so reveal it first.
    await page.getByTestId('toggle-outline').click();

    // Create + assign a tag entirely through the UI.
    const editor = page.getByTestId('tag-editor');
    await expect(editor).toBeVisible();
    await page.getByTestId('tag-input').fill('重要');
    await page.getByTestId('tag-add').click();
    await expect(editor.getByTestId('assigned-tag-重要')).toBeVisible();

    // The tag is now a filter chip in the sidebar.
    const chip = page.getByTestId('tag-重要');
    await expect(chip).toBeVisible();

    // A second, untagged note must be excluded by the filter.
    await page.getByTestId('all-notes').click();
    const otherId = await createNote(page);
    await typeInEditor(page, '# 无标签笔记\n');
    await expect(page.locator(`[data-testid="note-item-${otherId}"]`)).toContainText('无标签笔记', {
      timeout: 15_000,
    });

    await chip.click();
    await expect(page.locator(`[data-testid="note-item-${taggedId}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="note-item-${otherId}"]`)).toHaveCount(0);

    // Removing the tag through the editor clears the filter result.
    await page.locator(`[data-testid="note-item-${taggedId}"]`).click();
    await editor.getByRole('button', { name: '移除标签 重要' }).click();
    await expect(editor.getByTestId('assigned-tag-重要')).toHaveCount(0);
  });

  test('searches by a Chinese phrase', async ({ page }) => {
    await registerThroughUi(page);
    const noteId = await createNote(page);
    await typeInEditor(page, '# 会议纪要\n\n讨论了多端同步方案的细节。\n');
    // Let the CRDT store hook mirror the text into Postgres before searching.
    await expect(page.locator(`[data-testid="note-item-${noteId}"]`)).toContainText('会议纪要', {
      timeout: 15_000,
    });
    await page.waitForTimeout(2_500);

    await page.getByTestId('search-input').fill('同步方案');
    await page.getByTestId('search-input').press('Enter');

    await expect(page.locator('[data-testid^="note-item-"]')).toHaveCount(1);
    await expect(page.locator('[data-testid^="note-item-"]').first()).toContainText('会议纪要');
  });

  test('rejects a single-character search with a visible hint', async ({ page }) => {
    await registerThroughUi(page);
    await page.getByTestId('search-input').fill('a');
    await expect(page.getByText(/至少 2 个字符/)).toBeVisible();
  });

  test('moves a note to the trash and restores it', async ({ page }) => {
    await registerThroughUi(page);
    const noteId = await createNote(page);
    await typeInEditor(page, '# 待删除\n');
    await expect(page.locator(`[data-testid="note-item-${noteId}"]`)).toContainText('待删除', {
      timeout: 15_000,
    });

    const row = page.locator(`[data-testid="note-item-${noteId}"]`);
    await row.hover();
    await row.getByRole('button', { name: '删除' }).click();
    await expect(page.locator(`[data-testid="note-item-${noteId}"]`)).toHaveCount(0);

    await page.getByTestId('trash-link').click();
    await expect(page.locator(`[data-testid="note-item-${noteId}"]`)).toBeVisible();

    const trashRow = page.locator(`[data-testid="note-item-${noteId}"]`);
    await trashRow.hover();
    await trashRow.getByRole('button', { name: '恢复' }).click();

    await page.getByTestId('all-notes').click();
    await expect(page.locator(`[data-testid="note-item-${noteId}"]`)).toBeVisible();
  });

  test('opens account details without logging out and can close them again', async ({ page }) => {
    const email = await registerThroughUi(page);

    const userButton = page.getByTestId('user-menu-button');
    await userButton.click();
    await expect(page.getByTestId('user-menu')).toBeVisible();
    await expect(page.getByTestId('user-menu')).toContainText(email);
    await expect(page.getByTestId('auth-view')).toHaveCount(0);

    // Dismissing the popover must return to the workspace and keep the session intact.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('user-menu')).toHaveCount(0);
    await expect(page.getByTestId('workspace')).toBeVisible();

    await userButton.click();
    await page.getByTestId('user-menu-close').click();
    await expect(page.getByTestId('user-menu')).toHaveCount(0);
    await expect(page.getByTestId('workspace')).toBeVisible();
  });

  test('persists everything across logout and login', async ({ page }) => {
    const email = uniqueEmail('persist');
    await registerThroughUi(page, email);
    const noteId = await createNote(page);
    await typeInEditor(page, '# 持久化验证\n\n重新登录后仍然在。\n');
    await expect(page.locator(`[data-testid="note-item-${noteId}"]`)).toContainText('持久化验证', {
      timeout: 15_000,
    });
    await page.waitForTimeout(2_000);

    await page.getByTestId('user-menu-button').click();
    await expect(page.getByTestId('user-menu')).toBeVisible();
    await page.getByTestId('logout').click();
    await expect(page.getByTestId('auth-view')).toBeVisible();

    await loginThroughUi(page, email);
    await expect(page.locator(`[data-testid="note-item-${noteId}"]`)).toBeVisible();
    await page.locator(`[data-testid="note-item-${noteId}"]`).click();
    await expect(page.locator('.markdown-preview')).toContainText('重新登录后仍然在');
  });

  test('keeps the outline hidden until toggled', async ({ page }) => {
    await registerThroughUi(page);
    await createNote(page);
    await typeInEditor(page, '# 一级\n\n## 二级 A\n\n正文\n\n## 二级 B\n');

    // The rail is a per-device preference and starts hidden so the editor gets the width.
    await expect(page.getByTestId('outline')).toHaveCount(0);
    await page.getByTestId('toggle-outline').click();

    const outline = page.getByTestId('outline');
    await expect(outline).toContainText('一级');
    await expect(outline).toContainText('二级 A');
    await expect(outline).toContainText('二级 B');

    await page.getByTestId('toggle-outline').click();
    await expect(page.getByTestId('outline')).toHaveCount(0);
  });

  test('hides and restores the left sidebar', async ({ page }) => {
    await registerThroughUi(page);

    await expect(page.getByTestId('sidebar')).toBeVisible();
    await page.getByTestId('toggle-sidebar').click();
    await expect(page.getByTestId('sidebar')).toHaveCount(0);

    await page.getByTestId('toggle-sidebar').click();
    await expect(page.getByTestId('sidebar')).toBeVisible();
    await expect(page.getByTestId('all-notes')).toBeVisible();
  });

  test('escapes raw HTML in the preview (no script execution)', async ({ page }) => {
    await registerThroughUi(page);
    await createNote(page);

    let alerted = false;
    page.on('dialog', async (dialog) => {
      alerted = true;
      await dialog.dismiss();
    });

    await typeInEditor(page, '<script>window.__pwned = true</script>\n\n<img src=x onerror="window.__pwned = true">\n');
    await page.waitForTimeout(1_000);

    expect(alerted).toBe(false);
    const pwned = await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned);
    expect(pwned).toBeUndefined();
    // The markup is shown as inert text rather than executed.
    await expect(page.locator('.markdown-preview')).toContainText('<script>');
  });
});

test.describe('desktop server settings', () => {
  test('lets the user return to the server URL form and starts over after a change', async ({
    page,
    baseURL,
  }) => {
    expect(baseURL).toBeTruthy();

    // Simulate the Electron preload bridge so the web bundle takes its desktop code path.
    await page.addInitScript((initialServerUrl) => {
      const state: {
        serverUrl: string;
        accessToken: string | null;
        refreshToken: string | null;
      } = { serverUrl: initialServerUrl, accessToken: null, refreshToken: null };

      (window as unknown as { aiMarkdown: unknown }).aiMarkdown = {
        platform: 'darwin',
        appVersion: 'test',
        getServerUrl: async () => state.serverUrl,
        setServerUrl: async (url: string) => {
          state.serverUrl = url;
        },
        getTokens: async () => ({
          accessToken: state.accessToken,
          refreshToken: state.refreshToken,
        }),
        setTokens: async (tokens: { accessToken: string | null; refreshToken: string | null }) => {
          state.accessToken = tokens.accessToken;
          state.refreshToken = tokens.refreshToken;
        },
        setHotkey: async () => ({ ok: true }),
        getHotkeyState: async () => ({ accelerator: 'Alt+Space', registered: true }),
        showMainWindow: async () => {},
        hideQuickCapture: async () => {},
      };
    }, baseURL!);

    await page.goto('/');
    await expect(page.getByTestId('auth-view')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('email').fill('someone@example.com');
    await page.getByTestId('password').fill('password123');

    await page.getByTestId('edit-server-url').click();
    await expect(page.getByTestId('server-url')).toHaveValue(baseURL!);

    await page.getByTestId('server-url').fill('https://notes.example.com');
    await page.getByTestId('auth-submit').click();

    // The login form is back, but credentials typed for the previous server are gone.
    await expect(page.getByTestId('email')).toHaveValue('');
    await expect(page.getByTestId('password')).toHaveValue('');
    await expect(page.getByText('当前服务器：https://notes.example.com')).toBeVisible();
    await expect(page.getByTestId('edit-server-url')).toBeVisible();
    await expect(page.getByTestId('auth-error')).toHaveCount(0);
  });

  test('records separate main-window and data-window shortcuts from the keyboard', async ({
    page,
    baseURL,
  }) => {
    expect(baseURL).toBeTruthy();

    await page.addInitScript((initialServerUrl) => {
      const state = {
        serverUrl: initialServerUrl,
        accessToken: null as string | null,
        refreshToken: null as string | null,
        hotkeys: {
          capture: { accelerator: 'Alt+Space', registered: true },
          main: { accelerator: 'CommandOrControl+Shift+M', registered: true },
        },
      };
      const changes: Array<[string, string]> = [];
      (window as unknown as { __hotkeyChanges: Array<[string, string]> }).__hotkeyChanges = changes;
      (window as unknown as { aiMarkdown: unknown }).aiMarkdown = {
        platform: 'win32',
        appVersion: 'test',
        getServerUrl: async () => state.serverUrl,
        setServerUrl: async (url: string) => {
          state.serverUrl = url;
        },
        getTokens: async () => ({
          accessToken: state.accessToken,
          refreshToken: state.refreshToken,
        }),
        setTokens: async (tokens: { accessToken: string | null; refreshToken: string | null }) => {
          state.accessToken = tokens.accessToken;
          state.refreshToken = tokens.refreshToken;
        },
        getHotkeyStates: async () => state.hotkeys,
        setHotkey: async (target: 'capture' | 'main', accelerator: string) => {
          changes.push([target, accelerator]);
          state.hotkeys = {
            ...state.hotkeys,
            [target]: { accelerator, registered: true },
          };
          return { ok: true };
        },
        applySettings: async () => ({ hotkeys: state.hotkeys }),
        showMainWindow: async () => {},
        hideQuickCapture: async () => {},
      };
    }, baseURL!);

    await registerThroughUi(page);
    await page.getByTestId('open-settings').click();

    await page.getByTestId('hotkey-main-input').click();
    await page.keyboard.press('Control+Shift+K');
    await expect(page.getByTestId('hotkey-main-input')).toContainText('Ctrl + Shift + K');

    await page.getByTestId('hotkey-input').click();
    await page.keyboard.press('Control+Alt+P');
    await expect(page.getByTestId('hotkey-input')).toContainText('Ctrl + Alt + P');

    const changes = await page.evaluate(
      () => (window as unknown as { __hotkeyChanges: Array<[string, string]> }).__hotkeyChanges,
    );
    expect(changes).toEqual([
      ['main', 'CommandOrControl+Shift+K'],
      ['capture', 'CommandOrControl+Alt+P'],
    ]);
  });
});
