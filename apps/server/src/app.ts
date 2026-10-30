import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { MAX_ATTACHMENT_BYTES } from '@aimarkdown/shared';
import type { ServerContext } from './context.js';
import { corsOriginList } from './config.js';
import { registerErrorHandler, registerNotFoundHandler } from './plugins/error-handler.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerNoteRoutes } from './routes/notes.js';
import { registerTreeRoutes } from './routes/tree.js';
import { registerAttachmentRoutes } from './routes/attachments.js';
import { registerVaultRoutes } from './routes/vault.js';
import { registerHealthRoutes } from './routes/health.js';
import { ensureBootstrapAdmin, type UsersDeps } from './services/users.js';
import { DEFAULT_TTLS } from './auth/tokens.js';
import type { NotesDeps } from './services/notes.js';
import type { WorkspaceDeps } from './services/workspace.js';
import type { CollabServer } from './collab/server.js';
import type { Logger } from './utils/logger.js';

export interface BuildAppOptions {
  ctx: ServerContext;
  log: Logger;
  collab: () => CollabServer | null;
}

/** Assemble the Fastify application. Kept separate from `index.ts` so tests can build it inline. */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { ctx, log, collab } = options;
  const { config } = ctx;

  const app = Fastify({
    // Our own structured logger is used instead of pino so boot logs (before Fastify exists)
    // and request logs share one format.
    // pino is off: boot happens before Fastify exists, so a single console logger is used for
    // the whole process and request logging adds no value here.
    logger: false,
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });

  app.decorate('ctx', ctx);
  app.addHook('onRequest', async (request) => {
    request.ctx = ctx;
  });

  await app.register(helmet, {
    // CSP is left off in v1: the SPA injects styles at runtime and previews render KaTeX/MathML.
    // DOMPurify is the actual XSS boundary for note content. Enabling a strict CSP is a
    // documented hardening follow-up rather than something to half-do here.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    // Attachments must load in the Vite dev server (different origin) as well as in production.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  await app.register(cors, {
    origin: corsOriginList(config),
    credentials: true,
    exposedHeaders: ['content-disposition'],
  });

  await app.register(cookie);

  await app.register(rateLimit, {
    global: true,
    max: config.API_RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    // `trustProxy: true` above means the limiter keys on the real client IP, not Caddy's.
    errorResponseBuilder: (_request, context) => ({
      code: 'RATE_LIMITED',
      message: '请求过于频繁，请稍后再试',
      details: { retryAfterSeconds: Math.ceil(context.ttl / 1000) },
    }),
  });

  await app.register(multipart, {
    limits: {
      fileSize: MAX_ATTACHMENT_BYTES,
      files: 200,
      fields: 20,
    },
  });

  registerErrorHandler(app);

  const usersDeps: UsersDeps = {
    sql: ctx.dbHandle.sql,
    verifier: ctx.verifier,
    log,
    allowRegistration: config.ALLOW_REGISTRATION,
    // Honour the env overrides; these exist mainly so tests can force token expiry.
    ttls: {
      accessSeconds: config.ACCESS_TOKEN_TTL_SECONDS ?? DEFAULT_TTLS.accessSeconds,
      refreshSeconds: config.REFRESH_TOKEN_TTL_SECONDS ?? DEFAULT_TTLS.refreshSeconds,
    },
  };
  const notesDeps: NotesDeps = {
    sql: ctx.dbHandle.sql,
    log,
    getHocuspocus: () => collab()?.hocuspocus ?? null,
  };
  const workspaceDeps: WorkspaceDeps = {
    sql: ctx.dbHandle.sql,
    log,
    getHocuspocus: () => collab()?.hocuspocus ?? null,
  };

  registerHealthRoutes(app, collab);
  registerAuthRoutes(app, usersDeps);
  registerNoteRoutes(app, notesDeps, workspaceDeps);
  registerTreeRoutes(app, workspaceDeps);
  registerAttachmentRoutes(app, {
    sql: ctx.dbHandle.sql,
    storage: ctx.storage,
    publicUrl: config.PUBLIC_URL,
  });
  registerVaultRoutes(app, {
    sql: ctx.dbHandle.sql,
    log,
    notes: notesDeps,
    workspace: workspaceDeps,
  });

  // Per-route rate limits for the credential endpoints live in routes/auth.ts.

  // Serve the built web client when a bundle is present (production single-container mode).
  const webDist = config.WEB_DIST_DIR ? resolve(config.WEB_DIST_DIR) : '';
  const serveSpa = Boolean(webDist) && existsSync(webDist);
  if (serveSpa) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/', wildcard: false });
    log.info({ webDist }, 'serving web client');
  } else if (webDist) {
    log.warn({ webDist }, 'WEB_DIST_DIR is set but the directory does not exist; API-only mode');
  }

  // Exactly one not-found handler: it owns both the API 404 contract and the SPA fallback.
  registerNotFoundHandler(app, { spa: serveSpa });

  return app;
}

/** Create the admin account from deploy-time env vars, if configured. */
export async function bootstrapAdmin(ctx: ServerContext, log: Logger): Promise<void> {
  await ensureBootstrapAdmin(
    {
      sql: ctx.dbHandle.sql,
      verifier: ctx.verifier,
      log,
      allowRegistration: true,
    },
    ctx.config.BOOTSTRAP_ADMIN_EMAIL,
    ctx.config.BOOTSTRAP_ADMIN_PASSWORD,
  );
}
