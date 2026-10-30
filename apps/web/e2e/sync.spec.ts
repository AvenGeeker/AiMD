import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createNote, editorText, registerThroughUi, typeInEditor, uniqueEmail } from './helpers.js';

/**
 * The CRDT acceptance tests: two devices on one note.
 *
 * These are the tests that justify choosing a CRDT over last-write-wins, so they assert the
 * property that actually matters — *both* sides' edits survive — rather than just "sync happened".
 */

/** Clone a signed-in session into a second browser context, i.e. a second device. */
async function secondDevice(browser: Browser, source: Page): Promise<BrowserContext> {
  const state = await source.context().storageState();
  const context = await browser.newContext({ storageState: state });
  return context;
}

async function openNote(page: Page, noteId: string): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('workspace')).toBeVisible();
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-status', 'connected', {
    timeout: 20_000,
  });
  const row = page.locator(`[data-testid="note-item-${noteId}"]`);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  await expect(page.locator('.cm-content')).toBeVisible();
}

test.describe('multi-device CRDT sync', () => {
  test('a keystroke on one device appears on the other', async ({ page, browser }) => {
    await registerThroughUi(page);
    const noteId = await createNote(page);
    await typeInEditor(page, '共同编辑的起点\n');
    await expect(page.getByTestId('sync-status')).toHaveAttribute('data-status', 'connected', {
      timeout: 20_000,
    });

    const other = await secondDevice(browser, page);
    const otherPage = await other.newPage();
    await openNote(otherPage, noteId);

    await expect(otherPage.locator('.cm-content')).toContainText('共同编辑的起点', { timeout: 20_000 });

    // Type on device A; device B must receive it over the WebSocket.
    await page.locator('.cm-content').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' — 来自设备A', { delay: 20 });

    await expect(otherPage.locator('.cm-content')).toContainText('来自设备A', { timeout: 20_000 });

    // And the reverse direction.
    await otherPage.locator('.cm-content').click();
    await otherPage.keyboard.press('End');
    await otherPage.keyboard.type(' — 来自设备B', { delay: 20 });

    await expect(page.locator('.cm-content')).toContainText('来自设备B', { timeout: 20_000 });

    const finalText = await editorText(page);
    expect(finalText).toContain('共同编辑的起点');
    expect(finalText).toContain('来自设备A');
    expect(finalText).toContain('来自设备B');

    await other.close();
  });

  test('offline edits on both devices merge without losing either', async ({ page, browser }) => {
    await registerThroughUi(page);
    const noteId = await createNote(page);
    await typeInEditor(page, '# 同步测试\n\n中间段落\n');
    await expect(page.getByTestId('note-title-input')).toHaveValue('同步测试', { timeout: 20_000 });

    const other = await secondDevice(browser, page);
    const otherPage = await other.newPage();
    await openNote(otherPage, noteId);
    await expect(otherPage.locator('.cm-content')).toContainText('中间段落', { timeout: 20_000 });

    // Device B goes offline. y-indexeddb keeps its edits; the server does not see them yet.
    await other.setOffline(true);
    await otherPage.locator('.cm-content').click();
    await otherPage.keyboard.press('End');
    await otherPage.keyboard.type('【B离线追加】', { delay: 10 });
    await expect(otherPage.locator('.cm-content')).toContainText('【B离线追加】');

    // Device A edits a different part of the same document while B is offline.
    await page.locator('.cm-content').click();
    await page.keyboard.press('Home');
    await page.keyboard.type('【A在线前缀】', { delay: 10 });
    await expect(page.locator('.cm-content')).toContainText('【A在线前缀】');

    // B comes back: Yjs must merge, not clobber.
    await other.setOffline(false);
    await expect(otherPage.locator('.cm-content')).toContainText('【A在线前缀】', { timeout: 30_000 });
    await expect(page.locator('.cm-content')).toContainText('【B离线追加】', { timeout: 30_000 });

    const textA = await editorText(page);
    const textB = await editorText(otherPage);
    expect(textA).toBe(textB);
    expect(textA).toContain('# 同步测试');
    expect(textA).toContain('中间段落');
    expect(textA).toContain('【A在线前缀】');
    expect(textA).toContain('【B离线追加】');
    // Neither edit may be duplicated by the merge.
    expect(textA.split('【A在线前缀】').length - 1).toBe(1);
    expect(textA.split('【B离线追加】').length - 1).toBe(1);
    // Positional integrity: A typed at the head, B at the tail.
    expect(textA.indexOf('【A在线前缀】')).toBeLessThan(textA.indexOf('中间段落'));
    expect(textA.indexOf('中间段落')).toBeLessThan(textA.indexOf('【B离线追加】'));

    await other.close();
  });

  test('edits made while offline survive a reload from the local cache', async ({ page }) => {
    const email = uniqueEmail('offline');
    await registerThroughUi(page, email);
    const noteId = await createNote(page);
    await typeInEditor(page, '离线持久化\n');
    await expect(page.getByTestId('sync-status')).toHaveAttribute('data-status', 'connected', {
      timeout: 20_000,
    });

    await page.context().setOffline(true);
    await page.locator('.cm-content').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' — 断网时写入', { delay: 10 });
    await expect(page.locator('.cm-content')).toContainText('断网时写入');

    // Reload while still offline: y-indexeddb must restore the unsent edit.
    await page.reload();
    await page.locator(`[data-testid="note-item-${noteId}"]`).click();
    await expect(page.locator('.cm-content')).toContainText('断网时写入', { timeout: 20_000 });

    // Reconnect and confirm it reaches the server.
    await page.context().setOffline(false);
    await expect(page.getByTestId('sync-status')).toHaveAttribute('data-status', 'connected', {
      timeout: 30_000,
    });
    await page.waitForTimeout(3_000);

    const response = await page.request.get(`/api/notes/${noteId}`);
    expect(response.ok()).toBe(true);
    const note = (await response.json()) as { body: string };
    expect(note.body).toContain('断网时写入');
  });

  test('quick capture appends without disturbing a concurrent edit', async ({ page, browser }) => {
    await registerThroughUi(page);
    const treeResponse = await page.request.get('/api/tree');
    const tree = (await treeResponse.json()) as { settings: { inboxNoteId: string | null } };
    const inboxId = tree.settings.inboxNoteId;
    expect(inboxId).toBeTruthy();

    // Open the inbox in a "main window" device and start editing the middle of it.
    const other = await secondDevice(browser, page);
    const otherPage = await other.newPage();
    await openNote(otherPage, inboxId!);
    const before = await editorText(otherPage);

    // Capture from the first device while the second is mid-edit.
    await page.getByTestId('inbox-link').click();
    await expect(page.locator('.cm-content')).toBeVisible();
    await page.locator('.cm-content').click();
    await page.keyboard.press('End');
    await page.keyboard.type('【中间插入】', { delay: 10 });

    const captureResponse = await page.request.post(`/api/notes/${inboxId}/capture`, {
      data: { text: '速记内容XYZ', stampFormat: 'none' },
    });
    expect(captureResponse.ok()).toBe(true);

    // The editing device receives the capture at the end and keeps its own insertion.
    await expect(otherPage.locator('.cm-content')).toContainText('速记内容XYZ', { timeout: 25_000 });
    const after = await editorText(otherPage);
    expect(after).toContain('【中间插入】');
    expect(after).toContain('速记内容XYZ');
    expect(after.indexOf('速记内容XYZ')).toBeGreaterThan(after.indexOf('【中间插入】'));
    // The pre-existing inbox content was not lost.
    expect(after.length).toBeGreaterThan(before.length);

    await other.close();
  });
});
