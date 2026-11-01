import type { FastifyInstance } from 'fastify';
import {
  ApiError,
  ERROR_CODES,
  aiConfigInput,
  aiConfigTestInput,
  aiJobEnvelopeDto,
  aiOverviewDto,
} from '@aimarkdown/shared';
import { requireAuth, currentUser } from '../plugins/auth.js';
import { parse } from '../utils/validate.js';
import type { AiService } from '../ai/service.js';

export function registerAiRoutes(app: FastifyInstance, ai: AiService): void {
  const opts = { preHandler: [requireAuth] };

  app.get('/api/ai/overview', opts, async (request, reply) => {
    return reply.send(aiOverviewDto.parse(await ai.getOverview(currentUser(request).id)));
  });

  app.put('/api/ai/config', opts, async (request, reply) => {
    const input = parse(aiConfigInput, request.body ?? {}, 'AI 配置');
    return reply.send(await ai.saveConfig(currentUser(request).id, input));
  });

  app.delete('/api/ai/config', opts, async (request, reply) => {
    await ai.deleteConfig(currentUser(request).id);
    return reply.send({ ok: true });
  });

  app.post('/api/ai/config/test', opts, async (request, reply) => {
    const input = parse(aiConfigTestInput, request.body ?? {}, 'AI 连接测试参数');
    return reply.send(await ai.testConfig(currentUser(request).id, input));
  });

  app.post('/api/notes/:id/ai/analyze', opts, async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await ai.enqueueNote(currentUser(request).id, id);
    return reply.code(202).send(aiJobEnvelopeDto.parse({ job }));
  });

  app.post('/api/ai/backfill', opts, async (request, reply) => {
    const job = await ai.startBackfill(currentUser(request).id);
    return reply.code(202).send(aiJobEnvelopeDto.parse({ job }));
  });

  app.get('/api/ai/jobs/:id', opts, async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await ai.getJob(currentUser(request).id, id);
    if (!job) throw new ApiError(ERROR_CODES.NOT_FOUND, 'AI 任务不存在');
    return reply.send(aiJobEnvelopeDto.parse({ job }));
  });

  app.post('/api/ai/jobs/:id/cancel', opts, async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await ai.cancelJob(currentUser(request).id, id);
    return reply.send(aiJobEnvelopeDto.parse({ job }));
  });
}
