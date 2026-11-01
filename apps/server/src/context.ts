import type { Hocuspocus } from '@hocuspocus/server';
import type { ServerConfig } from './config.js';
import type { DbHandle } from './db/client.js';
import type { TokenVerifier } from './auth/tokens.js';
import type { AttachmentStorage } from './services/storage.js';
import type { AiService } from './ai/service.js';

/** Everything a request handler or collaboration hook needs, injected rather than global. */
export interface ServerContext {
  config: ServerConfig;
  dbHandle: DbHandle;
  verifier: TokenVerifier;
  storage: AttachmentStorage;
  /** Set once the collaboration server has been created; REST handlers use it for writes. */
  collab: Hocuspocus | null;
  /** Server-owned AI worker. Created before the collab server so note-store callbacks can use it. */
  ai: AiService | null;
  startedAt: number;
}

export function createServerContext(parts: {
  config: ServerConfig;
  dbHandle: DbHandle;
  verifier: TokenVerifier;
  storage: AttachmentStorage;
}): ServerContext {
  return { ...parts, collab: null, ai: null, startedAt: Date.now() };
}

export interface AuthUser {
  id: string;
  email: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    ctx: ServerContext;
    user?: AuthUser;
  }
  interface FastifyInstance {
    ctx: ServerContext;
  }
}
