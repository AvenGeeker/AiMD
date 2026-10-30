import { loadConfig } from './config.js';
import { createServerContext } from './context.js';
import { createDb, ping } from './db/client.js';
import { migrate } from './db/migrate.js';
import { TokenVerifier } from './auth/tokens.js';
import { createLocalStorage } from './services/storage.js';
import { createCollabServer, type CollabServer } from './collab/server.js';
import { buildApp, bootstrapAdmin } from './app.js';
import { createConsoleLogger } from './utils/logger.js';

/**
 * Process entrypoint.
 *
 * Boot order matters: config → database → migrations → collaboration server → HTTP server.
 * Migrations run before anything serves traffic so `docker compose up` needs no manual step,
 * and the collaboration server starts before Fastify so `/api/health` never reports a healthy
 * REST tier on top of a dead WebSocket tier.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const log = createConsoleLogger(config.NODE_ENV === 'test' ? 'error' : config.LOG_LEVEL === 'silent' ? 'silent' : 'info');

  const dbHandle = createDb({ databaseUrl: config.DATABASE_URL });

  if (!(await ping(dbHandle.sql))) {
    throw new Error('Database is not reachable at the configured DATABASE_URL');
  }
  const migrationResult = await migrate(dbHandle.sql, config.MIGRATIONS_DIR);
  if (migrationResult.applied.length > 0) {
    log.info({ applied: migrationResult.applied }, 'applied migrations');
  }

  const storage = createLocalStorage(config.UPLOAD_DIR);
  await storage.init();

  const verifier = new TokenVerifier(config.JWT_SECRET);
  const ctx = createServerContext({ config, dbHandle, verifier, storage });
  const collab = createCollabServer({ config, sql: dbHandle.sql, verifier, log });

  const app = await buildApp({ ctx, log, collab: () => collab });

  await collab.start();
  // `buildApp` closes over `collab` lazily, so route handlers see the instance from here on.
  ctx.collab = collab.hocuspocus;

  await bootstrapAdmin(ctx, log);

  await app.listen({ host: config.HOST, port: config.REST_PORT });
  log.info(
    { rest: config.REST_PORT, collab: config.COLLAB_PORT, env: config.NODE_ENV },
    'aiMarkdown server ready',
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'shutting down');

    // Stop accepting work first, then flush in-memory CRDT state, then close the database.
    // Reversing this order is how a container restart loses the last few seconds of typing.
    try {
      await app.close();
    } catch (error) {
      log.error({ err: error }, 'error closing HTTP server');
    }

    const report = await collab.stop();
    if (!report.drained) {
      log.warn({ pendingDocuments: report.pendingDocuments }, 'some documents were not flushed before timeout');
    }

    try {
      await dbHandle.close();
    } catch (error) {
      log.error({ err: error }, 'error closing database pool');
    }

    process.exit(report.drained ? 0 : 1);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    log.error({ err: reason }, 'unhandled rejection');
  });

}

main().catch((error) => {
  console.error('[aiMarkdown] failed to start:', error);
  process.exit(1);
});

export type { CollabServer };
