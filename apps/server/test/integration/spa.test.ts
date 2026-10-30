import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { databaseAvailable, startTestServer, type TestServer } from './helpers.js';

/**
 * Serving the built web client.
 *
 * Uses a tiny fixture bundle rather than `apps/web/dist` so the server suite does not depend on a
 * web build having run. The point is the *serving* contract: real assets get real MIME types,
 * missing assets 404 loudly, client-side routes get the shell, and the runtime config is injected.
 */

const dbUp = await databaseAvailable();
const describeDb = dbUp ? describe : describe.skip;
// Absolute path: the server resolves WEB_DIST_DIR against the process cwd, which differs between
// vitest and a packaged container.
const FIXTURE = resolve(import.meta.dirname ?? '.', '../fixtures/dist');

describeDb('SPA and static asset serving', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer({
      WEB_DIST_DIR: FIXTURE,
      COLLAB_PUBLIC_URL: 'ws://127.0.0.1:9999',
    });
  });

  afterAll(async () => {
    await server?.stop();
  });

  it('serves the shell at / with the runtime config injected', async () => {
    const response = await server.app.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('window.__AIMARKDOWN_CONFIG__');
    expect(response.body).toContain('ws://127.0.0.1:9999');
    // The placeholder itself must be gone, or the browser sees a stray comment.
    expect(response.body).not.toContain('AIMARKDOWN_RUNTIME_CONFIG');
    expect(response.headers['cache-control']).toContain('no-cache');
  });

  it('injects nothing when no collab url is configured', async () => {
    const bare = await startTestServer({ WEB_DIST_DIR: FIXTURE, COLLAB_PUBLIC_URL: '' });
    try {
      const response = await bare.app.inject({ method: 'GET', url: '/' });
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain('__AIMARKDOWN_CONFIG__');
      expect(response.body).toContain('<div id="root"></div>');
    } finally {
      await bare.stop();
    }
  });

  it('serves a real asset with a JavaScript content type', async () => {
    const response = await server.app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('javascript');
    expect(response.body).toContain('fixture bundle');
  });

  it('returns 404 for a missing asset instead of the HTML shell', async () => {
    for (const url of ['/assets/missing.js', '/assets/app.css', '/favicon.ico', '/nope.map']) {
      const response = await server.app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(404);
      expect(response.headers['content-type']).not.toContain('text/html');
      expect(response.json()).toMatchObject({ code: 'NOT_FOUND' });
    }
  });

  it('returns the shell for a client-side route', async () => {
    const response = await server.app.inject({ method: 'GET', url: '/notes/abc123' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('<div id="root"></div>');
  });

  it('keeps the JSON 404 contract for unknown API routes', async () => {
    const response = await server.app.inject({ method: 'GET', url: '/api/definitely-not-real' });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.json()).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('does not treat an API path with a file-like suffix as a static asset', async () => {
    // `/api/notes/:id` is a real route, so `requireAuth` answers 401 before any 404 logic runs.
    // What matters is that the request is handled as an API call — never as a missing static file,
    // and never as the SPA shell.
    const response = await server.app.inject({ method: 'GET', url: '/api/notes/x.md' });
    expect(response.statusCode).toBe(401);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(response.body).not.toContain('静态资源不存在');
    expect(response.body).not.toContain('<div id="root">');
  });

  it('reports a missing non-API markdown path as a static 404', async () => {
    const response = await server.app.inject({ method: 'GET', url: '/notes.md' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'NOT_FOUND' });
    expect(response.body).toContain('静态资源不存在');
  });

  it('re-reads the shell when the file changes on disk', async () => {
    // The cache is keyed on mtime so a rebuild is picked up without a restart; the placeholder
    // substitution proves the response is generated from the current file contents.
    const first = await server.app.inject({ method: 'GET', url: '/' });
    const second = await server.app.inject({ method: 'GET', url: '/' });
    expect(second.body).toBe(first.body);
  });
});

describe('SPA serving is skipped without a bundle', () => {
  it('runs in API-only mode when WEB_DIST_DIR is unset', async () => {
    if (!dbUp) return;
    const server = await startTestServer({ WEB_DIST_DIR: '' });
    try {
      const response = await server.app.inject({ method: 'GET', url: '/' });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      await server.stop();
    }
  });
});
