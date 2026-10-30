import type { onAuthenticatePayload } from '@hocuspocus/server';
import type { Sql } from 'postgres';
import { ApiError, ERROR_CODES, canAccessWorkspaceDoc, parseDocName } from '@aimarkdown/shared';
import type { TokenVerifier } from '../auth/tokens.js';
import type { Logger } from '../utils/logger.js';

/**
 * Collaboration authorisation.
 *
 * Every WebSocket connection must present a valid access token, and the token's subject must
 * own the document being opened. Document names are parsed with the shared strict parser, so a
 * crafted name (`note-../../other`, `workspace-<someone else>`) can never alias another
 * tenant's state.
 */

export interface CollabContext {
  userId: string;
  email: string;
}

export interface AuthorizeDeps {
  verifier: TokenVerifier;
  sql: Sql;
  log: Logger;
}

/**
 * The context Hocuspocus threads through every hook for an authenticated connection. It starts
 * empty and is filled in by `onAuthenticate`, then surfaces as `lastContext` in the store hook.
 */
export type AuthenticatePayload = onAuthenticatePayload<Partial<CollabContext>>;

export function createAuthorizer(deps: AuthorizeDeps) {
  const { verifier, sql, log } = deps;

  return async function onAuthenticate(payload: AuthenticatePayload): Promise<CollabContext> {
    const { token, documentName } = payload;

    const claims = await verifier.verifyAccessToken(token);
    if (!claims) {
      const expired = token ? await verifier.inspectExpired(token) : false;
      log.warn({ documentName, expired }, 'collab auth rejected: bad or expired token');
      throw new ApiError(
        expired ? ERROR_CODES.TOKEN_EXPIRED : ERROR_CODES.UNAUTHENTICATED,
        expired ? '登录已过期' : '未授权',
      );
    }

    const parsed = parseDocName(documentName);
    if (parsed.kind === 'unknown' || !parsed.id) {
      log.warn({ documentName, userId: claims.sub }, 'collab auth rejected: malformed document name');
      throw new ApiError(ERROR_CODES.BAD_REQUEST, '非法的文档名');
    }

    if (parsed.kind === 'workspace') {
      if (!canAccessWorkspaceDoc(documentName, claims.sub)) {
        log.warn({ documentName, userId: claims.sub }, 'collab auth rejected: foreign workspace');
        throw new ApiError(ERROR_CODES.FORBIDDEN, '无权访问该工作区');
      }
    } else {
      const rows = await sql`select owner_id from notes where id = ${parsed.id}`;
      const ownerId = rows[0]?.owner_id;
      if (typeof ownerId !== 'string') {
        throw new ApiError(ERROR_CODES.NOT_FOUND, '笔记不存在');
      }
      if (ownerId !== claims.sub) {
        log.warn({ documentName, userId: claims.sub }, 'collab auth rejected: foreign note');
        throw new ApiError(ERROR_CODES.FORBIDDEN, '无权访问该笔记');
      }
    }

    const context: CollabContext = { userId: claims.sub, email: claims.email };
    // Hocuspocus merges the returned object into the per-connection context; mutate the
    // incoming context too so extensions that read `payload.context` see the same values.
    if (payload.context && typeof payload.context === 'object') {
      Object.assign(payload.context, context);
    }
    return context;
  };
}
