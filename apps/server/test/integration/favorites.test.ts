import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FAVORITE_CATEGORY_PRESETS, type FavoritePreviewDto, type FavoriteSaveResultDto, type NoteDto, type TreeDto } from '@aimarkdown/shared';
import {
  api,
  databaseAvailable,
  register,
  startTestServer,
  type AuthedClient,
  type TestServer,
} from './helpers.js';

const dbUp = await databaseAvailable();
const describeDb = dbUp ? describe : describe.skip;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=',
  'base64',
);

describeDb('link favourites', () => {
  let server: TestServer;
  let fixture: Server;
  let fixturePort = 0;
  let alice: AuthedClient;
  let bob: AuthedClient;

  beforeAll(async () => {
    fixture = createServer((request, response) => {
      if (request.url === '/image.png') {
        response.writeHead(200, { 'content-type': 'image/png' });
        response.end(PNG);
        return;
      }
      if (request.url === '/blocked') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<html><head><title>需要登录</title></head><body>请登录后查看</body></html>');
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><html><head>
        <meta property="og:title" content="云南旅行攻略" />
        <meta property="og:image" content="http://127.0.0.1:${fixturePort}/image.png" />
      </head><body><article>
        <h1>云南旅行攻略</h1>
        <p>这是一篇适合收藏的旅行文章，包含大理、丽江和香格里拉的路线、预算和注意事项。</p>
        <img src="http://127.0.0.1:${fixturePort}/image.png" />
      </article></body></html>`);
    });
    await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve));
    const address = fixture.address();
    if (!address || typeof address === 'string') throw new Error('fixture did not bind');
    fixturePort = address.port;

    server = await startTestServer({ LINK_FETCH_ALLOW_PRIVATE: 'true' });
    alice = await register(server, 'fav-alice@example.com');
    bob = await register(server, 'fav-bob@example.com');
  });

  afterAll(async () => {
    await server?.stop();
    await new Promise<void>((resolve, reject) => fixture.close((error) => (error ? reject(error) : resolve())));
  });

  it('previews, saves, localizes an image and deduplicates by source URL', async () => {
    const url = `http://127.0.0.1:${fixturePort}/post`;
    const preview = await api<FavoritePreviewDto>(server, alice, 'POST', '/api/favorites/preview', { url });
    expect(preview.status).toBe(200);
    expect(preview.body.title).toContain('云南');
    expect(preview.body.imageCount).toBe(1);

    const saved = await api<FavoriteSaveResultDto>(server, alice, 'POST', '/api/favorites', {
      url,
      platform: 'web',
      title: preview.body.title,
      author: preview.body.author,
      body: preview.body.body,
      coverUrl: preview.body.coverUrl,
      captureStatus: 'fetched',
    });
    expect(saved.status).toBe(201);
    expect(saved.body.created).toBe(true);
    expect(saved.body.note.source?.url).toBe(url);
    expect(saved.body.note.body).toContain('/api/attachments/');

    const tree = await api<TreeDto>(server, alice, 'GET', '/api/tree');
    expect(saved.body.note.folderId).toBe(tree.body.settings.favoritesInboxFolderId);
    const categoryNames = tree.body.folders
      .filter((folder) => folder.parentId === tree.body.settings.favoritesFolderId)
      .map((folder) => folder.name);
    expect(categoryNames).toEqual(expect.arrayContaining([...FAVORITE_CATEGORY_PRESETS]));

    const again = await api<FavoriteSaveResultDto>(server, alice, 'POST', '/api/favorites', {
      url,
      platform: 'web',
      title: '更新后的标题',
      body: '更新后的正文内容，仍然包含足够的文字用于收藏。',
      captureStatus: 'fetched',
    });
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);
    expect(again.body.note.id).toBe(saved.body.note.id);
    expect(again.body.note.title).toBe('更新后的标题');
  });

  it('still saves the URL when the page cannot be parsed', async () => {
    const url = `http://127.0.0.1:${fixturePort}/blocked`;
    const saved = await api<FavoriteSaveResultDto>(server, alice, 'POST', '/api/favorites', {
      url,
      title: '',
      body: '',
      captureStatus: 'fetched',
      forceNew: true,
      downloadImages: true,
    });
    expect(saved.status).toBe(201);
    expect(saved.body.note.source?.url).toBe(url);
    expect(saved.body.note.source?.captureStatus).toBe('partial');
    expect(saved.body.note.body).toContain(url);
  });

  it('scopes favourites to the owner and supports manual category assignment', async () => {
    const tree = await api<TreeDto>(server, alice, 'GET', '/api/tree');
    const rootId = tree.body.settings.favoritesFolderId!;
    const folder = await api<{ id: string }>(server, alice, 'POST', '/api/folders', {
      name: '旅游',
      parentId: rootId,
    });
    const notes = await api<{ items: NoteDto[] }>(server, alice, 'GET', '/api/notes?recursive=true', undefined);
    expect(notes.status).toBe(200);
    const note = notes.body.items.find((item) => item.source);
    expect(note).toBeTruthy();
    const set = await api(server, alice, 'POST', `/api/favorites/${note!.id}/category`, {
      action: 'set',
      folderId: folder.body.id,
      name: '旅游',
    });
    expect(set.status).toBe(200);

    const foreign = await api(server, bob, 'GET', `/api/notes/${note!.id}`);
    expect(foreign.status).toBe(404);
    const badCategory = await api(server, bob, 'POST', `/api/favorites/${note!.id}/category`, {
      action: 'set',
      folderId: folder.body.id,
      name: '旅游',
    });
    expect(badCategory.status).toBe(404);
  });
});
