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
    await expect(page.getByTestId('note-title-input')).toHaveValue('我的第一篇笔记', { timeout: 15_000 });
    await expect(page.locator(`[data-testid="note-item-${noteId}"]`)).toContainText('我的第一篇笔记');
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

  test('tags a note through the right-rail editor and filters by it', async ({ page }) => {
    await registerThroughUi(page);
    const taggedId = await createNote(page);
    await typeInEditor(page, '# 带标签的笔记\n');
    await expect(page.getByTestId('note-title-input')).toHaveValue('带标签的笔记', { timeout: 15_000 });

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
    await expect(page.getByTestId('note-title-input')).toHaveValue('无标签笔记', { timeout: 15_000 });

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
    await createNote(page);
    await typeInEditor(page, '# 会议纪要\n\n讨论了多端同步方案的细节。\n');
    // Let the CRDT store hook mirror the text into Postgres before searching.
    await expect(page.getByTestId('note-title-input')).toHaveValue('会议纪要', { timeout: 15_000 });
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
    await expect(page.getByTestId('note-title-input')).toHaveValue('待删除', { timeout: 15_000 });

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

  test('persists everything across logout and login', async ({ page }) => {
    const email = uniqueEmail('persist');
    await registerThroughUi(page, email);
    const noteId = await createNote(page);
    await typeInEditor(page, '# 持久化验证\n\n重新登录后仍然在。\n');
    await expect(page.getByTestId('note-title-input')).toHaveValue('持久化验证', { timeout: 15_000 });
    await page.waitForTimeout(2_000);

    await page.getByTestId('logout').click();
    await expect(page.getByTestId('auth-view')).toBeVisible();

    await loginThroughUi(page, email);
    await expect(page.locator(`[data-testid="note-item-${noteId}"]`)).toBeVisible();
    await page.locator(`[data-testid="note-item-${noteId}"]`).click();
    await expect(page.locator('.markdown-preview')).toContainText('重新登录后仍然在');
  });

  test('shows the outline built from headings', async ({ page }) => {
    await registerThroughUi(page);
    await createNote(page);
    await typeInEditor(page, '# 一级\n\n## 二级 A\n\n正文\n\n## 二级 B\n');
    const outline = page.getByTestId('outline');
    await expect(outline).toContainText('一级');
    await expect(outline).toContainText('二级 A');
    await expect(outline).toContainText('二级 B');
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
