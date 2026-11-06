import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { noteDocName } from '@aimarkdown/shared';
import type { AttachmentDto, NoteDto, NoteShareDto, PublicNoteShareDto } from '@aimarkdown/shared';
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

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

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

function tokenOf(share: NoteShareDto): string {
  expect(share.url).toBeTruthy();
  return new URL(share.url as string).pathname.split('/').pop() ?? '';
}

async function createNote(server: TestServer, client: AuthedClient, title: string, body: string): Promise<NoteDto> {
  const response = await api<NoteDto>(server, client, 'POST', '/api/notes', { title, body });
  expect(response.status).toBe(201);
  return response.body;
}

function multipart(boundary: string, field: { filename: string; contentType: string; data: Buffer }): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${field.filename}"\r\n` +
        `Content-Type: ${field.contentType}\r\n\r\n`,
      'utf8',
    ),
    field.data,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
  ]);
}

async function upload(
  server: TestServer,
  client: AuthedClient,
  noteId: string,
  filename = 'pixel.png',
): Promise<AttachmentDto> {
  const boundary = '----amdshareattachmentboundary';
  const response = await server.app.inject({
    method: 'POST',
    url: `/api/attachments?noteId=${encodeURIComponent(noteId)}`,
    headers: { ...client.header, 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: multipart(boundary, { filename, contentType: 'image/png', data: PNG_BYTES }),
  });
  expect(response.statusCode).toBe(201);
  return response.json() as AttachmentDto;
}

describeDb('public note sharing', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer({ PUBLIC_URL: 'https://notes.example.com' });
  });

  afterAll(async () => {
    await server?.stop();
  });

  it('enables, reuses and revokes a public link', async () => {
    const alice = await register(server);
    const note = await createNote(server, alice, '公开笔记', '# 公开内容\n\n正文。');

    const initial = await api<NoteShareDto>(server, alice, 'GET', `/api/notes/${note.id}/share`);
    expect(initial.status).toBe(200);
    expect(initial.body).toEqual({ noteId: note.id, enabled: false, url: null, createdAt: null });

    const enabled = await api<NoteShareDto>(server, alice, 'POST', `/api/notes/${note.id}/share`);
    expect(enabled.status).toBe(200);
    expect(enabled.body.enabled).toBe(true);
    expect(enabled.body.url).toMatch(/^https:\/\/notes\.example\.com\/s\/[A-Za-z0-9_-]{32,64}$/);

    const again = await api<NoteShareDto>(server, alice, 'POST', `/api/notes/${note.id}/share`);
    expect(again.body.url).toBe(enabled.body.url);

    const token = tokenOf(enabled.body);
    const anonymous = await server.app.inject({ method: 'GET', url: `/api/shares/${token}` });
    expect(anonymous.statusCode).toBe(200);
    expect(anonymous.headers['cache-control']).toBe('no-store');
    expect(anonymous.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(anonymous.json()).toMatchObject({ title: '公开笔记', body: '# 公开内容\n\n正文。' });

    const disabled = await api<NoteShareDto>(server, alice, 'DELETE', `/api/notes/${note.id}/share`);
    expect(disabled.body).toEqual({ noteId: note.id, enabled: false, url: null, createdAt: null });
    const revoked = await server.app.inject({ method: 'GET', url: `/api/shares/${token}` });
    expect(revoked.statusCode).toBe(404);
    expect(revoked.json()).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('creates a brand-new token after sharing is re-enabled', async () => {
    const alice = await register(server);
    const note = await createNote(server, alice, '重新分享', 'v1');
    const first = await api<NoteShareDto>(server, alice, 'POST', `/api/notes/${note.id}/share`);
    const firstToken = tokenOf(first.body);
    await api(server, alice, 'DELETE', `/api/notes/${note.id}/share`);
    const second = await api<NoteShareDto>(server, alice, 'POST', `/api/notes/${note.id}/share`);
    const secondToken = tokenOf(second.body);

    expect(secondToken).not.toBe(firstToken);
    expect((await server.app.inject({ method: 'GET', url: `/api/shares/${firstToken}` })).statusCode).toBe(404);
    expect((await server.app.inject({ method: 'GET', url: `/api/shares/${secondToken}` })).statusCode).toBe(200);
  });

  it('reads the live CRDT body rather than the debounced projection', async () => {
    const alice = await register(server);
    const note = await createNote(server, alice, '实时内容', '旧正文');
    const enabled = await api<NoteShareDto>(server, alice, 'POST', `/api/notes/${note.id}/share`);
    const token = tokenOf(enabled.body);

    const updated = await api(server, alice, 'PATCH', `/api/notes/${note.id}`, {
      title: '实时内容 v2',
      body: '刚刚写入的新正文',
    });
    expect(updated.status).toBe(200);

    const anonymous = await server.app.inject({ method: 'GET', url: `/api/shares/${token}` });
    expect(anonymous.statusCode).toBe(200);
    expect(anonymous.json()).toMatchObject({ title: '实时内容 v2', body: '刚刚写入的新正文' });
  });

  it('keeps share management inside the owner tenant', async () => {
    const alice = await register(server);
    const bob = await register(server);
    const note = await createNote(server, alice, '私有笔记', 'secret');

    expect((await api(server, bob, 'GET', `/api/notes/${note.id}/share`)).status).toBe(404);
    expect((await api(server, bob, 'POST', `/api/notes/${note.id}/share`)).status).toBe(404);
    expect((await api(server, bob, 'DELETE', `/api/notes/${note.id}/share`)).status).toBe(404);
  });

  it('revokes the link when the note enters the trash and does not restore it', async () => {
    const alice = await register(server);
    const note = await createNote(server, alice, '将进回收站', 'body');
    const enabled = await api<NoteShareDto>(server, alice, 'POST', `/api/notes/${note.id}/share`);
    const token = tokenOf(enabled.body);

    const deleted = await api(server, alice, 'DELETE', `/api/notes/${note.id}`);
    expect(deleted.status).toBe(200);
    expect((await server.app.inject({ method: 'GET', url: `/api/shares/${token}` })).statusCode).toBe(404);

    await api(server, alice, 'POST', `/api/notes/${note.id}/restore`);
    const afterRestore = await api<NoteShareDto>(server, alice, 'GET', `/api/notes/${note.id}/share`);
    expect(afterRestore.body.enabled).toBe(false);
    expect((await server.app.inject({ method: 'GET', url: `/api/shares/${token}` })).statusCode).toBe(404);
  });

  it('revokes the link when a client trashes the note through the CRDT alone', async () => {
    const alice = await register(server);
    const note = await createNote(server, alice, 'CRDT 回收站', 'body');
    const enabled = await api<NoteShareDto>(server, alice, 'POST', `/api/notes/${note.id}/share`);
    const token = tokenOf(enabled.body);
    expect((await server.app.inject({ method: 'GET', url: `/api/shares/${token}` })).statusCode).toBe(200);

    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `ws://127.0.0.1:${server.collabPort()}`,
      name: noteDocName(note.id),
      document: doc,
      token: alice.accessToken,
    });
    await waitFor(() => provider.isSynced, { label: 'client sync' });

    // This path never touches `patchNoteMeta`: the trash flag arrives as an ordinary Yjs update
    // and only the mirror funnel (`mirrorNote`) sees it.
    doc.transact(() => {
      const meta = doc.getMap('meta');
      meta.set('archived', true);
      meta.set('deletedAt', new Date().toISOString());
    });

    await waitFor(
      async () =>
        (await server.app.inject({ method: 'GET', url: `/api/shares/${token}` })).statusCode === 404,
      { label: 'the mirror to revoke the public link' },
    );

    provider.disconnect();
    doc.destroy();
  });

  it('returns the same 404 for malformed and unknown tokens', async () => {
    for (const token of ['short', 'A'.repeat(43)]) {
      const response = await server.app.inject({ method: 'GET', url: `/api/shares/${token}` });
      expect(response.statusCode, token).toBe(404);
      expect(response.json()).toMatchObject({ code: 'NOT_FOUND' });
    }
  });

  it('serves only attachments that belong to the shared note', async () => {
    const alice = await register(server);
    const note = await createNote(server, alice, '带图分享', '![](/api/attachments/placeholder)');
    const other = await createNote(server, alice, '另一篇', 'other');
    const attachment = await upload(server, alice, note.id);
    const otherAttachment = await upload(server, alice, other.id, 'other.png');

    const enabled = await api<NoteShareDto>(server, alice, 'POST', `/api/notes/${note.id}/share`);
    const token = tokenOf(enabled.body);
    const fetched = await server.app.inject({
      method: 'GET',
      url: `/api/shares/${token}/attachments/${attachment.id}`,
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.headers['content-type']).toBe('image/png');
    expect(fetched.headers['cache-control']).toBe('no-store');
    expect(fetched.rawPayload.equals(PNG_BYTES)).toBe(true);

    const wrongNote = await server.app.inject({
      method: 'GET',
      url: `/api/shares/${token}/attachments/${otherAttachment.id}`,
    });
    expect(wrongNote.statusCode).toBe(404);

    await api(server, alice, 'DELETE', `/api/notes/${note.id}/share`);
    const afterRevoke = await server.app.inject({
      method: 'GET',
      url: `/api/shares/${token}/attachments/${attachment.id}`,
    });
    expect(afterRevoke.statusCode).toBe(404);
  });

  it('exposes only the whitelisted public fields', async () => {
    const alice = await register(server);
    const note = await createNote(server, alice, '字段白名单', 'body');
    const enabled = await api<NoteShareDto>(server, alice, 'POST', `/api/notes/${note.id}/share`);
    const response = await server.app.inject({ method: 'GET', url: `/api/shares/${tokenOf(enabled.body)}` });
    const body = response.json() as PublicNoteShareDto & Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['body', 'createdAt', 'title', 'updatedAt']);
  });

  it('never serves another tenant’s attachment through a valid share token', async () => {
    const alice = await register(server);
    const bob = await register(server);
    const aliceNote = await createNote(server, alice, '爱丽丝的笔记', 'a');
    const bobNote = await createNote(server, bob, '鲍勃的笔记', 'b');
    const bobAttachment = await upload(server, bob, bobNote.id, 'bob.png');

    const enabled = await api<NoteShareDto>(server, alice, 'POST', `/api/notes/${aliceNote.id}/share`);
    const response = await server.app.inject({
      method: 'GET',
      url: `/api/shares/${tokenOf(enabled.body)}/attachments/${bobAttachment.id}`,
    });
    expect(response.statusCode).toBe(404);
  });
});
