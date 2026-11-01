import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AttachmentDto, CreateNotesBatchDto, NoteBodyBatchDto, NoteDto, NoteListDto, NoteSummaryDto } from '@aimarkdown/shared';
import { api, databaseAvailable, register, startTestServer, type AuthedClient, type TestServer } from './helpers.js';

const dbUp = await databaseAvailable();
const describeDb = dbUp ? describe : describe.skip;

function hash(title: string, folderId: string | null, body: string): string {
  return createHash('sha256').update(JSON.stringify([title, folderId, body]), 'utf8').digest('hex');
}

function multipart(file: { filename: string; contentType: string; data: Buffer }, boundary: string): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
        `Content-Type: ${file.contentType}\r\n\r\n`,
      'utf8',
    ),
    file.data,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
  ]);
}

describeDb('Apple Notes sync API', () => {
  let server: TestServer;
  let client: AuthedClient;
  let intruder: AuthedClient;

  beforeAll(async () => {
    server = await startTestServer();
    client = await register(server);
    intruder = await register(server);
  });

  afterAll(async () => {
    await server?.stop();
  });

  it('lists archived notes with archived=all', async () => {
    const created = await api<NoteDto>(server, client, 'POST', '/api/notes', {
      title: '归档测试',
      body: '归档正文',
    });
    const archived = await api<NoteSummaryDto>(server, client, 'PATCH', `/api/notes/${created.body.id}`, {
      archived: true,
    });
    expect(archived.status).toBe(200);

    const all = await api<NoteListDto>(server, client, 'GET', '/api/notes?archived=all&limit=200');
    expect(all.body.items.some((note) => note.id === created.body.id && note.archived)).toBe(true);
    const live = await api<NoteListDto>(server, client, 'GET', '/api/notes?archived=false&limit=200');
    expect(live.body.items.some((note) => note.id === created.body.id)).toBe(false);
  });

  it('batch-reads bodies with a stable state hash and omits foreign ids', async () => {
    const created = await api<NoteDto>(server, client, 'POST', '/api/notes', {
      title: '批量正文',
      body: '# 标题\n\n正文',
    });
    const result = await api<NoteBodyBatchDto>(server, client, 'POST', '/api/notes/bodies', {
      ids: [created.body.id],
    });
    expect(result.status).toBe(200);
    const item = result.body.items[0];
    expect(item?.body).toContain('正文');
    expect(item?.stateHash).toBe(hash(created.body.title, created.body.folderId, created.body.body));

    const foreign = await api<NoteBodyBatchDto>(server, intruder, 'POST', '/api/notes/bodies', {
      ids: [created.body.id],
    });
    expect(foreign.status).toBe(200);
    expect(foreign.body.items).toEqual([]);
  });

  it('batch-create is idempotent and owner-scoped', async () => {
    const id = 'sync_note_idempotent_1';
    const payload = {
      items: [{ id, title: '幂等导入', body: '同一篇', createdAt: '2020-01-02T03:04:05.000Z' }],
    };
    const first = await api<CreateNotesBatchDto>(server, client, 'POST', '/api/notes/batch-create', payload);
    expect(first.status).toBe(201);
    expect(first.body.items[0]?.ok).toBe(true);
    expect(first.body.items[0]?.note?.id).toBe(id);

    const second = await api<CreateNotesBatchDto>(server, client, 'POST', '/api/notes/batch-create', payload);
    expect(second.status).toBe(201);
    expect(second.body.items[0]?.note?.id).toBe(id);

    const folder = await api<{ id: string }>(server, client, 'POST', '/api/folders', { id: 'sync_folder_owner1', name: '同步目录' });
    expect(folder.status).toBe(201);
    const foreignFolder = await api<CreateNotesBatchDto>(server, intruder, 'POST', '/api/notes/batch-create', {
      items: [{ id: 'sync_note_foreign', title: '越权', folderId: folder.body.id, body: '不应创建' }],
    });
    expect(foreignFolder.status).toBe(201);
    expect(foreignFolder.body.items[0]?.ok).toBe(false);
  });

  it('rejects a stale expectedStateHash without changing the body', async () => {
    const created = await api<NoteDto>(server, client, 'POST', '/api/notes', {
      title: '并发保护',
      body: '原始正文',
    });
    const stale = hash(created.body.title, created.body.folderId, created.body.body);
    const updated = await api<NoteSummaryDto>(server, client, 'PATCH', `/api/notes/${created.body.id}`, {
      body: '第一版',
      expectedStateHash: stale,
    });
    expect(updated.status).toBe(200);

    const conflict = await api<{ code: string }>(server, client, 'PATCH', `/api/notes/${created.body.id}`, {
      body: '不应写入',
      expectedStateHash: stale,
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('CONFLICT');
    const after = await api<NoteDto>(server, client, 'GET', `/api/notes/${created.body.id}`);
    expect(after.body.body).toBe('第一版');
  });

  it('does not let another tenant patch a note', async () => {
    const created = await api<NoteDto>(server, client, 'POST', '/api/notes', { title: '租户边界', body: '正文' });
    const response = await api<{ code: string }>(server, intruder, 'PATCH', `/api/notes/${created.body.id}`, {
      body: '篡改',
    });
    expect(response.status).toBe(404);
  });

  it('accepts arbitrary attachments and validates note ownership', async () => {
    const boundary = '----aimdsyncattachment';
    const uploaded = await server.app.inject({
      method: 'POST',
      url: '/api/attachments',
      headers: { ...client.header, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipart({ filename: 'manual.pdf', contentType: 'application/pdf', data: Buffer.from('%PDF-1.4 test') }, boundary),
    });
    expect(uploaded.statusCode).toBe(201);
    const attachment = uploaded.json() as AttachmentDto;
    expect(attachment.mime).toBe('application/pdf');
    const downloaded = await server.app.inject({
      method: 'GET',
      url: `/api/attachments/${attachment.id}`,
      headers: client.header,
    });
    expect(downloaded.statusCode).toBe(200);
    expect(downloaded.headers['content-disposition']).toContain('attachment');

    const note = await api<NoteDto>(server, client, 'POST', '/api/notes', { title: '附件归属', body: '' });
    const foreignNote = await server.app.inject({
      method: 'POST',
      url: `/api/attachments?noteId=${note.body.id}`,
      headers: { ...intruder.header, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipart({ filename: 'x.bin', contentType: 'application/octet-stream', data: Buffer.from('x') }, boundary),
    });
    expect(foreignNote.statusCode).toBe(404);
  });
});
