import type { FastifyInstance, FastifyReply } from 'fastify';
import type { FastifyRequest } from 'fastify';
import {
  ACCESS_COOKIE,
  ACCESS_TOKEN_TTL_SECONDS,
  ApiError,
  BEARER_TRANSPORT,
  ERROR_CODES,
  REFRESH_COOKIE,
  TOKEN_TRANSPORT_HEADER,
  authSessionDto,
  bearerSessionDto,
  loginInput,
  registerInput,
  userDto,
  type AuthSessionDto,
  type BearerSessionDto,
} from '@aimarkdown/shared';
import type { Session } from '../services/users.js';
import { currentUser, requireAuth } from '../plugins/auth.js';
import { parse } from '../utils/validate.js';
import {
  findUserById,
  loginUser,
  refreshSession,
  registerUser,
  revokeAllSessions,
  revokeRefreshToken,
  toUserDto,
  type UsersDeps,
} from '../services/users.js';

/**
 * Auth routes.
 *
 * Tokens travel two ways so the browser and the Electron shell can share one API: the browser
 * uses httpOnly cookies (no XSS-reachable storage), while the desktop client sends
 * `Authorization: Bearer` and keeps the refresh token in the OS keychain via `safeStorage`.
 * `/auth/refresh` accepts either transport.
 */

function readRefreshFromBody(body: unknown): string | null {
  if (body && typeof body === 'object') {
    const value = (body as Record<string, unknown>).refreshToken;
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

/**
 * Does this client want the refresh token in the response body?
 *
 * Browsers must not: it would be readable by any script on the page, defeating the point of an
 * httpOnly cookie. The Electron shell opts in because it has no cookie jar and stores the token
 * in the OS keychain instead.
 */
function wantsBearerTransport(request: FastifyRequest): boolean {
  const header = request.headers[TOKEN_TRANSPORT_HEADER];
  return typeof header === 'string' && header.trim().toLowerCase() === BEARER_TRANSPORT;
}

function sessionPayload(
  request: FastifyRequest,
  reply: FastifyReply,
  session: Session,
  secure: boolean,
): AuthSessionDto | BearerSessionDto {
  if (wantsBearerTransport(request)) {
    // No cookies: the desktop client manages its own token storage.
    return bearerSessionDto.parse(session);
  }
  setSessionCookies(reply, session.accessToken, session.refreshToken, session.refreshExpiresIn, secure);
  return authSessionDto.parse(session);
}

function setSessionCookies(
  reply: FastifyReply,
  accessToken: string,
  refreshToken: string,
  refreshExpiresIn: number,
  secure: boolean,
): void {
  reply
    .setCookie(ACCESS_COOKIE, accessToken, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: ACCESS_TOKEN_TTL_SECONDS,
    })
    .setCookie(REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: refreshExpiresIn,
    });
}

function clearSessionCookies(reply: FastifyReply, secure: boolean): void {
  reply
    .clearCookie(ACCESS_COOKIE, { path: '/', httpOnly: true, secure, sameSite: 'lax' })
    .clearCookie(REFRESH_COOKIE, { path: '/api/auth', httpOnly: true, secure, sameSite: 'lax' });
}

export function registerAuthRoutes(app: FastifyInstance, deps: UsersDeps): void {
  // The Secure flag follows the request scheme, not NODE_ENV. Caddy terminates TLS and
  // forwards X-Forwarded-Proto (trustProxy is on), so `request.protocol === 'https'` is true over HTTPS
  // and false over the plain-HTTP, direct-IP deployment mode. A hardcoded `production`
  // would stamp Secure cookies on http:// deployments, which browsers refuse to send back.

  /**
   * Credential endpoints get a far tighter budget than the rest of the API to blunt password
   * guessing, while normal traffic stays at the global limit.
   */
  const AUTH_RATE_LIMIT = {
    config: { rateLimit: { max: app.ctx.config.AUTH_RATE_LIMIT_MAX, timeWindow: '1 minute' } },
  };

  app.post('/api/auth/register', AUTH_RATE_LIMIT, async (request, reply) => {
    const input = parse(registerInput, request.body, '注册信息');
    const session = await registerUser(deps, input);
    return reply.code(201).send(sessionPayload(request, reply, session, request.protocol === 'https'));
  });

  app.post('/api/auth/login', AUTH_RATE_LIMIT, async (request, reply) => {
    const input = parse(loginInput, request.body, '登录信息');
    const session = await loginUser(deps, { ...input });
    return reply.send(sessionPayload(request, reply, session, request.protocol === 'https'));
  });

  app.post('/api/auth/refresh', AUTH_RATE_LIMIT, async (request, reply) => {
    const raw = readRefreshFromBody(request.body) ?? request.cookies?.[REFRESH_COOKIE] ?? null;
    if (!raw) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, '缺少刷新令牌');
    const session = await refreshSession(deps, raw, request.headers['user-agent']);
    return reply.send(sessionPayload(request, reply, session, request.protocol === 'https'));
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const raw = readRefreshFromBody(request.body) ?? request.cookies?.[REFRESH_COOKIE] ?? null;
    await revokeRefreshToken(deps, raw);
    clearSessionCookies(reply, request.protocol === 'https');
    return reply.send({ ok: true });
  });

  app.get('/api/me', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = await findUserById(deps.sql, currentUser(request).id);
    if (!user) throw new ApiError(ERROR_CODES.NOT_FOUND, '用户不存在');
    return reply.send({ user: userDto.parse(toUserDto(user)) });
  });

  app.delete('/api/me/sessions', { preHandler: [requireAuth] }, async (request, reply) => {
    await revokeAllSessions(deps, currentUser(request).id);
    clearSessionCookies(reply, request.protocol === 'https');
    return reply.send({ ok: true });
  });
}
