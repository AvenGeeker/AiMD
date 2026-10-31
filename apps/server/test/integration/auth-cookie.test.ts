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
});
