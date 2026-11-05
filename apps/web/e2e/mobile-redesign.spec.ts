import { expect, test, devices, type DeviceDescriptor } from '@playwright/test';
import {
  listNoteIds,
  longPress,
  registerThroughUi,
  swipeRow,
  touchDrag,
  uniqueEmail,
  waitForEditorBound,
} from './helpers.js';

/**
 * Acceptance for the redesigned phone shell: tab bar, FAB, large-title list, swipe actions,
 * long-press multi-select with batch operations and undo, filter sheet, sort, pull-to-refresh
 * and the profile tab.
 *
 * Content assertions that matter (what a batch operation actually did) are made against the REST
 * API, never against list ordering or the editor DOM.
 */

const iphone13 = { ...devices['iPhone 13'] } as DeviceDescriptor;
delete (iphone13 as { defaultBrowserType?: string }).defaultBrowserType;
test.use(iphone13);
test.setTimeout(150_000);

async function createViaApi(page: import('@playwright/test').Page, title: string): Promise<string> {
  const response = await page.request.post('/api/notes', { data: { title, body: `${title} 的正文。` } });
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as { id: string }).id;
}

/** Wait for a refetch to surface `title` in the visible list. */
async function expectRowWithTitle(page: import('@playwright/test').Page, title: string) {
  await expect
    .poll(
      async () =>
        (await page.locator('[data-testid^="note-item-"]').allInnerTexts()).join('\n'),
      { timeout: 15_000, message: `the list should show ${title}` },
    )
    .toContain(title);
}

test('mobile redesign: tab bar switches surfaces and the FAB follows the tab', async ({ page }) => {
  await registerThroughUi(page, uniqueEmail('tab1'));

  await expect(page.getByTestId('mobile-tabbar')).toBeVisible();
  await expect(page.getByTestId('mobile-tab-notes')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('note-list')).toBeVisible();

  await page.getByTestId('mobile-tab-captures').click();
  await expect(page.getByTestId('capture-list')).toBeVisible();
  await expect(page.getByTestId('mobile-tab-captures')).toHaveAttribute('aria-selected', 'true');

  await page.getByTestId('mobile-tab-favorites').click();
  await expect(page.getByTestId('favorite-list')).toBeVisible();

  await page.getByTestId('mobile-tab-me').click();
  await expect(page.getByTestId('mobile-profile')).toBeVisible();

  // The FAB is contextual: on the notes tab it creates a note and opens the editor.
  await page.getByTestId('profile-back').click();
  await expect(page.getByTestId('mobile-new-note')).toBeVisible();
  const before = (await page.getByTestId('workspace').getAttribute('data-active-note-id')) ?? '';
  await page.getByTestId('mobile-new-note').click();
  // The create mutation resolves asynchronously; wait for the selection to move before binding.
  await expect
    .poll(async () => (await page.getByTestId('workspace').getAttribute('data-active-note-id')) ?? '', {
      timeout: 20_000,
      message: 'the FAB should create and open a new note',
    })
    .not.toBe(before);
  await waitForEditorBound(page, (await page.getByTestId('workspace').getAttribute('data-active-note-id')) ?? '');
  // The editor owns the bottom edge: no tab bar, no FAB.
  await expect(page.getByTestId('mobile-tabbar')).toHaveCount(0);
  await expect(page.getByTestId('mobile-fab')).toHaveCount(0);
  await page.getByTestId('back-to-list').click();
  await expect(page.getByTestId('mobile-tabbar')).toBeVisible();
});

test('mobile redesign: long-press multi-select, batch trash and undo', async ({ page }) => {
  await registerThroughUi(page, uniqueEmail('sel1'));
  const first = await createViaApi(page, '批量甲');
  const second = await createViaApi(page, '批量乙');
  await page.reload();
  await expectRowWithTitle(page, '批量甲');

  await longPress(page, `note-item-${first}`);
  await expect(page.getByTestId('selection-toolbar')).toBeVisible();
  await expect(page.getByTestId('selection-count')).toContainText('已选 1 项');
  await expect(page.getByTestId('mobile-tabbar')).toHaveCount(0);

  await page.locator(`[data-testid="note-item-${second}"]`).click();
  await expect(page.getByTestId('selection-count')).toContainText('已选 2 项');

  await page.getByTestId('selection-trash').click();
  await expect(page.getByTestId('undo-toast')).toBeVisible();
  await expect
    .poll(async () => listNoteIds(page, { archived: 'only' }), { timeout: 15_000 })
    .toEqual(expect.arrayContaining([first, second]));
  await expect
    .poll(async () => listNoteIds(page), { timeout: 15_000 })
    .not.toEqual(expect.arrayContaining([first]));

  // Undo restores exactly the same ids.
  await page.getByTestId('undo-toast-action').click();
  await expect
    .poll(async () => listNoteIds(page), { timeout: 15_000 })
    .toEqual(expect.arrayContaining([first, second]));
  await expect(page.getByTestId('selection-toolbar')).toHaveCount(0);
});

