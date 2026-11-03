import type { FastifyInstance } from 'fastify';
import {
  ApiError,
  ERROR_CODES,
  favoriteCategoryInput,
  favoritePreviewDto,
  favoritePreviewInput,
  favoriteSaveInput,
  favoriteSaveResultDto,
  type SourcePlatform,
} from '@aimarkdown/shared';
import { requireAuth, currentUser } from '../plugins/auth.js';
import { parse } from '../utils/validate.js';
import { newId } from '../utils/ids.js';
import {
  importMediaFavorite,
  previewFavorite,
  saveFavorite,
  setFavoriteCategory,
  type FavoriteDeps,
} from '../favorites/service.js';

export interface FavoriteRouteDeps extends FavoriteDeps {
  ai: NonNullable<FavoriteDeps['ai']>;
}

export function registerFavoriteRoutes(app: FastifyInstance, deps: FavoriteRouteDeps): void {
  const opts = { preHandler: [requireAuth] };

  app.post('/api/favorites/preview', { ...opts, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const input = parse(favoritePreviewInput, request.body ?? {}, '收藏链接');
    return reply.send(favoritePreviewDto.parse(await previewFavorite(deps, currentUser(request).id, input.url)));
  });

  app.post('/api/favorites', { ...opts, bodyLimit: 10 * 1024 * 1024 }, async (request, reply) => {
    const input = parse(favoriteSaveInput, request.body ?? {}, '收藏参数');
    const result = await saveFavorite(deps, currentUser(request).id, input);
    return reply.code(result.created ? 201 : 200).send(favoriteSaveResultDto.parse(result));
  });

  app.post('/api/favorites/import-media', { ...opts, config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async (request, reply) => {
    const ownerId = currentUser(request).id;
    const fields: Record<string, string> = {};
    const files: Array<{ filename: string; mime: string; data: Uint8Array }> = [];
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        const data = await part.toBuffer();
        files.push({
          filename: part.filename || 'shared-media',
          mime: (part.mimetype || 'application/octet-stream').toLowerCase(),
          data: new Uint8Array(data),
        });
      } else if (typeof part.value === 'string') {
        fields[part.fieldname] = part.value;
      }
    }
    if (files.length === 0) throw new ApiError(ERROR_CODES.BAD_REQUEST, '未收到图片或视频');
    const title = (fields.title || files[0]?.filename || '收藏媒体').slice(0, 200);
    const result = await importMediaFavorite(deps, ownerId, {
      title,
      body: fields.body ?? '',
      sourceUrl: fields.url || null,
      platform: (fields.platform as SourcePlatform | undefined) ?? 'manual',
      folderId: fields.folderId || undefined,
      forceNew: fields.forceNew === 'true',
      files,
    });
    return reply.code(201).send(favoriteSaveResultDto.parse(result));
  });

  app.post('/api/favorites/:id/classify', opts, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = currentUser(request).id;
    const rows = await deps.sql`
      select id from notes where id = ${id} and owner_id = ${ownerId}
        and source_platform is not null and deleted_at is null
    `;
    if (rows.length === 0) throw new ApiError(ERROR_CODES.NOT_FOUND, '收藏不存在');
    const job = await deps.ai.enqueueFavorite(ownerId, id);
    return reply.code(202).send({ job });
  });

  app.post('/api/favorites/:id/category', opts, async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = parse(favoriteCategoryInput, request.body ?? {}, '收藏分类');
    await setFavoriteCategory(deps, currentUser(request).id, id, input);
    return reply.send({ ok: true });
  });

  app.post('/api/favorites/:id/media/retry', opts, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = currentUser(request).id;
    const noteRows = await deps.sql`
      select id from notes where id = ${id} and owner_id = ${ownerId} and deleted_at is null
    `;
    if (noteRows.length === 0) throw new ApiError(ERROR_CODES.NOT_FOUND, '收藏不存在');
    const active = await deps.sql`
      select id from media_jobs where note_id = ${id} and status in ('queued', 'running') limit 1
    `;
    if (active.length === 0) {
      const rows = await deps.sql`
        select id, mime from attachments where note_id = ${id} and owner_id = ${ownerId}
      `;
      const imageIds = rows.filter((row) => String(row.mime).startsWith('image/')).map((row) => String(row.id));
      const videoId = rows.find((row) => String(row.mime).startsWith('video/'))?.id;
      await deps.sql`
        insert into media_jobs (id, owner_id, note_id, status, image_ids, video_id)
        values (${newId()}, ${ownerId}, ${id}, 'queued', ${imageIds}::text[], ${videoId ? String(videoId) : null})
      `;
    } else {
      await deps.sql`
        update media_jobs set status = 'queued', error = null, started_at = null, finished_at = null, updated_at = now()
        where id = ${String(active[0]!.id)}
      `;
    }
    return reply.send({ ok: true });
  });
}
