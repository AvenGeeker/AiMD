import type { FastifyInstance } from 'fastify';
import {
  ALLOWED_ATTACHMENT_MIME,
  ApiError,
  ERROR_CODES,
  MAX_ATTACHMENT_BYTES,
  attachmentDto,
} from '@aimarkdown/shared';
import { requireAuth, currentUser } from '../plugins/auth.js';
import { newId } from '../utils/ids.js';
import type { AttachmentStorage } from '../services/storage.js';
import type { Sql } from 'postgres';
import { contentDisposition } from './notes.js';

/** Image attachments: uploaded on paste/drop, stored on a volume, served behind auth. */

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
};

export interface AttachmentDeps {
  sql: Sql;
  storage: AttachmentStorage;
  publicUrl: string;
}

function publicUrlFor(deps: AttachmentDeps, id: string): string {
  const base = deps.publicUrl.replace(/\/+$/, '');
  return `${base}/api/attachments/${id}`;
}

export function registerAttachmentRoutes(app: FastifyInstance, deps: AttachmentDeps): void {
  const opts = { preHandler: [requireAuth] };

  app.post('/api/attachments', opts, async (request, reply) => {
    const ownerId = currentUser(request).id;
    const file = await request.file();
    if (!file) throw new ApiError(ERROR_CODES.BAD_REQUEST, '未收到文件');

    const mime = file.mimetype;
    if (!(ALLOWED_ATTACHMENT_MIME as readonly string[]).includes(mime)) {
      throw new ApiError(ERROR_CODES.UNSUPPORTED_MEDIA_TYPE, `不支持的文件类型：${mime}`);
    }

    const buffer = await file.toBuffer();
    if (buffer.byteLength === 0) throw new ApiError(ERROR_CODES.BAD_REQUEST, '文件为空');
    if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new ApiError(ERROR_CODES.PAYLOAD_TOO_LARGE, '文件超过 10MB 限制');
    }

    const id = newId();
    const ext = MIME_TO_EXT[mime] ?? 'bin';
    const original = (file.filename || `image.${ext}`).replace(/[\\/:*?"<>|\0]/g, '_').slice(0, 120);
    const storageKey = `${ownerId}/${id}.${ext}`;

    await deps.storage.save(storageKey, new Uint8Array(buffer));

    const noteIdParam = (request.query as Record<string, string> | undefined)?.noteId;
    await deps.sql`
      insert into attachments (id, owner_id, note_id, filename, mime, size, storage_key, created_at)
      values (${id}, ${ownerId}, ${noteIdParam ?? null}, ${original}, ${mime}, ${buffer.byteLength}, ${storageKey}, now())
    `;

    return reply.code(201).send(
      attachmentDto.parse({
        id,
        filename: original,
        mime,
        size: buffer.byteLength,
        url: publicUrlFor(deps, id),
        createdAt: new Date().toISOString(),
      }),
    );
  });

  app.get('/api/attachments/:id', opts, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = currentUser(request).id;

    const rows = await deps.sql`
      select filename, mime, size, storage_key from attachments
      where id = ${id} and owner_id = ${ownerId}
    `;
    const row = rows[0];
    if (!row) throw new ApiError(ERROR_CODES.NOT_FOUND, '附件不存在');

    const data = await deps.storage.read(String(row.storage_key));
    if (!data) throw new ApiError(ERROR_CODES.NOT_FOUND, '附件文件缺失');

    const filename = String(row.filename);
    const isSvg = String(row.mime) === 'image/svg+xml';

    return reply
      .header('content-type', String(row.mime))
      .header('content-length', String(data.byteLength))
      .header('content-disposition', contentDisposition(filename.replace(/\.[^.]+$/, ''), extOf(filename)))
      // SVG can carry script; never let it render inline in the app's own origin.
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', isSvg ? "default-src 'none'; sandbox" : "default-src 'none'")
      .send(Buffer.from(data));
  });
}

function extOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot + 1) : 'bin';
}