test('mobile redesign: swipe actions delete and pin, full swipe offers undo', async ({ page }) => {
  await registerThroughUi(page, uniqueEmail('swp1'));
  const target = await createViaApi(page, '滑动目标');
  await page.reload();
  await expectRowWithTitle(page, '滑动目标');

  // Left swipe reveals the two trailing actions without deleting anything.
  await swipeRow(page, `note-row-${target}`, -110);
  await expect(page.getByTestId(`swipe-trash-${target}`)).toBeVisible();
  await expect(page.getByTestId(`swipe-pin-${target}`)).toBeVisible();
  await expect(await listNoteIds(page, { archived: 'only' })).not.toContain(target);

  // Tapping the revealed row closes it again instead of opening the note.
  await page.locator(`[data-testid="note-item-${target}"]`).click();
  await page.waitForTimeout(400);
  await expect(page.getByTestId(`swipe-trash-${target}`)).toBeHidden();

  // Right swipe is the pin shortcut.
  await swipeRow(page, `note-row-${target}`, 90);
  await expect
    .poll(async () => ((await page.request.get(`/api/notes/${target}`)).json() as Promise<{ pinned: boolean }>).then((body) => body.pinned), {
      timeout: 15_000,
    })
    .toBe(true);

  // A fast full swipe commits the delete and offers undo.
  await swipeRow(page, `note-row-${target}`, -300, { durationMs: 120 });
  await expect(page.getByTestId('undo-toast')).toBeVisible();
  await expect
    .poll(async () => listNoteIds(page, { archived: 'only' }), { timeout: 15_000 })
    .toContain(target);
  await page.getByTestId('undo-toast-action').click();
  await expect
    .poll(async () => listNoteIds(page), { timeout: 15_000 })
    .toContain(target);
});

test('mobile redesign: filter sheet, sort menu and pull-to-refresh', async ({ page }) => {
  await registerThroughUi(page, uniqueEmail('flt1'));
  await createViaApi(page, 'AAA 甲');
  await createViaApi(page, 'ZZZ 乙');
  await page.reload();
  await expectRowWithTitle(page, 'AAA 甲');

  // Sort by title reorders the list.
  await page.getByTestId('mobile-sort').click();
  await page.getByTestId('mobile-sort-title').click();
  // The sort is a server-side refetch; poll the rendered order instead of reading it once.
  await expect
    .poll(
      async () => {
        const titles = await page.locator('[data-testid^="note-item-"]').allInnerTexts();
        const indexOfA = titles.findIndex((text) => text.includes('AAA 甲'));
        const indexOfZ = titles.findIndex((text) => text.includes('ZZZ 乙'));
        return indexOfA >= 0 && indexOfZ >= 0 ? indexOfA - indexOfZ : Number.POSITIVE_INFINITY;
      },
      { timeout: 15_000, message: 'title sort should place AAA 甲 before ZZZ 乙' },
    )
    .toBeLessThan(0);

  // The folder filter narrows the list and closes the sheet.
  await page.getByTestId('mobile-filter-button').click();
  await expect(page.getByTestId('filter-sheet')).toBeVisible();
  await page.getByTestId('new-folder').click();
  await page.getByTestId('prompt-dialog-input').fill('工作');
  await page.getByTestId('prompt-dialog-submit').click();
  // The sheet stays open behind the prompt; pick the new folder straight from it.
  await page.getByTestId('filter-sheet').getByRole('button', { name: /工作/ }).first().click();
  await expect(page.getByTestId('filter-sheet')).toHaveCount(0);
  await expect(page.getByTestId('mobile-titlebar')).toContainText('工作');
  await expect(page.locator('[data-testid^="note-item-"]')).toHaveCount(0);

  // Tapping the active tab pops back to 全部笔记.
  await page.getByTestId('mobile-tab-notes').click();
  await expect(page.getByTestId('mobile-titlebar')).toContainText('全部笔记');

  // Pull-to-refresh picks up a note created by another client.
  const late = await createViaApi(page, '下拉刷新到的笔记');
  await touchDrag(page, '[data-testid="note-list-scroll"]', { dx: 0, dy: 160, durationMs: 350 });
  await expectRowWithTitle(page, '下拉刷新到的笔记');
  expect(late).toBeTruthy();
});

test('mobile redesign: profile tab shows the account and switches the theme', async ({ page }) => {
  const email = uniqueEmail('prof1');
  await registerThroughUi(page, email);

  await page.getByTestId('mobile-tab-me').click();
  await expect(page.getByTestId('mobile-profile')).toContainText(email);
  await expect(page.getByTestId('profile-sync-label')).toBeVisible();

  await page.getByTestId('profile-theme-dark').click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.getByTestId('profile-theme-light').click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);

  await page.getByTestId('open-settings').click();
  await expect(page.getByTestId('settings-dialog')).toBeVisible();
  await page.getByRole('button', { name: '关闭' }).click();
  await expect(page.getByTestId('settings-dialog')).toHaveCount(0);
});
