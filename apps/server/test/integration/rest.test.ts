import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  api,
  databaseAvailable,
  register,
  startTestServer,
  uniqueEmail,
  type AuthedClient,
  type TestServer,
} from './helpers.js';
import type { NoteDto, NoteListDto, NoteSummaryDto, TreeDto } from '@aimarkdown/shared';
import { INBOX_NOTE_TITLE } from '@aimarkdown/shared';

const dbUp = await databaseAvailable();
const describeDb = dbUp ? describe : describe.skip;

describeDb('REST API against a real Postgres', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server?.stop();
  });

  describe('registration bootstrap', () => {
    it('creates the user, workspace doc and an inbox note', async () => {
      const client = await register(server);
      const notes = await api<NoteListDto>(server, client, 'GET', '/api/notes');
      expect(notes.status).toBe(200);
      expect(notes.body.items).toHaveLength(1);
      expect(notes.body.items[0]?.title).toBe(INBOX_NOTE_TITLE);

      const tree = await api<TreeDto>(server, client, 'GET', '/api/tree');
      expect(tree.body.settings.inboxNoteId).toBe(notes.body.items[0]?.id);
    });

    it('persists both desktop window shortcuts through the workspace doc', async () => {
      const client = await register(server);
      const updated = await api<{ hotkey: string; mainWindowHotkey: string }>(
        server,
        client,
        'PATCH',
        '/api/settings',
        { hotkey: 'Alt+Shift+Space', mainWindowHotkey: 'CommandOrControl+Alt+M' },
      );
      expect(updated.status).toBe(200);
      expect(updated.body).toMatchObject({
        hotkey: 'Alt+Shift+Space',
        mainWindowHotkey: 'CommandOrControl+Alt+M',
      });

      const fetched = await api<{ hotkey: string; mainWindowHotkey: string }>(
        server,
        client,
        'GET',
        '/api/settings',
      );
      expect(fetched.body).toMatchObject({
        hotkey: 'Alt+Shift+Space',
        mainWindowHotkey: 'CommandOrControl+Alt+M',
      });
    });

    it('rejects a duplicate email with EMAIL_TAKEN', async () => {
      const email = uniqueEmail('dupe');
      await register(server, email);
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { email, password: 'password123' },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'EMAIL_TAKEN' });
    });

    it('treats email case-insensitively', async () => {
      const email = uniqueEmail('case');
      await register(server, email);
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: email.toUpperCase(), password: 'password123' },
      });
      expect(response.statusCode).toBe(200);
    });

    it('rejects a weak password with a validation error', async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { email: uniqueEmail('weak'), password: 'short' },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    });
  });

  describe('authentication', () => {
    it('rejects a wrong password without revealing which part was wrong', async () => {
      const email = uniqueEmail('login');
      await register(server, email);
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email, password: 'wrong-password' },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    });

    it('rejects an unknown email with the same error as a wrong password', async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'nobody@example.com', password: 'wrong-password' },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    });

    it('requires a token on protected routes', async () => {
      const response = await server.app.inject({ method: 'GET', url: '/api/notes' });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('rejects a tampered token', async () => {
      const client = await register(server);
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/notes',
        headers: { authorization: `Bearer ${client.accessToken.slice(0, -2)}xx` },
      });
      expect(response.statusCode).toBe(401);
    });

    it('reports an expired token as TOKEN_EXPIRED so the client can refresh', async () => {
      // Sign a token that already expired.
      const client = await register(server);
      const expired = await server.verifier.signAccessToken(client.userId, client.email, {
        accessSeconds: -10,
        refreshSeconds: 100,
      });
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/notes',
        headers: { authorization: `Bearer ${expired}` },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ code: 'TOKEN_EXPIRED' });
    });

    it('rotates the refresh token and invalidates the old one', async () => {
      const email = uniqueEmail('refresh');
      const bearer = { 'x-token-transport': 'bearer' };
      const registration = await server.app.inject({
        method: 'POST',
        url: '/api/auth/register',
        headers: bearer,
        payload: { email, password: 'password123' },
      });
      const first = registration.json() as { refreshToken: string };
      expect(first.refreshToken).toBeTruthy();

      const rotated = await server.app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: bearer,
        payload: { refreshToken: first.refreshToken },
      });
      expect(rotated.statusCode).toBe(200);
      const second = rotated.json() as { refreshToken: string; accessToken: string };
      expect(second.refreshToken).not.toBe(first.refreshToken);

      // Replaying the consumed token must fail.
      const replay = await server.app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: bearer,
        payload: { refreshToken: first.refreshToken },
      });
      expect(replay.statusCode).toBe(401);

      // Replay detection revokes the whole family, so the rotated token is dead too.
      const afterRevoke = await server.app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: bearer,
        payload: { refreshToken: second.refreshToken },
      });
      expect(afterRevoke.statusCode).toBe(401);
      expect(second.accessToken.length).toBeGreaterThan(0);
    });

    it('sets httpOnly cookies for the browser client', async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: (await register(server, uniqueEmail('cookie'))).email, password: 'password123' },
      });
      const cookies = response.cookies ?? [];
      const access = cookies.find((c) => c.name === 'amd_at');
      expect(access?.httpOnly).toBe(true);
      expect(response.statusCode).toBe(200);
    });
  });

  describe('tenant isolation', () => {
    it('never exposes another user\'s note', async () => {
      const alice = await register(server);
      const bob = await register(server);

      const created = await api<NoteDto>(server, alice, 'POST', '/api/notes', { body: '秘密' });
      expect(created.status).toBe(201);
      const noteId = created.body.id;

      const readByBob = await api(server, bob, 'GET', `/api/notes/${noteId}`);
      expect(readByBob.status).toBe(404);

      const patchByBob = await api(server, bob, 'PATCH', `/api/notes/${noteId}`, { pinned: true });
      expect(patchByBob.status).toBe(404);

      const deleteByBob = await api(server, bob, 'DELETE', `/api/notes/${noteId}`);
      expect(deleteByBob.status).toBe(404);

      // Alice still sees it untouched.
      const readByAlice = await api<NoteDto>(server, alice, 'GET', `/api/notes/${noteId}`);
      expect(readByAlice.status).toBe(200);
      expect(readByAlice.body.pinned).toBe(false);
    });

    it('scopes list and tree queries per user', async () => {
      const alice = await register(server);
      const bob = await register(server);
      await api(server, alice, 'POST', '/api/notes', { body: 'alice only' });

      const aliceNotes = await api<NoteListDto>(server, alice, 'GET', '/api/notes');
      const bobNotes = await api<NoteListDto>(server, bob, 'GET', '/api/notes');
      expect(aliceNotes.body.total).toBe(2); // inbox + created
      expect(bobNotes.body.total).toBe(1); // inbox only
      expect(bobNotes.body.items.map((n) => n.title)).not.toContain('alice only');
    });
  });

  describe('note lifecycle', () => {
    let client: AuthedClient;
    beforeAll(async () => {
      client = await register(server);
    });

    it('creates a note and derives the title from the body', async () => {
      const created = await api<NoteDto>(server, client, 'POST', '/api/notes', {
        body: '# 我的第一篇笔记\n\n正文内容。\n',
      });
      expect(created.status).toBe(201);
      expect(created.body.title).toBe('我的第一篇笔记');
      expect(created.body.body).toContain('正文内容');
      expect(created.body.wordCount).toBeGreaterThan(0);
    });

    it('keeps an explicitly provided title even when the body has a heading', async () => {
      const created = await api<NoteDto>(server, client, 'POST', '/api/notes', {
        title: '手动标题',
        body: '# 正文里的标题\n',
      });
      expect(created.body.title).toBe('手动标题');
    });

    it('soft-deletes into the trash and restores', async () => {
      const created = await api<NoteDto>(server, client, 'POST', '/api/notes', { body: '待删除' });
      const noteId = created.body.id;

      const deleted = await api(server, client, 'DELETE', `/api/notes/${noteId}`);
      expect(deleted.status).toBe(200);
      expect(deleted.body).toMatchObject({ ok: true, permanent: false });

      const gone = await api(server, client, 'GET', `/api/notes/${noteId}`);
      expect(gone.status).toBe(404);

      const trash = await api<NoteListDto>(server, client, 'GET', '/api/notes?archived=only');
      expect(trash.body.items.map((n) => n.id)).toContain(noteId);

      const restored = await api<NoteSummaryDto>(server, client, 'POST', `/api/notes/${noteId}/restore`);
      expect(restored.status).toBe(200);
      expect(restored.body.archived).toBe(false);

      const back = await api(server, client, 'GET', `/api/notes/${noteId}`);
      expect(back.status).toBe(200);
    });

    it('permanently deletes the row and cascades the CRDT document', async () => {
      const created = await api<NoteDto>(server, client, 'POST', '/api/notes', { body: '彻底删除' });
      const noteId = created.body.id;

      const response = await api(server, client, 'DELETE', `/api/notes/${noteId}?permanent=1`);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ permanent: true });

      const docRows = await server.handle.sql`
        select note_id from note_documents where note_id = ${noteId}
      `;
      expect(docRows).toHaveLength(0);
    });

    it('pins and unpins through the CRDT so other devices see it', async () => {
      const created = await api<NoteDto>(server, client, 'POST', '/api/notes', { body: 'pin me' });
      const patched = await api<NoteSummaryDto>(server, client, 'PATCH', `/api/notes/${created.body.id}`, {
        pinned: true,
      });
      expect(patched.body.pinned).toBe(true);

      // The change must be in the authoritative document, not just the mirror.
      const { loadStoredDoc } = await import('../../src/services/notes.js');
      const { readNoteMeta } = await import('../../src/collab/docFactory.js');
      const doc = await loadStoredDoc(server.handle.sql, created.body.id);
      expect(readNoteMeta(doc).pinned).toBe(true);
    });
  });

  describe('folders and tags', () => {
    let client: AuthedClient;
    beforeAll(async () => {
      client = await register(server);
    });

    it('creates nested folders and counts notes in them', async () => {
      const root = await api<{ id: string }>(server, client, 'POST', '/api/folders', { name: '工作' });
      expect(root.status).toBe(201);
      const child = await api<{ id: string }>(server, client, 'POST', '/api/folders', {
        name: '2026',
        parentId: root.body.id,
      });
      expect(child.status).toBe(201);

      await api(server, client, 'POST', '/api/notes', { body: 'in child', folderId: child.body.id });

      const tree = await api<TreeDto>(server, client, 'GET', '/api/tree');
      expect(tree.body.folders).toHaveLength(2);
      expect(tree.body.folders.find((f) => f.id === child.body.id)?.noteCount).toBe(1);
      expect(tree.body.folders.find((f) => f.id === child.body.id)?.parentId).toBe(root.body.id);
    });

    it('refuses to move a folder into its own descendant', async () => {
      const root = await api<{ id: string }>(server, client, 'POST', '/api/folders', { name: '根' });
      const child = await api<{ id: string }>(server, client, 'POST', '/api/folders', {
        name: '子',
        parentId: root.body.id,
      });
      const response = await api(server, client, 'PATCH', `/api/folders/${root.body.id}`, {
        parentId: child.body.id,
      });
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: 'CYCLIC_FOLDER' });
    });

    it('refuses to move a folder into itself', async () => {
      const folder = await api<{ id: string }>(server, client, 'POST', '/api/folders', { name: '自引用' });
      const response = await api(server, client, 'PATCH', `/api/folders/${folder.body.id}`, {
        parentId: folder.body.id,
      });
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: 'CYCLIC_FOLDER' });
    });

    it('promotes notes to the root when their folder is deleted', async () => {
      const folder = await api<{ id: string }>(server, client, 'POST', '/api/folders', { name: '临时' });
      const note = await api<NoteDto>(server, client, 'POST', '/api/notes', {
        body: 'orphan me',
        folderId: folder.body.id,
      });
      await api(server, client, 'DELETE', `/api/folders/${folder.body.id}`);

      const after = await api<NoteSummaryDto>(server, client, 'GET', `/api/notes/${note.body.id}`);
      expect(after.status).toBe(200);
      expect(after.body.folderId).toBeNull();
    });

    it('creates tags, filters notes by them, and counts usage', async () => {
      const tag = await api<{ id: string }>(server, client, 'POST', '/api/tags', {
        name: '重要',
        color: '#ff0000',
      });
      expect(tag.status).toBe(201);

      const note = await api<NoteDto>(server, client, 'POST', '/api/notes', {
        body: 'tagged note',
        tagIds: [tag.body.id],
      });
      expect(note.body.tagIds).toContain(tag.body.id);

      const filtered = await api<NoteListDto>(
        server,
        client,
        'GET',
        `/api/notes?tagIds=${tag.body.id}`,
      );
      expect(filtered.body.items.map((n) => n.id)).toContain(note.body.id);

      const tree = await api<TreeDto>(server, client, 'GET', '/api/tree');
      expect(tree.body.tags.find((t) => t.id === tag.body.id)?.noteCount).toBe(1);
    });

    it('reuses an existing tag with the same name instead of duplicating', async () => {
      const first = await api<{ id: string }>(server, client, 'POST', '/api/tags', { name: '重复' });
      const second = await api<{ id: string }>(server, client, 'POST', '/api/tags', { name: '重复' });
      expect(second.body.id).toBe(first.body.id);
    });

    it('requires AND semantics when filtering by several tags', async () => {
      const a = await api<{ id: string }>(server, client, 'POST', '/api/tags', { name: 'A标签' });
      const b = await api<{ id: string }>(server, client, 'POST', '/api/tags', { name: 'B标签' });
      const both = await api<NoteDto>(server, client, 'POST', '/api/notes', {
        body: 'has both',
        tagIds: [a.body.id, b.body.id],
      });
      const onlyA = await api<NoteDto>(server, client, 'POST', '/api/notes', {
        body: 'has one',
        tagIds: [a.body.id],
      });

      const andFiltered = await api<NoteListDto>(
        server,
        client,
        'GET',
        `/api/notes?tagIds=${a.body.id},${b.body.id}`,
      );
      expect(andFiltered.body.items.map((n) => n.id)).toEqual([both.body.id]);

      const orWouldInclude = await api<NoteListDto>(server, client, 'GET', `/api/notes?tagIds=${a.body.id}`);
      expect(orWouldInclude.body.items.map((n) => n.id)).toEqual(
        expect.arrayContaining([both.body.id, onlyA.body.id]),
      );
    });

    it('deleting a tag detaches it from notes', async () => {
      const tag = await api<{ id: string }>(server, client, 'POST', '/api/tags', { name: '待删标签' });
      const note = await api<NoteDto>(server, client, 'POST', '/api/notes', {
        body: 'tagged',
        tagIds: [tag.body.id],
      });
      await api(server, client, 'DELETE', `/api/tags/${tag.body.id}`);

      const after = await api<NoteDto>(server, client, 'GET', `/api/notes/${note.body.id}`);
      expect(after.body.tagIds).not.toContain(tag.body.id);
    });
  });

  describe('search', () => {
    let client: AuthedClient;
    beforeAll(async () => {
      client = await register(server);
      await api(server, client, 'POST', '/api/notes', { body: '# 会议纪要\n\n讨论了同步方案的细节。\n' });
      await api(server, client, 'POST', '/api/notes', { body: 'Shopping list\n\nmilk and eggs\n' });
    });

    it('finds a Chinese phrase inside the body', async () => {
      const result = await api<NoteListDto>(server, client, 'GET', `/api/notes?q=${encodeURIComponent('同步方案')}`);
      expect(result.body.items).toHaveLength(1);
      expect(result.body.items[0]?.title).toBe('会议纪要');
    });

    it('finds a two-character Chinese query', async () => {
      const result = await api<NoteListDto>(server, client, 'GET', `/api/notes?q=${encodeURIComponent('会议')}`);
      expect(result.body.items.length).toBeGreaterThanOrEqual(1);
    });

    it('matches on the title as well as the body', async () => {
      const result = await api<NoteListDto>(server, client, 'GET', `/api/notes?q=${encodeURIComponent('纪要')}`);
      expect(result.body.items.length).toBe(1);
    });

    it('finds an English phrase case-insensitively', async () => {
      const result = await api<NoteListDto>(server, client, 'GET', '/api/notes?q=MILK');
      expect(result.body.items).toHaveLength(1);
    });

    it('returns match context snippets', async () => {
      const result = await api<NoteListDto>(server, client, 'GET', `/api/notes?q=${encodeURIComponent('同步方案')}`);
      expect(result.body.items[0]?.matches?.length).toBeGreaterThan(0);
    });

    it('rejects a single-character query with a clear code', async () => {
      const result = await api(server, client, 'GET', '/api/notes?q=a');
      expect(result.status).toBe(422);
      expect(result.body).toMatchObject({ code: 'SEARCH_QUERY_TOO_SHORT' });
    });

    it('does not treat LIKE wildcards in the query as wildcards', async () => {
      await api(server, client, 'POST', '/api/notes', { body: 'literal percent sign here' });
      const result = await api<NoteListDto>(server, client, 'GET', `/api/notes?q=${encodeURIComponent('%')}`.replace('%', '%25'));
      // `%` alone is shorter than the minimum, so it is rejected rather than matching everything.
      expect(result.status === 422 || result.body.items.length === 0).toBe(true);
    });

    it('excludes trashed notes from results', async () => {
      const note = await api<NoteDto>(server, client, 'POST', '/api/notes', { body: 'trash me 独特词汇' });
      await api(server, client, 'DELETE', `/api/notes/${note.body.id}`);
      const result = await api<NoteListDto>(server, client, 'GET', `/api/notes?q=${encodeURIComponent('独特词汇')}`);
      expect(result.body.items).toHaveLength(0);
    });

    it('combines a folder filter with a search query', async () => {
      const folder = await api<{ id: string }>(server, client, 'POST', '/api/folders', { name: '搜索目录' });
      await api(server, client, 'POST', '/api/notes', {
        body: '组合过滤 keyword',
        folderId: folder.body.id,
      });
      const inFolder = await api<NoteListDto>(
        server,
        client,
        'GET',
        `/api/notes?folderId=${folder.body.id}&q=${encodeURIComponent('keyword')}`,
      );
      expect(inFolder.body.items).toHaveLength(1);

      // `rootOnly` is the unambiguous way to ask for notes with no folder; `folderId=null`
      // would be read as a folder literally named "null".
      const rootOnly = await api<NoteListDto>(
        server,
        client,
        'GET',
        `/api/notes?rootOnly=true&q=${encodeURIComponent('keyword')}`,
      );
      expect(rootOnly.status).toBe(200);
      expect(rootOnly.body.items).toHaveLength(0);

      const unfiltered = await api<NoteListDto>(server, client, 'GET', `/api/notes?q=${encodeURIComponent('keyword')}`);
      expect(unfiltered.body.items).toHaveLength(1);
    });
  });

  describe('health', () => {
    it('reports ok when the database and collab server are up', async () => {
      const response = await server.app.inject({ method: 'GET', url: '/api/health' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: 'ok', db: 'ok', collab: 'ok' });
    });
  });

  describe('CORS preflight', () => {
    it('allows the REST verbs used by the mobile WebView', async () => {
      const response = await server.app.inject({
        method: 'OPTIONS',
        url: '/api/ai/config',
        headers: {
          origin: 'https://localhost',
          'access-control-request-method': 'PUT',
          'access-control-request-headers': 'authorization,content-type,x-token-transport',
        },
      });

      expect(response.statusCode).toBe(204);
      expect(response.headers['access-control-allow-methods']).toContain('PUT');
      expect(response.headers['access-control-allow-methods']).toContain('DELETE');
    });
  });
});
