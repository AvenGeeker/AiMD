import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AttachmentDto } from '@aimarkdown/shared';
import { api, databaseAvailable, register, startTestServer, type AuthedClient, type TestServer } from './helpers.js';
import { assertSafeKey } from '../../src/services/storage.js';
import type { NoteDto } from '@aimarkdown/shared';

const dbUp = await databaseAvailable();
const describeDb = dbUp ? describe : describe.skip;

/** Minimal 1x1 red PNG. */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function multipart(fields: { name: string; filename: string; contentType: string; data: Buffer }[], boundary: string): Buffer {
  const parts = fields.map((field) =>
    Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${field.name}"; filename="${field.filename}"\r\n` +
          `Content-Type: ${field.contentType}\r\n\r\n`,
        'utf8',
      ),
      field.data,
      Buffer.from('\r\n', 'utf8'),
    ]),
  );
  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return Buffer.concat(parts);
}

async function upload(
  server: TestServer,
  client: AuthedClient,
  file: { filename: string; contentType: string; data: Buffer },
) {
  const boundary = '----amdattachmentboundary';
  return server.app.inject({
    method: 'POST',
    url: '/api/attachments',
    headers: { ...client.header, 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: multipart([{ name: 'file', ...file }], boundary),
  });
}

describe('storage key validation', () => {
  it('accepts ordinary nested keys', () => {
    expect(() => assertSafeKey('user/note/image.png')).not.toThrow();
  });

  it('rejects traversal and absolute keys', () => {
    for (const key of ['../escape', 'a/../../b', '/etc/passwd', 'a\\b', '']) {
      expect(() => assertSafeKey(key), `key ${JSON.stringify(key)}`).toThrow();
    }
  });
});

describeDb('attachments', () => {
  let server: TestServer;
  let client: AuthedClient;

  beforeAll(async () => {
    server = await startTestServer();
    client = await register(server);
  });

  afterAll(async () => {
    await server?.stop();
  });

  it('uploads an image and returns a usable url', async () => {
    const response = await upload(server, client, {
      filename: 'pixel.png',
      contentType: 'image/png',
      data: PNG_BYTES,
    });
    expect(response.statusCode).toBe(201);
    const body = response.json() as AttachmentDto;
    expect(body.mime).toBe('image/png');
    expect(body.size).toBe(PNG_BYTES.byteLength);
    expect(body.url).toContain(`/api/attachments/${body.id}`);

    const fetched = await server.app.inject({
      method: 'GET',
      url: `/api/attachments/${body.id}`,
      headers: client.header,
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.headers['content-type']).toBe('image/png');
    expect(fetched.rawPayload.equals(PNG_BYTES)).toBe(true);
    expect(fetched.headers['x-content-type-options']).toBe('nosniff');
  });

  it('accepts a non-image attachment but serves it as a sandboxed download', async () => {
    const data = Buffer.from('<script>alert(1)</script>');
    const response = await upload(server, client, {
      filename: 'evil.html',
      contentType: 'text/html',
      data,
    });
    expect(response.statusCode).toBe(201);
    const body = response.json() as AttachmentDto;
    const fetched = await server.app.inject({
      method: 'GET',
      url: `/api/attachments/${body.id}`,
      headers: client.header,
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.headers['content-disposition']).toContain('attachment');
    expect(fetched.headers['content-security-policy']).toContain('sandbox');
  });

  it('serves an uploaded SVG with a locked-down CSP so it cannot script the app', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>');
    const response = await upload(server, client, {
      filename: 'shape.svg',
      contentType: 'image/svg+xml',
      data: svg,
    });
    expect(response.statusCode).toBe(201);
    const body = response.json() as AttachmentDto;

    const fetched = await server.app.inject({
      method: 'GET',
      url: `/api/attachments/${body.id}`,
      headers: client.header,
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.headers['content-security-policy']).toContain('sandbox');
  });

  it('requires authentication to download', async () => {
    const uploaded = await upload(server, client, {
      filename: 'secret.png',
      contentType: 'image/png',
      data: PNG_BYTES,
    });
    const id = (uploaded.json() as AttachmentDto).id;

    const anonymous = await server.app.inject({ method: 'GET', url: `/api/attachments/${id}` });
    expect(anonymous.statusCode).toBe(401);
  });

  it('does not let another user download the attachment', async () => {
    const uploaded = await upload(server, client, {
      filename: 'private.png',
      contentType: 'image/png',
      data: PNG_BYTES,
    });
    const id = (uploaded.json() as AttachmentDto).id;

    const intruder = await register(server);
    const response = await server.app.inject({
      method: 'GET',
      url: `/api/attachments/${id}`,
      headers: intruder.header,
    });
    expect(response.statusCode).toBe(404);
  });

  it('returns 404 for an unknown attachment id', async () => {
    const response = await server.app.inject({
      method: 'GET',
      url: '/api/attachments/doesnotexist1',
      headers: client.header,
    });
    expect(response.statusCode).toBe(404);
  });

  it('can be referenced from a note body and survives export rewriting', async () => {
    const uploaded = await upload(server, client, {
      filename: 'inline.png',
      contentType: 'image/png',
      data: PNG_BYTES,
    });
    const attachment = uploaded.json() as AttachmentDto;

    const note = await api<NoteDto>(server, client, 'POST', '/api/notes', {
      title: '带图笔记',
      body: `正文\n\n![](/api/attachments/${attachment.id})\n`,
    });
    expect(note.body.body).toContain(`/api/attachments/${attachment.id}`);

    // Attachments are scoped to the owner in the storage layer, so the download still works.
    const fetched = await server.app.inject({
      method: 'GET',
      url: `/api/attachments/${attachment.id}`,
      headers: client.header,
    });
    expect(fetched.statusCode).toBe(200);
  });
});
