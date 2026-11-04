import { expect, test } from '@playwright/test';
import { createNote, registerThroughUi, uniqueEmail } from './helpers.js';

/** Command palette (⌘K) and the inline quick-capture composer. */

test.describe('command palette & inline capture', () => {
  test('⌘K opens the palette and jumps to a note', async ({ page }) => {
    await registerThroughUi(page, uniqueEmail('palette'));

    // Create the target note, then move away to the inbox so the jump is observable.
    const targetId = await createNote(page);
    await page.getByTestId('note-title-input').fill('跳转目标笔记');
    const workspace = page.getByTestId('workspace');
    await page.getByTestId('inbox-link').click();
    await expect
      .poll(async () => (await workspace.getAttribute('data-active-note-id')) ?? '', { timeout: 15_000 })
      .not.toBe(targetId);

    await page.keyboard.press('Control+k');
    await expect(page.getByTestId('command-palette')).toBeVisible();
    await page.getByTestId('command-palette-input').fill('跳转目标');
    await expect(page.getByTestId('command-palette').getByText('跳转目标笔记')).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Enter');

    await expect
      .poll(async () => (await workspace.getAttribute('data-active-note-id')) ?? '', { timeout: 15_000 })
      .toBe(targetId);
  });

  test('the inline composer saves a capture and groups it under today', async ({ page }) => {
    await registerThroughUi(page, uniqueEmail('composer'));

    await page.getByTestId('captures-link').click();
    await expect(page.getByTestId('capture-list')).toBeVisible();
    await page.getByTestId('capture-composer-collapsed').click();

    const input = page.getByTestId('capture-composer-input');
    await input.fill('通过内联输入框记一条速记');
    await page.getByTestId('capture-composer-submit').click();

    const item = page.getByTestId('capture-item').first();
    await expect(item).toContainText('通过内联输入框记一条速记', { timeout: 20_000 });
    await expect(page.getByTestId('capture-day-header').first()).toContainText('今天');
    // The composer collapses again after a successful save.
    await expect(page.getByTestId('capture-composer-collapsed')).toBeVisible({ timeout: 15_000 });
  });
});
