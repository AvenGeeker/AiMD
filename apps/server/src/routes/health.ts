import type { FastifyInstance } from 'fastify';
import { healthDto } from '@aimarkdown/shared';
import { ping } from '../db/client.js';
import type { CollabServer } from '../collab/server.js';

/** Liveness/readiness probe used by the deploy script and by container health checks. */
export function registerHealthRoutes(app: FastifyInstance, collab: () => CollabServer | null): void {
  app.get('/api/health', async (_request, reply) => {
    const ctx = app.ctx;
    const dbOk = await ping(ctx.dbHandle.sql);
    const collabInstance = collab();
    const collabOk = collabInstance ? collabInstance.isHealthy() : false;

    const body = healthDto.parse({
      status: dbOk && collabOk ? 'ok' : 'degraded',
      version: app.version ?? '0.1.0',
      uptimeSeconds: Math.round((Date.now() - ctx.startedAt) / 1000),
      db: dbOk ? 'ok' : 'error',
      collab: collabOk ? 'ok' : 'error',
    });
    // 503 when degraded so an orchestrator can see it, but still return the detail body.
    return reply.code(body.status === 'ok' ? 200 : 503).send(body);
  });
}
