import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createServerContext } from '../../src/context.js';
import { createDb, ping, type DbHandle } from '../../src/db/client.js';
import { migrate } from '../../src/db/migrate.js';
import { TokenVerifier } from '../../src/auth/tokens.js';
import { createMemoryStorage } from '../../src/services/storage.js';
import { createCollabServer, type CollabServer } from '../../src/collab/server.js';
import { createConsoleLogger, silentLogger } from '../../src/utils/logger.js';
import type { ServerConfig } from '../../src/config.js';
import { loadConfig } from '../../src/config.js';
import { BEARER_TRANSPORT, TOKEN_TRANSPORT_HEADER, type BearerSessionDto } from '@aimarkdown/shared';

/**
 * Integration harness: a real Postgres, a real Hocuspocus server and a real Fastify app.
 *
 * The suite self-skips when the test database is unreachable so `pnpm test` still works on a
 * machine without Docker; CI provisions the database as a service.
 */

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://aimarkdown:aimarkdown_test@127.0.0.1:5434/aimarkdown_test';

const BASE_ENV = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  // 0 => ask the OS for an ephemeral port so parallel files never clash.
  REST_PORT: '0',
  COLLAB_PORT: '0',
  DATABASE_URL: TEST_DATABASE_URL,
  JWT_SECRET: 'integration-test-secret-0123456789abcdef0123456789',
  ALLOW_REGISTRATION: 'true',
  UPLOAD_DIR: './data/test-uploads',
  LOG_LEVEL: 'silent',
  SHUTDOWN_TIMEOUT_MS: '5000',
  COLLAB_DEBOUNCE: '200',
  COLLAB_MAX_DEBOUNCE: '1000',
  // Tests register many accounts from 127.0.0.1; the production budget would throttle them.
  AUTH_RATE_LIMIT_MAX: '100000',
  API_RATE_LIMIT_MAX: '100000',
};

export function testConfig(overrides: Record<string, string> = {}): ServerConfig {
  return loadConfig({ ...BASE_ENV, ...overrides } as NodeJS.ProcessEnv);
}

import { TABLES } from '../../src/db/schema.js';

export async function truncateAll(handle: DbHandle): Promise<void> {
  // Order matters only for readability; CASCADE avoids FK complaints.
  await handle.sql.unsafe(`truncate table ${TABLES.join(', ')} restart identity cascade`);
}

export interface TestServer {
  app: FastifyInstance;
  collab: CollabServer;
  handle: DbHandle;
  config: ServerConfig;
  verifier: TokenVerifier;
  /** Actual OS-assigned collaboration port (the config value is 0). */
  collabPort(): number;
  stop(): Promise<void>;
}

export async function startTestServer(
  overrides: Record<string, string> = {},
): Promise<TestServer> {
  const config = testConfig(overrides);
  const handle = createDb({ databaseUrl: config.DATABASE_URL, max: 5 });
  if (!(await ping(handle.sql))) {
    throw new Error(`test database unreachable at ${config.DATABASE_URL}`);
  }
  await migrate(handle.sql);
  await truncateAll(handle);

  const log = createConsoleLogger('silent');
  const verifier = new TokenVerifier(config.JWT_SECRET);
  const storage = createMemoryStorage();
  const ctx = createServerContext({ config, dbHandle: handle, verifier, storage });
  const collab = createCollabServer({ config, sql: handle.sql, verifier, log });
  const app = await buildApp({ ctx, log, collab: () => collab });

  await collab.start();
  ctx.collab = collab.hocuspocus;
  await app.ready();

  return {
    app,
    collab,
    handle,
    config,
    verifier,
    collabPort: () => collab.server.address.port,
    async stop() {
      await app.close();
      await collab.stop();
      await handle.close();
    },
  };
}

/** Skip the whole file when Docker/Postgres is not available. */
export async function databaseAvailable(): Promise<boolean> {
  const handle = createDb({ databaseUrl: TEST_DATABASE_URL, max: 1, connectTimeout: 3 });
  const ok = await ping(handle.sql);
  await handle.close().catch(() => undefined);
  return ok;
}

/* ------------------------------- auth helpers ------------------------------ */

export interface AuthedClient {
  userId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  header: { authorization: string };
}

let emailCounter = 0;
export function uniqueEmail(prefix = 'user'): string {
  emailCounter += 1;
  return `${prefix}-${Date.now()}-${emailCounter}@example.com`;
}

/**
 * Register and return a bearer-style client.
 *
 * Tests opt into `X-Token-Transport: bearer` exactly like the Electron client does, so the
 * refresh token is present in the body and token lifecycle can be asserted.
 */
export async function register(
  server: TestServer,
  email = uniqueEmail(),
  password = 'password123',
): Promise<AuthedClient> {
  const response = await server.app.inject({
    method: 'POST',
    url: '/api/auth/register',
    headers: { [TOKEN_TRANSPORT_HEADER]: BEARER_TRANSPORT },
    payload: { email, password, displayName: 'Tester' },
  });
  if (response.statusCode !== 201) {
    throw new Error(`register failed (${response.statusCode}): ${response.body}`);
  }
  const body = response.json() as BearerSessionDto;
  return {
    userId: body.user.id,
    email: body.user.email,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    header: { authorization: `Bearer ${body.accessToken}` },
  };
}

/** Log in as an existing user, returning a bearer-style client. */
export async function login(
  server: TestServer,
  email: string,
  password = 'password123',
): Promise<AuthedClient> {
  const response = await server.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { [TOKEN_TRANSPORT_HEADER]: BEARER_TRANSPORT },
    payload: { email, password },
  });
  if (response.statusCode !== 200) {
    throw new Error(`login failed (${response.statusCode}): ${response.body}`);
  }
  const body = response.json() as BearerSessionDto;
  return {
    userId: body.user.id,
    email: body.user.email,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    header: { authorization: `Bearer ${body.accessToken}` },
  };
}

export async function api<T = unknown>(
  server: TestServer,
  client: AuthedClient,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
): Promise<{ status: number; body: T }> {
  const response = await server.app.inject({
    method,
    url,
    headers: client.header,
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  let body: T;
  try {
    body = response.json() as T;
  } catch {
    body = response.body as unknown as T;
  }
  return { status: response.statusCode, body };
}

export { silentLogger, beforeAll, afterAll };
