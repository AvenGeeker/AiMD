import { APP_NAME } from '@aimarkdown/shared';
import { loadConfig } from './config.js';
import { createServerContext } from './context.js';
import { createDb, ping } from './db/client.js';
import { migrate } from './db/migrate.js';
import { TokenVerifier } from './auth/tokens.js';
import { createLocalStorage } from './services/storage.js';
import { createCollabServer, type CollabServer } from './collab/server.js';
import { buildApp, bootstrapAdmin } from './app.js';
import { createConsoleLogger } from './utils/logger.js';
import { createAiService } from './ai/service.js';

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
  let collab: CollabServer | null = null;
  const ai = createAiService({
    sql: dbHandle.sql,
    config,
    log,
    getHocuspocus: () => collab?.hocuspocus ?? null,
  });
  collab = createCollabServer({
    config,
    sql: dbHandle.sql,
    verifier,
    log,
    onNoteStored: (event) => ai.noteStored(event),
  });
  const collabServer = collab;
  ctx.ai = ai;

  const app = await buildApp({ ctx, log, collab: () => collabServer });

  await collabServer.start();
  // `buildApp` closes over `collab` lazily, so route handlers see the instance from here on.
  ctx.collab = collabServer.hocuspocus;
  await ai.start();

  await bootstrapAdmin(ctx, log);

  await app.listen({ host: config.HOST, port: config.REST_PORT });
  log.info(
    { rest: config.REST_PORT, collab: config.COLLAB_PORT, env: config.NODE_ENV },
    `${APP_NAME} server ready`,
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

    await ctx.ai?.stop().catch((error) => {
      log.error({ err: error }, 'error stopping AI worker');
    });

    const report = await collabServer.stop();
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

/**
 * Turn the failure modes that actually happen on a first run into something readable.
 *
 * A raw Node stack trace for `EADDRINUSE` tells a new operator nothing about which of the two
 * ports this process owns is taken, or what to do about it.
 */
function reportStartupFailure(error: unknown): never {
  // `listen` failures carry `port`/`address`, which are not on the base ErrnoException type.
  const err = error as NodeJS.ErrnoException & {
    code?: string;
    port?: number | string;
    address?: string;
  };

  if (err?.code === 'EADDRINUSE') {
    const address = typeof err.address === 'string' ? err.address : '';
    const port = err.port ?? (address ? '' : '');
    console.error(
      `[${APP_NAME}] 端口 ${port ?? '(未知)'} 已被占用，无法启动。\n` +
        `  查看占用者：lsof -nP -iTCP:${port} -sTCP:LISTEN\n` +
        `  本服务使用两个端口：REST_PORT（默认 3000）与 COLLAB_PORT（默认 1234）。\n` +
        `  用环境变量改掉其中之一即可，例如：COLLAB_PORT=1235 node dist/index.js`,
    );
    process.exit(1);
  }

  if (err?.name === 'ConfigError') {
    console.error(`[${APP_NAME}] 配置有误：\n${err.message}`);
    process.exit(1);
  }

  if (/not reachable|ECONNREFUSED|getaddrinfo/i.test(err?.message ?? '')) {
    console.error(
      `[${APP_NAME}] ${err.message}\n` +
        '  本地开发请先启动数据库：make db-up\n' +
        '  并确认 DATABASE_URL 指向正确的地址与凭据。',
    );
    process.exit(1);
  }

  console.error(`[${APP_NAME}] failed to start:`, error);
  process.exit(1);
}

/**
 * A port clash surfaces as an `'error'` event on the underlying net server (Hocuspocus owns its
 * own http.Server), so it never reaches `main().catch` — without this handler Node prints a raw
 * stack trace and exits. Anything uncaught is fatal either way; we only make the common case
 * readable rather than pretending the process can recover.
 */
process.on('uncaughtException', (error) => {
  reportStartupFailure(error);
});

main().catch(reportStartupFailure);

export type { CollabServer };
