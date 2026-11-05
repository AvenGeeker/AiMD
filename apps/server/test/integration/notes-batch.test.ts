import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { noteDocName, type FolderDto, type NoteBatchDto, type NoteDto, type NoteListDto, type TagDto } from '@aimarkdown/shared';
import {
  api,
  databaseAvailable,
  register,
  startTestServer,
  type AuthedClient,
  type TestServer,
} from './helpers.js';

/**
 * `POST /api/notes/batch` acceptance.
 *
 * The batch endpoint is the only write path for multi-select operations, so these tests pin down
 * the contract the phone and desktop shells rely on: per-item outcomes, CRDT propagation (a live
 * client must see the change as an ordinary Yjs update), owner scoping, and the visibility rules
 * that keep trash operations from silently no-oping on live notes.
 */

const dbUp = await databaseAvailable();
const describeDb = dbUp ? describe : describe.skip;

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  { timeout = 8000, interval = 50, label = 'condition' } = {},
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`timed out after ${timeout}ms waiting for ${label}`);
}

async function createNote(server: TestServer, client: AuthedClient, title: string): Promise<NoteDto> {
  const response = await api<NoteDto>(server, client, 'POST', '/api/notes', {
    title,
    body: `${title} 的正文`,
  });
  expect(response.status).toBe(201);
  return response.body;
}

async function liveIds(server: TestServer, client: AuthedClient): Promise<string[]> {
  const response = await api<NoteListDto>(server, client, 'GET', '/api/notes?limit=200');
  return response.body.items.map((item) => item.id);
}

async function trashIds(server: TestServer, client: AuthedClient): Promise<string[]> {
  const response = await api<NoteListDto>(server, client, 'GET', '/api/notes?archived=only&limit=200');
  return response.body.items.map((item) => item.id);
}

