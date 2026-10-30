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
  // The form defaults to login; switch to the register tab.
  await page.getByRole('button', { name: '注册' }).click();
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('workspace')).toBeVisible();
  return email;
}

export async function loginThroughUi(page: Page, email: string, password = 'password123'): Promise<void> {
  await page.goto('/');
  await page.getByTestId('auth-view').waitFor();
  await page.getByTestId('email').fill(email);
  await page.getByTestId('password').fill(password);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByTestId('workspace')).toBeVisible();
}

/** Create a note through the UI and return its id (parsed from the selected list row). */
export async function createNote(page: Page): Promise<string> {
  await page.getByTestId('new-note').click();
  // The new note is auto-selected; its list row carries the id in the test id.
  const selected = page.locator('[data-testid^="note-item-"]').first();
  await expect(selected).toBeVisible();
  const testId = await selected.getAttribute('data-testid');
  return (testId ?? '').replace('note-item-', '');
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
