import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyReply } from 'fastify';

/**
 * Serving the built SPA.
 *
 * Kept in its own module because both `app.ts` (the `/` route) and the not-found handler (client
 * side routes) need it, and a cycle between those two files would be fragile under ESM.
 */

/** Placeholder in apps/web/index.html that the server replaces with runtime configuration. */
export const RUNTIME_CONFIG_PLACEHOLDER = '<!--AIMARKDOWN_RUNTIME_CONFIG-->';

let cache: { path: string; mtimeMs: number; html: string } | null = null;

/**
 * Read index.html, re-reading only when the file changes on disk.
 *
 * A plain in-memory cache would serve stale asset hashes after a rebuild — the browser then
 * requests files that no longer exist and the SPA fallback answers with HTML, which fails module
 * MIME checking and produces a blank page. Production containers never rewrite the bundle, but
 * dev and zero-downtime image swaps both do.
 */
function readIndexHtml(indexPath: string): string {
  const mtimeMs = statSync(indexPath).mtimeMs;
  if (cache && cache.path === indexPath && cache.mtimeMs === mtimeMs) return cache.html;
  const html = readFileSync(indexPath, 'utf8');
  cache = { path: indexPath, mtimeMs, html };
  return html;
}

/**
 * Send the SPA shell with deployment-specific runtime config inlined.
 *
 * One bundle is served in several topologies — behind Caddy, straight from Fastify, and from
 * `file://` inside Electron — so anything that varies per deployment has to be injected at request
 * time rather than baked in at build time. The only such value today is the collaboration
 * WebSocket URL, which differs depending on whether a reverse proxy fronts `/collab`.
 */
export function sendIndexHtml(reply: FastifyReply, webDist: string, collabPublicUrl: string): FastifyReply {
  const html = readIndexHtml(join(webDist, 'index.html'));
  const script = collabPublicUrl
    ? `<script>window.__AIMARKDOWN_CONFIG__ = ${JSON.stringify({ collabUrl: collabPublicUrl })};</script>`
    : '';
  return reply
    .header('content-type', 'text/html; charset=utf-8')
    // The shell must never be cached, or a redeploy leaves clients pointing at stale asset hashes.
    .header('cache-control', 'no-cache')
    .send(html.replace(RUNTIME_CONFIG_PLACEHOLDER, script));
}

/** True when `webDist` actually contains a servable SPA. */
export function hasSpaBundle(webDist: string): boolean {
  return webDist.length > 0 && existsSync(join(webDist, 'index.html'));
}
