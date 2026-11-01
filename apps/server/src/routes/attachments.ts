import type { FastifyInstance } from 'fastify';
import {
  ApiError,
  ERROR_CODES,
  MAX_ATTACHMENT_BYTES,
  attachmentDto,
  isImageMime,
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

    const mime = (file.mimetype || 'application/octet-stream').toLowerCase();
    const buffer = await file.toBuffer();
    if (buffer.byteLength === 0) throw new ApiError(ERROR_CODES.BAD_REQUEST, '文件为空');
    if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new ApiError(ERROR_CODES.PAYLOAD_TOO_LARGE, '文件超过 100MB 限制');
    }

    const id = newId();
    const nameExt = (file.filename || '').match(/\.([A-Za-z0-9]{1,12})$/)?.[1]?.toLowerCase();
    const ext = MIME_TO_EXT[mime] ?? (nameExt || 'bin');
    const original = (file.filename || `attachment.${ext}`).replace(/[\\/:*?"<>|\0]/g, '_').slice(0, 120);
    const storageKey = `${ownerId}/${id}.${ext}`;

    const noteIdParam = (request.query as Record<string, string> | undefined)?.noteId;
    if (noteIdParam) {
      const owned = await deps.sql`select id from notes where id = ${noteIdParam} and owner_id = ${ownerId}`;
      if (owned.length === 0) throw new ApiError(ERROR_CODES.NOT_FOUND, '目标笔记不存在');
    }

    await deps.storage.save(storageKey, new Uint8Array(buffer));
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
    const mime = String(row.mime);
    const inlineImage = isImageMime(mime) && mime !== 'image/svg+xml';
    const disposition = inlineImage
      ? `inline; filename*=UTF-8''${encodeURIComponent(filename)}`
      : contentDisposition(filename.replace(/\.[^.]+$/, ''), extOf(filename));

    return reply
      .header('content-type', mime)
      .header('content-length', String(data.byteLength))
      .header('content-disposition', disposition)
      // Active content (SVG/HTML) must never execute in the app's own origin.
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .send(Buffer.from(data));
  });
}

function extOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot + 1) : 'bin';
}