describeDb('note batch operations', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer();
  });
  afterAll(async () => {
    await server.stop();
  });

  it('trashes a batch, reports per-item notes, and restores it', async () => {
    const alice = await register(server);
    const notes = await Promise.all([
      createNote(server, alice, '批量一'),
      createNote(server, alice, '批量二'),
      createNote(server, alice, '批量三'),
    ]);
    const ids = notes.map((note) => note.id);

    const trashed = await api<NoteBatchDto>(server, alice, 'POST', '/api/notes/batch', {
      ids,
      op: 'trash',
    });
    expect(trashed.status).toBe(200);
    expect(trashed.body.succeeded).toBe(3);
    expect(trashed.body.failed).toBe(0);
    expect(trashed.body.items.every((item) => item.ok)).toBe(true);
    expect(trashed.body.items[0]?.note?.archived).toBe(true);

    expect(await liveIds(server, alice)).not.toContain(ids[0]);
    expect(await trashIds(server, alice)).toEqual(expect.arrayContaining(ids));

    const restored = await api<NoteBatchDto>(server, alice, 'POST', '/api/notes/batch', {
      ids,
      op: 'restore',
    });
    expect(restored.body.succeeded).toBe(3);
    expect(await liveIds(server, alice)).toEqual(expect.arrayContaining(ids));
    expect(await trashIds(server, alice)).not.toContain(ids[0]);
  });

  it('pins and unpins through the CRDT so a live client sees the update', async () => {
    const alice = await register(server);
    const note = await createNote(server, alice, '广播置顶');

    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `ws://127.0.0.1:${server.collabPort()}`,
      name: noteDocName(note.id),
      document: doc,
      token: alice.accessToken,
    });
    await waitFor(() => provider.isSynced, { label: 'client sync' });

    const pinned = await api<NoteBatchDto>(server, alice, 'POST', '/api/notes/batch', {
      ids: [note.id],
      op: 'pin',
    });
    expect(pinned.body.succeeded).toBe(1);

    // The change must arrive as an ordinary Yjs update, not a projection-only write.
    await waitFor(() => doc.getMap('meta').get('pinned') === true, {
      label: 'the pinned flag to reach the connected client',
    });

    const unpinned = await api<NoteBatchDto>(server, alice, 'POST', '/api/notes/batch', {
      ids: [note.id],
      op: 'unpin',
    });
    expect(unpinned.body.succeeded).toBe(1);
    await waitFor(() => doc.getMap('meta').get('pinned') === false, {
      label: 'the unpinned flag to reach the connected client',
    });

    provider.disconnect();
    doc.destroy();
  });

  it('moves notes into a folder and back to the root', async () => {
    const alice = await register(server);
    const folder = await api<FolderDto>(server, alice, 'POST', '/api/folders', { name: '批量目录' });
    expect(folder.status).toBe(201);
    const note = await createNote(server, alice, '待移动');

    const moved = await api<NoteBatchDto>(server, alice, 'POST', '/api/notes/batch', {
      ids: [note.id],
      op: 'move',
      folderId: folder.body.id,
    });
    expect(moved.body.items[0]?.note?.folderId).toBe(folder.body.id);

    const inFolder = await api<NoteListDto>(
      server,
      alice,
      'GET',
      `/api/notes?folderId=${folder.body.id}`,
    );
    expect(inFolder.body.items.map((item) => item.id)).toContain(note.id);

    const rooted = await api<NoteBatchDto>(server, alice, 'POST', '/api/notes/batch', {
      ids: [note.id],
      op: 'move',
      folderId: null,
    });
    expect(rooted.body.items[0]?.note?.folderId).toBeNull();
  });

  it('adds tags as a union and removes them as a difference', async () => {
    const alice = await register(server);
    const tagA = await api<TagDto>(server, alice, 'POST', '/api/tags', { name: '甲' });
    const tagB = await api<TagDto>(server, alice, 'POST', '/api/tags', { name: '乙' });
    const note = await api<NoteDto>(server, alice, 'POST', '/api/notes', {
      title: '带标签',
      body: '正文',
      tagIds: [tagA.body.id],
    });
    expect(note.status).toBe(201);

    const added = await api<NoteBatchDto>(server, alice, 'POST', '/api/notes/batch', {
      ids: [note.body.id],
      op: 'addTags',
      tagIds: [tagB.body.id],
    });
    expect(added.body.items[0]?.note?.tagIds).toEqual(
      expect.arrayContaining([tagA.body.id, tagB.body.id]),
    );

    const removed = await api<NoteBatchDto>(server, alice, 'POST', '/api/notes/batch', {
      ids: [note.body.id],
      op: 'removeTags',
      tagIds: [tagA.body.id],
    });
    expect(removed.body.items[0]?.note?.tagIds).toEqual([tagB.body.id]);
  });

  it('destroys notes and cascades the stored CRDT document', async () => {
    const alice = await register(server);
    const note = await createNote(server, alice, '彻底删除');
    // Force the document into note_documents so the cascade has something to remove.
    await api(server, alice, 'PATCH', `/api/notes/${note.id}`, { body: '落库正文' });

    const destroyed = await api<NoteBatchDto>(server, alice, 'POST', '/api/notes/batch', {
      ids: [note.id],
      op: 'destroy',
    });
    expect(destroyed.body.succeeded).toBe(1);
    expect(destroyed.body.items).toEqual([]);

    const rows = await server.handle.sql`select id from notes where id = ${note.id}`;
    expect(rows).toHaveLength(0);
    const docs = await server.handle.sql`select note_id from note_documents where note_id = ${note.id}`;
    expect(docs).toHaveLength(0);
  });

  it('clears the whole trash through scope, beyond one page of results', async () => {
    const alice = await register(server);
    const created: string[] = [];
    for (let index = 0; index < 60; index += 1) {
      const note = await createNote(server, alice, `回收 ${index}`);
      created.push(note.id);
    }
    // Trash in two batches of 30 (the explicit-id cap is 200, but keep the payload small).
    await api<NoteBatchDto>(server, alice, 'POST', '/api/notes/batch', {
      ids: created.slice(0, 30),
      op: 'trash',
    });
    await api<NoteBatchDto>(server, alice, 'POST', '/api/notes/batch', {
      ids: created.slice(30),
      op: 'trash',
    });
    const before = await api<NoteListDto>(server, alice, 'GET', '/api/notes?archived=only');
    expect(before.body.total).toBe(60);

    const emptied = await api<NoteBatchDto>(server, alice, 'POST', '/api/notes/batch', {
      scope: 'trashed',
      op: 'destroy',
    });
    expect(emptied.body.succeeded).toBe(60);
    const after = await api<NoteListDto>(server, alice, 'GET', '/api/notes?archived=only');
    expect(after.body.total).toBe(0);
  });

  it('never touches another tenant\'s notes', async () => {
    const alice = await register(server);
    const bob = await register(server);
    const secret = await createNote(server, alice, '跨租户秘密');
    await api(server, alice, 'POST', '/api/notes/batch', { ids: [secret.id], op: 'trash' });

    const stolen = await api<NoteBatchDto>(server, bob, 'POST', '/api/notes/batch', {
      ids: [secret.id],
      op: 'restore',
    });
    expect(stolen.status).toBe(200);
    expect(stolen.body.succeeded).toBe(0);
    expect(stolen.body.failed).toBe(1);
    expect(stolen.body.items[0]).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });

    // Bob's own trash scope must not see Alice's trashed note either.
    const bobScope = await api<NoteBatchDto>(server, bob, 'POST', '/api/notes/batch', {
      scope: 'trashed',
      op: 'destroy',
    });
    expect(bobScope.body.succeeded).toBe(0);
    const aliceTrash = await trashIds(server, alice);
    expect(aliceTrash).toContain(secret.id);
  });

  it('guards visibility: restore only applies to trashed notes and vice versa', async () => {
    const alice = await register(server);
    const live = await createNote(server, alice, '活笔记');
    const trashed = await createNote(server, alice, '回收笔记');
    await api(server, alice, 'POST', '/api/notes/batch', { ids: [trashed.id], op: 'trash' });

    const mixed = await api<NoteBatchDto>(server, alice, 'POST', '/api/notes/batch', {
      ids: [live.id, trashed.id],
      op: 'restore',
    });
    expect(mixed.body.succeeded).toBe(1);
    expect(mixed.body.failed).toBe(1);
    const failed = mixed.body.items.find((item) => !item.ok);
    expect(failed?.error?.code).toBe('CONFLICT');
    expect(failed?.id).toBe(live.id);

    // The restore above put it back, so trashing it once more succeeds and only the second
    // attempt on an already-trashed note is refused.
    const retrash = await api<NoteBatchDto>(server, alice, 'POST', '/api/notes/batch', {
      ids: [trashed.id],
      op: 'trash',
    });
    expect(retrash.body.succeeded).toBe(1);
    const again = await api<NoteBatchDto>(server, alice, 'POST', '/api/notes/batch', {
      ids: [trashed.id],
      op: 'trash',
    });
    expect(again.body.items[0]?.error?.code).toBe('CONFLICT');
  });

  it('validates the payload and requires authentication', async () => {
    const alice = await register(server);
    const tooMany = Array.from({ length: 201 }, (_, index) => `n${index}`);
    expect(
      (await api(server, alice, 'POST', '/api/notes/batch', { ids: tooMany, op: 'pin' })).status,
    ).toBe(422);
    expect(
      (await api(server, alice, 'POST', '/api/notes/batch', { ids: ['a1'], op: 'move' })).status,
    ).toBe(422);
    expect(
      (await api(server, alice, 'POST', '/api/notes/batch', { ids: ['a1'], op: 'addTags', tagIds: [] }))
        .status,
    ).toBe(422);
    expect(
      (await api(server, alice, 'POST', '/api/notes/batch', { op: 'destroy' })).status,
    ).toBe(422);
    expect(
      (await api(server, alice, 'POST', '/api/notes/batch', { ids: ['a1'], scope: 'trashed', op: 'destroy' }))
        .status,
    ).toBe(422);

    const anonymous = await server.app.inject({
      method: 'POST',
      url: '/api/notes/batch',
      payload: { ids: ['a1'], op: 'trash' },
    });
    expect(anonymous.statusCode).toBe(401);
  });
});
