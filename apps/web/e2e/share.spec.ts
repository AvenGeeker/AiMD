import { expect, test } from '@playwright/test';
import { createNote, registerThroughUi, typeInEditor } from './helpers.js';

/** Public capability links: enable in the app, read in a fresh anonymous browser context. */

test.describe('public note sharing', () => {
  test('opens a shared note without login and revokes the link', async ({ page, browser }) => {
    await registerThroughUi(page);
    await createNote(page);
    await typeInEditor(page, '# 分享标题\n\n分享正文内容。\n');
    await expect(page.locator('.markdown-preview h1')).toHaveText('分享标题');

    await page.getByTestId('note-header-share').click();
    await expect(page.getByTestId('share-dialog')).toBeVisible();
    // The checkbox is controlled by the server response, so it flips only after the POST resolves.
    await page.getByTestId('share-toggle').click();
    await expect(page.getByTestId('share-url')).toBeVisible({ timeout: 15_000 });
    const shareUrl = await page.getByTestId('share-url').inputValue();
    expect(shareUrl).toMatch(/\/s\/[A-Za-z0-9_-]{32,64}$/);
    const token = new URL(shareUrl).pathname.split('/').pop() ?? '';

    const popupPromise = page.waitForEvent('popup');
    await page.getByTestId('share-open').click();
    const popup = await popupPromise;
    await expect(popup.getByTestId('public-share-title')).toHaveText('分享标题');
    await popup.close();

    await page.getByTestId('share-close').click();

    const anonymous = await browser.newContext();
    const publicPage = await anonymous.newPage();
    try {
      await publicPage.goto(shareUrl);
      await expect(publicPage.getByTestId('public-share-page')).toBeVisible();
      await expect(publicPage.getByTestId('public-share-title')).toHaveText('分享标题');
      await expect(publicPage.locator('.markdown-preview')).toContainText('分享正文内容。');

      await typeInEditor(page, '# 分享标题\n\n刷新后应看到的新正文。\n');
      await expect
        .poll(async () => {
          const response = await page.request.get(`/api/shares/${token}`);
          return ((await response.json()) as { body?: string }).body ?? '';
        }, { timeout: 20_000 })
        .toContain('刷新后应看到的新正文。');
      await publicPage.reload();
      await expect(publicPage.locator('.markdown-preview')).toContainText('刷新后应看到的新正文。');

      await page.getByTestId('note-header-share').click();
      await page.getByTestId('share-toggle').click();
      await expect(page.getByTestId('share-url')).toHaveCount(0, { timeout: 15_000 });
      await publicPage.reload();
      await expect(publicPage.getByTestId('public-share-error')).toContainText('分享链接已失效');
    } finally {
      await anonymous.close();
    }
  });
});
