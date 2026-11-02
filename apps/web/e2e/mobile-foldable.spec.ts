import { expect, test } from '@playwright/test';
import { registerThroughUi, uniqueEmail, waitForEditorBound } from './helpers.js';

/**
 * Foldable acceptance: the shared mobile shell must turn its extra width into usable panes,
 * then collapse cleanly when the device is folded or rotated back to phone width.
 */
test.use({
  viewport: { width: 700, height: 800 },
  hasTouch: true,
});

test('foldable: unfolded portrait uses list + editor and can hide the left pane', async ({ page }) => {
  await registerThroughUi(page, uniqueEmail('fold1'));
  const workspace = page.getByTestId('workspace');
  await expect(workspace).toHaveAttribute('data-layout', 'split');
  await expect(page.getByTestId('note-list')).toBeVisible();
  await expect(page.getByTestId('open-drawer')).toBeVisible();
  await expect(page.locator('[data-testid="sidebar"]')).toHaveCount(0);

  const id = (await workspace.getAttribute('data-active-note-id')) ?? '';
  expect(id).toBeTruthy();
  await page.locator(`[data-testid="note-item-${id}"]`).click();
  await waitForEditorBound(page, id);

  // In the two-pane layout the note list is the collapsible left pane; the editor stays put.
  await expect(page.getByTestId('mobile-editor-pane')).toBeVisible();
  await page.getByTestId('toggle-left-pane').click();
  await expect(page.getByTestId('note-list')).toHaveCount(0);
  await expect(page.getByTestId('mobile-editor-pane')).toBeVisible();
  await expect(page.getByTestId('toggle-left-pane')).toHaveAttribute('aria-label', '显示笔记列表');

  await page.getByTestId('toggle-left-pane').click();
  await expect(page.getByTestId('note-list')).toBeVisible();

  // Folding back to a phone-sized viewport returns to the single-pane flow without a reload.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(workspace).toHaveAttribute('data-layout', 'compact');
  await expect(page.getByTestId('back-to-list')).toBeVisible();
  await expect(page.getByTestId('mobile-editor-pane')).toBeVisible();

  // Unfolding again restores the split panes and the selected note.
  await page.setViewportSize({ width: 700, height: 800 });
  await expect(workspace).toHaveAttribute('data-layout', 'split');
  await expect(page.getByTestId('note-list')).toBeVisible();
  await expect(page.getByTestId('note-title-input')).toBeVisible();
});

test('foldable: expanded layout keeps the navigation sidebar and can hide it', async ({ page }) => {
  // A native WebView above the browser's mobile breakpoint still renders MobileShell. Emulate
  // that branch in Chromium so the persistent three-pane navigation is covered end to end.
  await page.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      if (query === '(max-width: 767px)') {
        return {
          matches: true,
          media: query,
          onchange: null,
          addListener() {},
          removeListener() {},
          addEventListener() {},
          removeEventListener() {},
          dispatchEvent() { return false; },
        } as MediaQueryList;
      }
      return real(query);
    };
  });
  await page.setViewportSize({ width: 900, height: 700 });
  await registerThroughUi(page, uniqueEmail('fold2'));

  const workspace = page.getByTestId('workspace');
  await expect(workspace).toHaveAttribute('data-layout', 'expanded');
  await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();
  await expect(page.getByTestId('note-list')).toBeVisible();
  await expect(page.getByTestId('open-drawer')).toHaveCount(0);

  await page.getByTestId('toggle-left-pane').click();
  await expect(page.locator('[data-testid="sidebar"]')).toHaveCount(0);
  await expect(page.getByTestId('note-list')).toBeVisible();
  await expect(page.getByTestId('toggle-left-pane')).toHaveAttribute('aria-label', '显示左侧栏');

  await page.getByTestId('toggle-left-pane').click();
  await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();
});
