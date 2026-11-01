import type { FastifyInstance } from 'fastify';
import {
  createFolderInput,
  folderDto,
  settingsPatchInput,
  treeDto,
  updateFolderInput,
  upsertTagInput,
  tagDto,
  type FolderDto,
} from '@aimarkdown/shared';
import { requireAuth, currentUser } from '../plugins/auth.js';
import { parse } from '../utils/validate.js';
import {
  createFolder,
  getTree,
  upsertTag,
  listTags,
  removeFolder,
  removeTag,
  updateFolder,
  updateSettings,
  getSettings,
  type WorkspaceDeps,
} from '../services/workspace.js';

export function registerTreeRoutes(app: FastifyInstance, ws: WorkspaceDeps): void {
  const opts = { preHandler: [requireAuth] };

  app.get('/api/tree', opts, async (request, reply) => {
    return reply.send(treeDto.parse(await getTree(ws, currentUser(request).id)));
  });

  app.get('/api/settings', opts, async (request, reply) => {
    return reply.send(await getSettings(ws, currentUser(request).id));
  });

  app.patch('/api/settings', opts, async (request, reply) => {
    const patch = parse(settingsPatchInput, request.body ?? {}, '设置');
    return reply.send(await updateSettings(ws, currentUser(request).id, patch));
  });

  /* -------------------------------- folders -------------------------------- */

  app.post('/api/folders', opts, async (request, reply) => {
    const input = parse(createFolderInput, request.body ?? {}, '新建目录');
    const created = await createFolder(ws, currentUser(request).id, {
      ...(input.id ? { id: input.id } : {}),
      name: input.name,
      parentId: input.parentId ?? null,
    });
    return reply.code(201).send(folderDto.parse(created));
  });

  app.patch('/api/folders/:id', opts, async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = parse(updateFolderInput, request.body ?? {}, '更新目录');
    const updated: FolderDto = await updateFolder(ws, currentUser(request).id, id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      ...(input.before !== undefined ? { before: input.before } : {}),
      ...(input.after !== undefined ? { after: input.after } : {}),
    });
    return reply.send(folderDto.parse(updated));
  });

  app.delete('/api/folders/:id', opts, async (request, reply) => {
    const { id } = request.params as { id: string };
    await removeFolder(ws, currentUser(request).id, id);
    return reply.send({ ok: true });
  });

  /* --------------------------------- tags ---------------------------------- */

  app.get('/api/tags', opts, async (request, reply) => {
    const tags = await listTags(ws, currentUser(request).id);
    return reply.send({ items: tags.map((tag) => tagDto.parse(tag)) });
  });

  app.post('/api/tags', opts, async (request, reply) => {
    const input = parse(upsertTagInput, request.body ?? {}, '标签');
    const tag = await upsertTag(ws, currentUser(request).id, {
      name: input.name,
      ...(input.id ? { id: input.id } : {}),
      ...(input.color ? { color: input.color } : {}),
    });
    return reply.code(201).send(tagDto.parse(tag));
  });

  app.patch('/api/tags/:id', opts, async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = parse(upsertTagInput, request.body ?? {}, '标签');
    const tag = await upsertTag(ws, currentUser(request).id, {
      id,
      name: input.name,
      ...(input.color ? { color: input.color } : {}),
    });
    return reply.send(tagDto.parse(tag));
  });

  app.delete('/api/tags/:id', opts, async (request, reply) => {
    const { id } = request.params as { id: string };
    await removeTag(ws, currentUser(request).id, id);
    return reply.send({ ok: true });
  });
}

