import { expect, test, devices, type DeviceDescriptor } from '@playwright/test';
import {
  registerThroughUi,
  typeInEditor,
  uniqueEmail,
  waitForEditorBound,
} from './helpers.js';

/**
 * Responsive mobile shell acceptance.
 *
 * Runs the shared web bundle in a phone-sized, touch-enabled viewport (Chromium emulation of an
 * iPhone 13): list ⇄ editor navigation, the navigation drawer, and CRDT offline behaviour must
 * behave exactly like the desktop shell. The CRDT assertions are made against the server, never
 * against CodeMirror's DOM text (the editor virtualises off-screen lines).
 */

// Strip the descriptor's defaultBrowserType: this spec runs under the project's Chromium
// browser (the same engine as the other E2E specs); only viewport + touch emulation differ.
const iphone13 = { ...devices['iPhone 13'] } as DeviceDescriptor;
delete (iphone13 as { defaultBrowserType?: string }).defaultBrowserType;
test.use(iphone13);

/** Active note id from the workspace root, which is the same contract the desktop tests use. */
async function activeNoteId(page: import('@playwright/test').Page): Promise<string> {
  const workspace = page.getByTestId('workspace');
  await expect
    .poll(async () => (await workspace.getAttribute('data-active-note-id')) ?? '', { timeout: 20_000 })
    .not.toBe('');
  return (await workspace.getAttribute('data-active-note-id')) ?? '';
}

/** Create a note from the mobile header and wait for the editor to bind to it. */
async function createMobileNote(page: import('@playwright/test').Page): Promise<string> {
  const workspace = page.getByTestId('workspace');
  await expect
    .poll(async () => (await workspace.getAttribute('data-active-note-id')) ?? '', {
      timeout: 20_000,
      message: 'the initial mobile note should be selected before creating another one',
    })
    .not.toBe('');
  const previous = (await workspace.getAttribute('data-active-note-id')) ?? '';
  await page.getByTestId('mobile-new-note').click();
  await expect
    .poll(async () => (await workspace.getAttribute('data-active-note-id')) ?? '', {
      timeout: 20_000,
      message: 'a new note should become active on mobile',
    })
    .not.toBe(previous);
  const id = await activeNoteId(page);
  await waitForEditorBound(page, id);
  return id;
}

test('mobile shell: open a note, edit it, preview it, then return to the list', async ({ page }) => {
  const email = uniqueEmail('mob1');
  await registerThroughUi(page, email);

  // Land on the single-pane list view, not the desktop three-pane layout.
  await expect(page.getByTestId('workspace')).toBeVisible();
  await expect(page.getByTestId('note-list')).toBeVisible();
  await expect(page.getByTestId('open-drawer')).toBeVisible();
  await expect(page.locator('[data-testid="sidebar"]')).toHaveCount(0);

  // The auto-selected first note (the inbox) is highlighted, not opened.
  const id = await activeNoteId(page);
  await page.locator(`[data-testid="note-item-${id}"]`).click();
  await waitForEditorBound(page, id);

  await typeInEditor(page, '# 移动端测试\n');
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-status', 'connected', {
    timeout: 20_000,
  });
  // The server (not the editor DOM) is the source of truth.
  await expect
    .poll(
      async () =>
        ((await (await page.request.get(`/api/notes/${id}`)).json()) as { body: string }).body,
      { timeout: 20_000, message: 'mobile keystrokes to be persisted' },
    )
    .toContain('移动端测试');

  // Touch chrome present: back button, title input, bottom mode toggle.
  await expect(page.getByTestId('back-to-list')).toBeVisible();
  await expect(page.getByTestId('note-title-input')).toBeVisible();
  await page.getByTestId('mode-preview').click();
  await expect(page.locator('.markdown-preview')).toBeVisible();

  await page.getByTestId('back-to-list').click();
  await expect(page.getByTestId('note-list')).toBeVisible();
  await expect(page.getByTestId('editor-host')).toHaveCount(0);
});

test('mobile shell: drawer navigation filters and closes', async ({ page }) => {
  const email = uniqueEmail('mob2');
  await registerThroughUi(page, email);

  await page.getByTestId('open-drawer').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();
  await expect(page.getByTestId('search-input')).toBeVisible();

  // Selecting a filter applies it and dismisses the drawer.
  await page.getByTestId('all-notes').click();
  await expect(page.getByTestId('sidebar')).toHaveCount(0);
  await expect(page.getByTestId('note-list')).toBeVisible();
});

test('mobile shell: create a note and offline edits survive reconnection', async ({ page }) => {
  const email = uniqueEmail('mob3');
  await registerThroughUi(page, email);
  const id = await createMobileNote(page);

  await typeInEditor(page, '离线持久化\n');
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-status', 'connected', {
    timeout: 20_000,
  });

  // Go offline and keep editing; IndexedDB (y-indexeddb) holds the change locally.
  await page.context().setOffline(true);
  await page.locator('.cm-content').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' — 断网时写入', { delay: 10 });
  await expect(page.locator('.cm-content')).toContainText('断网时写入');

  await page.context().setOffline(false);
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-status', 'connected', {
    timeout: 30_000,
  });

  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/notes/${id}`);
        if (!response.ok()) return '';
        return ((await response.json()) as { body: string }).body;
      },
      { timeout: 30_000, message: 'the offline edit should reach the server' },
    )
    .toContain('断网时写入');
});
