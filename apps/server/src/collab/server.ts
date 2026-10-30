import { Server, type Hocuspocus } from '@hocuspocus/server';
import type { Sql } from 'postgres';
import type { ServerConfig } from '../config.js';
import type { TokenVerifier } from '../auth/tokens.js';
import type { Logger } from '../utils/logger.js';
import { createAuthorizer, type CollabContext } from './authorize.js';
import { createCollabPersistence } from './persistence.js';

/**
 * The collaboration server.
 *
 * It runs in the same Node process as the REST API but listens on its own port, so the reverse
 * proxy can route `/collab` here and `/api` + static assets to Fastify. Hocuspocus ignores the
 * request path, so stripping the `/collab` prefix at the proxy is sufficient.
 */

export interface CollabServerDeps {
  config: ServerConfig;
  sql: Sql;
  verifier: TokenVerifier;
  log: Logger;
}

export interface StopReport {
  /** True when every in-memory document was persisted before shutdown completed. */
  drained: boolean;
  /** Documents still in memory when the shutdown budget ran out. */
  pendingDocuments: number;
}

export interface CollabServer {
  server: Server<Partial<CollabContext>>;
  hocuspocus: Hocuspocus<Partial<CollabContext>>;
  start(): Promise<void>;
  stop(): Promise<StopReport>;
  isHealthy(): boolean;
  documentCount(): number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createCollabServer(deps: CollabServerDeps): CollabServer {
  const { config, sql, verifier, log } = deps;
  let hocuspocus: Hocuspocus<Partial<CollabContext>> | null = null;
  let listening = false;

  const server = new Server<Partial<CollabContext>>({
    port: config.COLLAB_PORT,
    address: config.HOST,
    // We own the shutdown sequence: pending CRDT stores must be flushed *before* the process
    // exits, otherwise a Docker restart inside the debounce window loses writes.
    stopOnSignals: false,
    debounce: config.COLLAB_DEBOUNCE,
    maxDebounce: config.COLLAB_MAX_DEBOUNCE,
    timeout: config.COLLAB_TIMEOUT,
    // Keep documents warm between edits so repeated open/close does not thrash the store hook.
    unloadImmediately: false,
    websocketOptions: { maxPayload: config.COLLAB_MAX_PAYLOAD_BYTES },
    onAuthenticate: createAuthorizer({ verifier, sql, log }),
    extensions: [createCollabPersistence({ sql, log })],
  });

  return {
    server,
    get hocuspocus() {
      if (!hocuspocus) throw new Error('collaboration server has not been started');
      return hocuspocus;
    },

    async start() {
      hocuspocus = await server.listen(config.COLLAB_PORT);
      listening = true;
      log.info({ port: config.COLLAB_PORT }, 'collaboration server listening');
    },

    async stop(): Promise<StopReport> {
      if (!hocuspocus) return { drained: true, pendingDocuments: 0 };

      // 1. Stop serving clients. A document that still has a connection is never unloaded, so
      //    closing connections first is a precondition for the drain below to complete.
      listening = false;
      try {
        hocuspocus.closeConnections();
      } catch (error) {
        log.error({ err: error }, 'closeConnections failed during shutdown');
      }

      // 2. Persist everything the debouncer is still holding.
      try {
        hocuspocus.flushPendingStores();
      } catch (error) {
        log.error({ err: error }, 'flushPendingStores failed during shutdown');
      }

      // 3. Give the stores time to land, bounded by SHUTDOWN_TIMEOUT_MS.
      const deadline = Date.now() + config.SHUTDOWN_TIMEOUT_MS;
      while (hocuspocus.getDocumentsCount() > 0 && Date.now() < deadline) {
        // Re-flush: a store can be re-armed by the unload path while we wait.
        hocuspocus.flushPendingStores();
        await sleep(100);
      }
      const pendingDocuments = hocuspocus.getDocumentsCount();
      if (pendingDocuments > 0) {
        log.warn({ pendingDocuments }, 'shutdown with documents still in memory');
      }

      // 4. Close the WebSocket/HTTP listener.
      try {
        await server.destroy();
      } catch (error) {
        log.error({ err: error }, 'collab server destroy failed');
      }
      hocuspocus = null;
      return { drained: pendingDocuments === 0, pendingDocuments };
    },

    isHealthy() {
      return listening && hocuspocus !== null;
    },

    documentCount() {
      return hocuspocus ? hocuspocus.getDocumentsCount() : 0;
    },
  };
}
