import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiError, ACCESS_COOKIE, ERROR_CODES } from '@aimarkdown/shared';
import type { AuthUser } from '../context.js';

/** Pull the access token from the Authorization header first, then the httpOnly cookie. */
export function extractAccessToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    const token = header.slice(7).trim();
    if (token.length > 0) return token;
  }
  const cookie = request.cookies?.[ACCESS_COOKIE];
  return typeof cookie === 'string' && cookie.length > 0 ? cookie : null;
}

/**
 * Reject unauthenticated requests.
 *
 * An expired token is reported as `TOKEN_EXPIRED` rather than `UNAUTHENTICATED` so browser
 * clients know to call `/auth/refresh` instead of forcing a re-login.
 */
export async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const ctx = request.ctx ?? request.server.ctx;
  const token = extractAccessToken(request);
  if (!token) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, '未登录');

  const claims = await ctx.verifier.verifyAccessToken(token);
  if (claims) {
    const user: AuthUser = { id: claims.sub, email: claims.email };
    request.user = user;
    return;
  }

  const expired = await ctx.verifier.inspectExpired(token);
  throw new ApiError(
    expired ? ERROR_CODES.TOKEN_EXPIRED : ERROR_CODES.UNAUTHENTICATED,
    expired ? '登录已过期' : '登录状态无效',
  );
}

/** Attach `request.user` when a valid token is present, but never reject. */
export async function optionalAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const ctx = request.ctx ?? request.server.ctx;
  const token = extractAccessToken(request);
  if (!token) return;
  const claims = await ctx.verifier.verifyAccessToken(token);
  if (claims) request.user = { id: claims.sub, email: claims.email };
}

/** Narrow `request.user` after `requireAuth` has run, without repeating null checks. */
export function currentUser(request: FastifyRequest): AuthUser {
  if (!request.user) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, '未登录');
  return request.user;
}
