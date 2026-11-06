import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAvailable, startTestServer, uniqueEmail, type TestServer } from './helpers.js';

const dbUp = await databaseAvailable();
const describeDb = dbUp ? describe : describe.skip;

/** Flatten light-my-request's potentially-array set-cookie header for substring matching. */
function setCookieHeader(headers: Record<string, unknown>): string {
  const raw = headers['set-cookie'];
  if (Array.isArray(raw)) return raw.join('; ');
  return raw == null ? '' : String(raw);
}

describeDb('auth cookie Secure flag follows the request scheme', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server?.stop();
  });

  it('stamps non-Secure cookies over plain HTTP (direct-IP, plain-HTTP deployment mode)', async () => {
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: uniqueEmail('cookie-http'), password: 'password123' },
    });
    expect(response.statusCode).toBe(201);
    // A Secure cookie over http:// is never sent back by the browser, which would break login
    // in the no-domain direct-IP mode — so the flag must follow the request scheme instead of NODE_ENV.
    expect(setCookieHeader(response.headers)).not.toContain('Secure');
  });

  it('returns a serialisable current-user DTO for a bearer session', async () => {
    const email = uniqueEmail('bearer-me');
    const registered = await server.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: { 'x-token-transport': 'bearer' },
      payload: { email, password: 'password123' },
    });
    expect(registered.statusCode).toBe(201);
    const session = registered.json() as { accessToken: string };

    const me = await server.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${session.accessToken}` },
    });

    expect(me.statusCode).toBe(200);
    const body = me.json() as { user: { email: string; createdAt: unknown } };
    expect(body.user.email).toBe(email);
    expect(typeof body.user.createdAt).toBe('string');
  });

  it('stamps Secure cookies when Caddy forwards X-Forwarded-Proto: https', async () => {
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: { 'x-forwarded-proto': 'https' },
      payload: { email: uniqueEmail('cookie-https'), password: 'password123' },
    });
    expect(response.statusCode).toBe(201);
    expect(setCookieHeader(response.headers)).toContain('Secure');
  });

  it('extends the refresh cookie for a remembered device', async () => {
    const email = uniqueEmail('cookie-remember');
    await server.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email, password: 'password123' },
    });
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'password123', rememberMe: true },
    });
    expect(response.statusCode).toBe(200);
    const cookies = setCookieHeader(response.headers);
    expect(cookies).toContain('amd_rt=');
    expect(cookies).toContain('Max-Age=31536000');
  });
});
