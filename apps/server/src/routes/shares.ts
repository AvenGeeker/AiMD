import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  ApiError,
  ERROR_CODES,
  noteShareDto,
  publicNoteShareDto,
  shareTokenSchema,
} from '@aimarkdown/shared';
import { currentUser, requireAuth } from '../plugins/auth.js';
import type { ServerConfig } from '../config.js';
import type { NotesDeps } from '../services/notes.js';
import type { AttachmentStorage } from '../services/storage.js';
import {
  disableNoteShare,
  enableNoteShare,
  getNoteShare,
  readPublicNoteShare,
  resolveActiveShare,
} from '../services/shares.js';
import { sendAttachment } from './attachments.js';

/** Public capability links plus the authenticated share toggle used by every client. */

export interface ShareRouteDeps {
  notes: NotesDeps;
  config: ServerConfig;
  storage: AttachmentStorage;
}

function shareOrigin(request: FastifyRequest, config: ServerConfig): string {
  const configured = config.PUBLIC_URL.trim().replace(/\/+$/, '');
  if (configured) return configured;
  const host = request.headers.host ?? 'localhost';
  return `${request.protocol}://${host}`;
}

function validToken(value: string): boolean {
  return shareTokenSchema.safeParse(value).success;
}

export function registerShareRoutes(app: FastifyInstance, deps: ShareRouteDeps): void {
  const opts = { preHandler: [requireAuth] };

  app.get('/api/notes/:id/share', opts, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await getNoteShare(
      deps.notes,
      currentUser(request).id,
      id,
      shareOrigin(request, deps.config),
    );
    return reply.send(noteShareDto.parse(result));
  });

  app.post('/api/notes/:id/share', opts, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await enableNoteShare(
      deps.notes,
      currentUser(request).id,
      id,
      shareOrigin(request, deps.config),
    );
    return reply.send(noteShareDto.parse(result));
  });

  app.delete('/api/notes/:id/share', opts, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await disableNoteShare(
      deps.notes,
      currentUser(request).id,
      id,
      shareOrigin(request, deps.config),
    );
    return reply.send(noteShareDto.parse(result));
  });

  app.get('/api/shares/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    if (!validToken(token)) {
      throw new ApiError(ERROR_CODES.NOT_FOUND, '分享链接不存在或已关闭');
    }
    const result = await readPublicNoteShare(deps.notes, token);
    return reply
      .header('cache-control', 'no-store')
      // Capability URLs must not end up in a search index, even when fetched directly.
      .header('x-robots-tag', 'noindex, nofollow')
      .send(publicNoteShareDto.parse(result));
  });

  app.get('/api/shares/:token/attachments/:id', async (request, reply) => {
    const { token, id } = request.params as { token: string; id: string };
    if (!validToken(token)) {
      throw new ApiError(ERROR_CODES.NOT_FOUND, '分享链接不存在或已关闭');
    }
    const share = await resolveActiveShare(deps.notes.sql, token);
    if (!share) throw new ApiError(ERROR_CODES.NOT_FOUND, '分享链接不存在或已关闭');

    const rows = await deps.notes.sql`
      select filename, mime, size, storage_key from attachments
      where id = ${id} and note_id = ${share.noteId} and owner_id = ${share.ownerId}
    `;
    const row = rows[0];
    if (!row) throw new ApiError(ERROR_CODES.NOT_FOUND, '附件不存在');
    return sendAttachment(reply, deps.storage, row);
  });
}
