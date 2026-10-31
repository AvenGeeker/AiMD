import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  createNote,
  editorText,
  loginThroughUi,
  registerThroughUi,
  typeInEditor,
  uniqueEmail,
  waitForEditorBound,
} from './helpers.js';

/**
 * The CRDT acceptance tests: two devices on one note.
 *
 * These are the tests that justify choosing a CRDT over last-write-wins, so they assert the
 * property that actually matters — *both* sides' edits survive — rather than just "sync happened".
 */

/**
 * Sign in as the same user in a second browser context, i.e. a second device.
 *
 * A real second device authenticates rather than inheriting cookies, and this also keeps the test
 * honest about the login path. Each context gets its own IndexedDB, so the two really are
 * independent CRDT clients.
 */
async function secondDevice(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginThroughUi(page, email);
  // Let the initial note list and the first collaboration connection settle. Without this the
  // test clicks a row while React is still re-rendering the list under the cursor.
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-status', 'connected', {
    timeout: 20_000,
  });
  await page.waitForTimeout(500);
  return page;
}

/** Poll the server until the note body satisfies `check`, then return it. */
async function pollNoteBody(page: Page, noteId: string, timeout = 30_000): Promise<string> {
  let last = '';
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/notes/${noteId}`);
        if (!response.ok()) return false;
        last = ((await response.json()) as { body: string }).body;
        return (
          last.includes('【A在线前缀】') &&
          last.includes('【B离线追加】') &&
          last.includes('中间段落')
        );
      },
      { timeout, message: 'the merged body to reach the server' },
    )
    .toBe(true);
  return last;
}

/**
 * Open a note and wait until the editor is bound to its document.
 *
 * The click can land while the note list is still refetching (React re-renders the rows under the
 * cursor), so the selection is retried rather than assumed. The assertions that matter for CRDT
 * correctness are made against the server afterwards, so retrying here cannot mask a sync bug.
 */
async function openNote(page: Page, noteId: string): Promise<void> {
  await expect(page.getByTestId('workspace')).toBeVisible();
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-status', 'connected', {
    timeout: 20_000,
  });

  const row = page.locator(`[data-testid="note-item-${noteId}"]`);
  await expect(row).toBeVisible({ timeout: 20_000 });

  const host = page.getByTestId('editor-host');
  for (let attempt = 0; attempt < 5; attempt++) {
    await row.click();
    const bound = await host
      .getAttribute('data-note-id')
      .catch(() => null)
      .then(async (value) => {
        if (value === noteId) return true;
        // Give the view teardown/rebuild a moment before polling again.
        await page.waitForTimeout(600);
        return (await host.getAttribute('data-note-id').catch(() => null)) === noteId;
      });
    if (bound) return;
  }
  await waitForEditorBound(page, noteId); // produces the diagnostic failure
}

test.describe('multi-device CRDT sync', () => {
  test('a keystroke on one device appears on the other', async ({ page, browser }) => {
    const email = uniqueEmail('sync1');
    await registerThroughUi(page, email);
    const noteId = await createNote(page);
    await typeInEditor(page, '共同编辑的起点\n');
    await expect(page.getByTestId('sync-status')).toHaveAttribute('data-status', 'connected', {
      timeout: 20_000,
    });

    const otherPage = await secondDevice(browser, email);
    await openNote(otherPage, noteId);

    await expect(otherPage.locator('.cm-content')).toContainText('共同编辑的起点', { timeout: 20_000 });

    // Type on device A; device B must receive it over the WebSocket.
    await page.locator('.cm-content').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' — 来自设备A', { delay: 20 });

    await expect(otherPage.locator('.cm-content')).toContainText('来自设备A', { timeout: 20_000 });
    // And the server holds it, which is what a third device would load.
    await expect
      .poll(
        async () => ((await (await page.request.get(`/api/notes/${noteId}`)).json()) as { body: string }).body,
        { timeout: 20_000, message: 'device A\'s keystroke to be persisted' },
      )
      .toContain('来自设备A');

    // And the reverse direction.
    await otherPage.locator('.cm-content').click();
    await otherPage.keyboard.press('End');
    await otherPage.keyboard.type(' — 来自设备B', { delay: 20 });

    await expect(page.locator('.cm-content')).toContainText('来自设备B', { timeout: 20_000 });

    const finalText = await editorText(page);
    expect(finalText).toContain('共同编辑的起点');
    expect(finalText).toContain('来自设备A');
    expect(finalText).toContain('来自设备B');

    await otherPage.context().close();
  });

  test('offline edits on both devices merge without losing either', async ({ page, browser }) => {
    const email = uniqueEmail('sync2');
    await registerThroughUi(page, email);
    const noteId = await createNote(page);
    await typeInEditor(page, '# 同步测试\n\n中间段落\n');
    await expect(page.locator(`[data-testid="note-item-${noteId}"]`)).toContainText('同步测试', {
      timeout: 20_000,
    });

    const otherPage = await secondDevice(browser, email);
    await openNote(otherPage, noteId);
    await expect(otherPage.locator('.cm-content')).toContainText('中间段落', { timeout: 20_000 });

    // Device B goes offline. y-indexeddb keeps its edits; the server does not see them yet.
    await otherPage.context().setOffline(true);
    await otherPage.locator('.cm-content').click();
    await otherPage.keyboard.press('End');
    await otherPage.keyboard.type('【B离线追加】', { delay: 10 });
    await expect(otherPage.locator('.cm-content')).toContainText('【B离线追加】');

    // Device A edits a different part of the same document while B is offline.
    // Cmd/Ctrl+Home is required: a bare `Home` only reaches the start of the current line, which
    // would not put the prefix ahead of `中间段落`.
    await page.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.type('【A在线前缀】', { delay: 10 });
    await expect(page.locator('.cm-content')).toContainText('【A在线前缀】');

    // B comes back: Yjs must merge, not clobber.
    await otherPage.context().setOffline(false);
    await expect(otherPage.locator('.cm-content')).toContainText('【A在线前缀】', { timeout: 30_000 });
    await expect(page.locator('.cm-content')).toContainText('【B离线追加】', { timeout: 30_000 });

    // Both editors render both edits.
    await expect(page.locator('.cm-content')).toContainText('【A在线前缀】');
    await expect(otherPage.locator('.cm-content')).toContainText('【B离线追加】');

    /**
     * Convergence is then asserted against the server, not against `innerText`.
     *
     * CodeMirror virtualises off-screen lines, so the DOM only holds the current viewport and two
     * scrolled differently would legitimately produce different `innerText` for identical
     * documents. The persisted body is the authoritative merged state.
     */
    const merged = await pollNoteBody(page, noteId);
    expect(merged).toContain('# 同步测试');
    expect(merged).toContain('中间段落');
    expect(merged).toContain('【A在线前缀】');
    expect(merged).toContain('【B离线追加】');
    // Neither edit may be duplicated by the merge.
    expect(merged.split('【A在线前缀】').length - 1).toBe(1);
    expect(merged.split('【B离线追加】').length - 1).toBe(1);
    // Positional integrity: A typed at the head, B at the tail.
    expect(merged.indexOf('【A在线前缀】')).toBeLessThan(merged.indexOf('中间段落'));
    expect(merged.indexOf('中间段落')).toBeLessThan(merged.indexOf('【B离线追加】'));

    await otherPage.context().close();
  });

  test('offline edits survive reconnection and a subsequent reload', async ({ page }) => {
    const email = uniqueEmail('offline');
    await registerThroughUi(page, email);
    const noteId = await createNote(page);
    await typeInEditor(page, '离线持久化\n');
    await expect(page.getByTestId('sync-status')).toHaveAttribute('data-status', 'connected', {
      timeout: 20_000,
    });

    // Go offline and keep editing. y-indexeddb holds the change locally; the tab stays usable.
    await page.context().setOffline(true);
    await page.locator('.cm-content').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' — 断网时写入', { delay: 10 });
    await expect(page.locator('.cm-content')).toContainText('断网时写入');

    // Reconnect: the queued CRDT update must reach the server.
    await page.context().setOffline(false);
    await expect(page.getByTestId('sync-status')).toHaveAttribute('data-status', 'connected', {
      timeout: 30_000,
    });

    await expect
      .poll(
        async () => {
          const response = await page.request.get(`/api/notes/${noteId}`);
          if (!response.ok()) return '';
          return ((await response.json()) as { body: string }).body;
        },
        { timeout: 30_000, message: 'the offline edit should reach the server' },
      )
      .toContain('断网时写入');

    // A reload *while online* must show the persisted edit.
    // (Reloading while offline is out of scope for v1: there is no service worker, so the shell
    // itself cannot be fetched. Offline support covers an already-open tab.)
    await page.reload();
    await loginThroughUi(page, email);
    await page.locator(`[data-testid="note-item-${noteId}"]`).click();
    await waitForEditorBound(page, noteId);
    await expect(page.locator('.cm-content')).toContainText('断网时写入', { timeout: 20_000 });
  });

  test('quick capture appends without disturbing a concurrent edit', async ({ page, browser }) => {
    const email = uniqueEmail('sync4');
    await registerThroughUi(page, email);
    const treeResponse = await page.request.get('/api/tree');
    const tree = (await treeResponse.json()) as { settings: { inboxNoteId: string | null } };
    const inboxId = tree.settings.inboxNoteId;
    expect(inboxId).toBeTruthy();

    // Open the inbox in a "main window" device and start editing the middle of it.
    const otherPage = await secondDevice(browser, email);
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

    await otherPage.context().close();
  });
});
