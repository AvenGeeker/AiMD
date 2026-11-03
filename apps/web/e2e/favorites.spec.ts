import { createServer, type Server } from 'node:http';
import { expect, test } from '@playwright/test';
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
