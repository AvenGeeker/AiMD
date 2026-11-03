import type { FastifyInstance } from 'fastify';
import {
  ApiError,
  ERROR_CODES,
  createNoteInput,
  createNotesBatchInput,
  createNotesBatchDto,
  noteBodyBatchInput,
  noteBodyBatchDto,
  listNotesQuery,
  noteDto,
  noteListDto,
  noteSummaryDto,
  quickCaptureSubmitInput,
  quickCaptureResultDto,
  updateNoteInput,
  type NoteSort,
} from '@aimarkdown/shared';
import { requireAuth, currentUser } from '../plugins/auth.js';
import { parse, parseIdList } from '../utils/validate.js';
import {
  appendQuickCapture,
  createNote,
  getNote,
  listNotes,
  patchNoteMeta,
  positionBetween,
  readNoteBody,
  readNoteBodies,
  toSummary,
  type NotesDeps,
} from '../services/notes.js';
import { getSettings } from '../services/workspace.js';
import type { WorkspaceDeps } from '../services/workspace.js';
import { exportNoteMarkdown } from '../services/vault.js';

export function registerNoteRoutes(app: FastifyInstance, deps: NotesDeps, ws: WorkspaceDeps): void {
  const opts = { preHandler: [requireAuth] };

  app.get('/api/notes', opts, async (request, reply) => {
    const query = parse(listNotesQuery, request.query, '查询参数');
    const result = await listNotes(deps, currentUser(request).id, {
      folderId: query.folderId === undefined ? undefined : query.folderId,
      rootOnly: query.rootOnly,
      tagIds: parseIdList(query.tagIds),
      recursive: query.recursive,
      sourcePlatform: query.sourcePlatform ?? null,
      q: query.q ?? null,
      archived: query.archived,
      sort: query.sort as NoteSort,
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
    return reply.send(noteListDto.parse(result));
  });

  app.post('/api/notes', opts, async (request, reply) => {
    const input = parse(createNoteInput, request.body ?? {}, '新建笔记参数');
    const record = await createNote(deps, currentUser(request).id, input);
    return reply.code(201).send(noteDto.parse({ ...toSummary(record), body: record.bodyText }));
  });

  /**
   * Batch body reads for the macOS sync host. Bodies come from the authoritative Y.Doc, not the
   * projection, and the response is intentionally bounded so one huge note cannot exhaust memory.
   */
  app.post('/api/notes/bodies', opts, async (request, reply) => {
    const input = parse(noteBodyBatchInput, request.body ?? {}, '批量读取笔记参数');
    const items = await readNoteBodies(deps, currentUser(request).id, input.ids);
    const total = items.reduce((sum, item) => sum + item.body.length, 0);
    if (total > 16 * 1024 * 1024) {
      throw new ApiError(ERROR_CODES.PAYLOAD_TOO_LARGE, '本批笔记正文过大，请减小批次');
    }
    return reply.send(noteBodyBatchDto.parse({ items }));
  });

  /** Idempotent batch creation used for first imports; each item reports its own result. */
  app.post('/api/notes/batch-create', { ...opts, bodyLimit: 64 * 1024 * 1024 }, async (request, reply) => {
    const input = parse(createNotesBatchInput, request.body ?? {}, '批量新建笔记参数');
    const ownerId = currentUser(request).id;
    const items = [];
    for (const [index, item] of input.items.entries()) {
      try {
        const record = await createNote(deps, ownerId, item);
        items.push({
          index,
          ok: true,
          note: { ...toSummary(record), body: record.bodyText },
        });
      } catch (error) {
        const body = error instanceof ApiError
          ? error.toJSON()
          : { code: ERROR_CODES.INTERNAL, message: error instanceof Error ? error.message : String(error) };
        items.push({ index, ok: false, error: { code: body.code, message: body.message } });
      }
    }
    return reply.code(201).send(createNotesBatchDto.parse({ items }));
  });

  app.get('/api/notes/:id', opts, async (request, reply) => {
    const { id } = request.params as { id: string };
    const record = await getNote(deps, currentUser(request).id, id);
    if (!record) throw new ApiError(ERROR_CODES.NOT_FOUND, '笔记不存在');
    // The body is read from the CRDT document, which is authoritative over the mirror.
    const body = await readNoteBody(deps, currentUser(request).id, id);
    return reply.send(noteDto.parse({ ...toSummary(record), body }));
  });

  app.patch('/api/notes/:id', { ...opts, bodyLimit: 4 * 1024 * 1024 }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = parse(updateNoteInput, request.body ?? {}, '更新笔记参数');
    const ownerId = currentUser(request).id;

    const position =
      input.before !== undefined || input.after !== undefined
        ? positionBetween(input.before ?? null, input.after ?? null)
        : undefined;

    const record = await patchNoteMeta(deps, ownerId, id, {
      ...(input.folderId !== undefined ? { folderId: input.folderId } : {}),
      ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
      ...(input.archived !== undefined ? { archived: input.archived } : {}),
      ...(input.tagIds !== undefined ? { tagIds: input.tagIds } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.expectedStateHash !== undefined ? { expectedStateHash: input.expectedStateHash } : {}),
      ...(position ? { position } : {}),
    });
    return reply.send(noteSummaryDto.parse(toSummary(record)));
  });

  app.delete('/api/notes/:id', opts, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = currentUser(request).id;
    const permanent = String((request.query as Record<string, string>)?.permanent ?? '') === '1';

    if (permanent) {
      const existing = await getNote(deps, ownerId, id, { includeDeleted: true });
      if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, '笔记不存在');
      // Deleting the row cascades to note_documents and note_tags.
      await deps.sql`delete from notes where id = ${id} and owner_id = ${ownerId}`;
      return reply.send({ ok: true, permanent: true });
    }

    await patchNoteMeta(deps, ownerId, id, {
      archived: true,
      deletedAt: new Date().toISOString(),
    });
    return reply.send({ ok: true, permanent: false });
  });

  app.post('/api/notes/:id/restore', opts, async (request, reply) => {
    const { id } = request.params as { id: string };
    const record = await patchNoteMeta(deps, currentUser(request).id, id, {
      archived: false,
      deletedAt: null,
    });
    return reply.send(noteSummaryDto.parse(toSummary(record)));
  });

  /**
   * HTTP quick-capture.
   *
   * The desktop app captures through the CRDT directly in its own renderer, but this endpoint
   * gives the web client — and the integration tests — the same append semantics.
   */
  app.post('/api/notes/:id/capture', opts, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = currentUser(request).id;
    const input = parse(quickCaptureSubmitInput, request.body ?? {}, '速记内容');
    const settings = await getSettings(ws, ownerId);

    const result = await appendQuickCapture(
      deps,
      ownerId,
      id,
      input.text,
      input.stampFormat ?? settings.stampFormat,
    );
    return reply.send(
      quickCaptureResultDto.parse({
        ok: true,
        noteId: result.noteId,
        appendedChars: result.appendedChars,
        message: null,
      }),
    );
  });

  app.get('/api/notes/:id/export', opts, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = currentUser(request).id;
    const record = await getNote(deps, ownerId, id);
    if (!record) throw new ApiError(ERROR_CODES.NOT_FOUND, '笔记不存在');
    const body = await readNoteBody(deps, ownerId, id);
    const markdown = exportNoteMarkdown({ title: record.title, body, attachments: [] });

    return reply
      .header('content-type', 'text/markdown; charset=utf-8')
      .header('content-disposition', contentDisposition(record.title, 'md'))
      .send(markdown);
  });
}

/**
 * Build a `Content-Disposition` header that survives non-ASCII titles.
 *
 * The plain `filename=` parameter is an ASCII fallback for old clients; `filename*` carries the
 * RFC 5987 percent-encoded UTF-8 name so Chinese titles download correctly.
 */
export function contentDisposition(title: string, extension: string): string {
  const cleaned = title.trim().replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 80) || 'note';
  const asciiFallback = cleaned.replace(/[^\x20-\x7e]/g, '_').replace(/\s+/g, '_') || 'note';
  const encoded = encodeURIComponent(`${cleaned}.${extension}`);
  return `attachment; filename="${asciiFallback}.${extension}"; filename*=UTF-8''${encoded}`;
}
