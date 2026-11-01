import { expect, type Page } from '@playwright/test';

/** Shared E2E helpers. */

let counter = 0;
export function uniqueEmail(prefix = 'e2e'): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}@example.com`;
}

/** Register through the UI and land on the workspace. */
export async function registerThroughUi(page: Page, email = uniqueEmail()): Promise<string> {
  await page.goto('/');
  await page.getByTestId('auth-view').waitFor();
  await page.getByTestId('email').fill(email);
  await page.getByTestId('password').fill('password123');
  // The form defaults to login; switch to the register tab. Targeted by test id because the tab
  // and the submit button can share a visible label.
  await page.getByTestId('auth-mode-register').click();
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('workspace')).toBeVisible();
  return email;
}

export async function loginThroughUi(page: Page, email: string, password = 'password123'): Promise<void> {
  await page.goto('/');
  await page.getByTestId('auth-view').waitFor();
  await page.getByTestId('email').fill(email);
  await page.getByTestId('password').fill(password);
  await page.getByTestId('auth-mode-login').click();
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('workspace')).toBeVisible({ timeout: 20_000 });
}

/**
 * Create a note through the UI and return its id.
 *
 * The id is read from the workspace's `data-active-note-id` attribute rather than inferred from the
 * note list: the inbox note is pinned and always sorts first, and the list may not have finished
 * loading when a test starts, so both "take the first row" and "diff the rows" are unreliable.
 */
export async function createNote(page: Page): Promise<string> {
  const workspace = page.getByTestId('workspace');
  // The inbox is auto-selected shortly after registration. Wait for that initial selection to
  // settle before recording the baseline; otherwise this helper can mistake the inbox selection
  // for the newly created note under load.
  await expect
    .poll(async () => (await workspace.getAttribute('data-active-note-id')) ?? '', {
      timeout: 20_000,
      message: 'the initial note should be selected before creating another one',
    })
    .not.toBe('');
  const previous = (await workspace.getAttribute('data-active-note-id')) ?? '';

  await page.getByTestId('new-note').click();

  await expect
    .poll(async () => (await workspace.getAttribute('data-active-note-id')) ?? '', {
      timeout: 20_000,
      message: 'a new note should become the active one',
    })
    .not.toBe(previous);

  const id = (await workspace.getAttribute('data-active-note-id')) ?? '';
  expect(id).toBeTruthy();
  expect(id).not.toBe(previous);

  await expect(page.locator(`[data-testid="note-item-${id}"]`)).toBeVisible();
  await waitForEditorBound(page, id);
  return id;
}

/**
 * Wait until the mounted CodeMirror instance is bound to `noteId`.
 *
 * The editor view is destroyed and recreated when the selection changes. Until that has happened,
 * `.cm-content` still belongs to the *previous* note, and typing would silently edit the wrong
 * document — which looks exactly like a sync bug.
 */
export async function waitForEditorBound(page: Page, noteId: string): Promise<void> {
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.getByTestId('editor-host')).toHaveAttribute('data-note-id', noteId, {
    timeout: 20_000,
  });
}

/** Type into the CodeMirror editor. CodeMirror needs real key events, not fill(). */
export async function typeInEditor(page: Page, text: string): Promise<void> {
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+KeyA');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text, { delay: 5 });
}

export async function editorText(page: Page): Promise<string> {
  return page.locator('.cm-content').innerText();
}

/** Wait until the collaboration status pill reports a given state. */
export async function expectSyncStatus(page: Page, status: 'connected' | 'disconnected' | 'connecting'): Promise<void> {
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-status', status);
}
