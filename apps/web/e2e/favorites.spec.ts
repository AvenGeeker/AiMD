import { createServer, type Server } from 'node:http';
import { devices, expect, test, type DeviceDescriptor } from '@playwright/test';
import { registerThroughUi } from './helpers.js';

let fixture: Server;
let port = 0;

test.beforeAll(async () => {
  fixture = createServer((request, response) => {
    if (request.url === '/cover.png') {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=', 'base64'));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html><head><meta property="og:title" content="周末旅行收藏" /></head><body><article><h1>周末旅行收藏</h1><p>这是一篇足够长的测试旅行文章，包含路线、预算、住宿和出行注意事项，用来验证收藏预览与保存。</p></article></body></html>`);
  });
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  const address = fixture.address();
  if (!address || typeof address === 'string') throw new Error('fixture did not bind');
  port = address.port;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => fixture.close((error) => (error ? reject(error) : resolve())));
});

test('saves a link into the favourites section', async ({ page }) => {
  await registerThroughUi(page);
  await page.getByTestId('favorites-nav').getByRole('button', { name: '收藏链接' }).click();
  await page.getByTestId('favorite-url').fill(`http://127.0.0.1:${port}/post`);
  await page.getByTestId('favorite-url').press('Enter');
  await expect(page.getByTestId('favorite-list')).toContainText('周末旅行收藏');
  await expect(page.getByTestId('favorite-note-bar')).toContainText('网页');
});

const iphone13 = { ...devices['iPhone 13'] } as DeviceDescriptor;
delete (iphone13 as { defaultBrowserType?: string }).defaultBrowserType;

test.describe('mobile favourites', () => {
  test.use(iphone13);

  test('adds a favourite from the note-list header without opening the drawer', async ({ page }) => {
    await registerThroughUi(page);

    // The mobile home screen keeps favourite capture one tap away instead of hiding it in the drawer.
    const add = page.getByTestId('note-list-favorite-add');
    await expect(add).toBeVisible();
    await expect(add).toContainText('收藏');
    await add.tap();
    await expect(page.getByRole('dialog', { name: '收藏链接' })).toBeVisible();
    await expect(page.getByTestId('favorite-url')).toBeInViewport();

    await page.getByTestId('favorite-url').fill(`http://127.0.0.1:${port}/post`);
    await page.getByTestId('favorite-url').press('Enter');
    await expect(page.getByTestId('favorite-list')).toContainText('周末旅行收藏');
  });

  test('opens the capture dialog through the native widget bridge', async ({ page }) => {
    await registerThroughUi(page);

    await page.evaluate(() => {
      (window as Window & { __aimdOpenFavorite?: () => void }).__aimdOpenFavorite?.();
    });

    await expect(page.getByRole('dialog', { name: '收藏链接' })).toBeVisible();
    await expect(page.getByTestId('favorite-url')).toBeInViewport();
  });
});
