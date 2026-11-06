import type { FastifyError, FastifyInstance } from 'fastify';
import { ApiError, ERROR_CODES, toApiErrorBody } from '@aimarkdown/shared';
import { sendIndexHtml } from './spa.js';

/**
 * Single error funnel.
 *
 * Every failure leaves the server as `{ code, message, details? }` with the status mapped by
 * `ERROR_STATUS`, so clients can branch on a stable code instead of parsing prose. Internal
 * stack traces are logged but never returned.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const ctx = request.ctx ?? app.ctx;

    // Fastify's own validation/body errors.
    if (error.validation) {
      const body = new ApiError(ERROR_CODES.VALIDATION_ERROR, error.message).toJSON();
      void reply.code(422).send(body);
      return;
    }
    if (error.statusCode === 429) {
      const body = new ApiError(ERROR_CODES.RATE_LIMITED, error.message || '请求过于频繁').toJSON();
      void reply.code(429).send(body);
      return;
    }
    if (error.statusCode === 413) {
      const body = new ApiError(ERROR_CODES.PAYLOAD_TOO_LARGE, '上传内容过大').toJSON();
      void reply.code(413).send(body);
      return;
    }
    if (error.statusCode === 404 && !error.code) {
      const body = new ApiError(ERROR_CODES.NOT_FOUND, '接口不存在').toJSON();
      void reply.code(404).send(body);
      return;
    }

    if (error instanceof ApiError) {
      if (error.status >= 500) request.log.error({ err: error }, error.message);
      void reply.code(error.status).send(error.toJSON());
      return;
    }

    const body = toApiErrorBody(error);
    request.log.error({ err: error, url: request.url }, 'unhandled error');
    void reply.code(body.code === ERROR_CODES.INTERNAL ? 500 : (500)).send({
      code: ERROR_CODES.INTERNAL,
      message: ctx?.config.NODE_ENV === 'production' ? '服务器内部错误' : body.message,
    });
  });
}

/**
 * Single 404 handler.
 *
 * Fastify permits only one not-found handler per prefix, so the API 404 contract and the SPA
 * fallback must live in the same function. `spa` is true only when a built web client is being
 * served from this instance.
 */
/**
 * Extensions that must never be answered with the SPA shell.
 *
 * Returning `index.html` (status 200, `text/html`) for a missing `/assets/app.js` is the failure
 * mode that is hardest to diagnose: the browser rejects it as a module and renders a blank page
 * with no server-side error at all. Answering 404 makes a broken asset path immediately visible.
 */
const STATIC_ASSET_RE = /\.(js|mjs|cjs|css|map|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|eot|wasm|json|zip|md|txt)(\?|$)/i;

export function registerNotFoundHandler(
  app: FastifyInstance,
  options: { spa: boolean; webDist?: string; collabPublicUrl?: string },
): void {
  app.setNotFoundHandler((request, reply) => {
    const isApi = request.url.startsWith('/api');
    const pathOnly = request.url.split('?')[0] ?? request.url;

    // A missing static asset is a real 404, not a client-side route.
    if (!isApi && STATIC_ASSET_RE.test(pathOnly)) {
      return reply
        .code(404)
        .send(new ApiError(ERROR_CODES.NOT_FOUND, `静态资源不存在: ${pathOnly}`).toJSON());
    }

    // Client-side routes (e.g. /notes/abc) must return the shell, not a 404 — and the shell has
    // to carry the same runtime config injection as `/`, so it cannot be a plain static send.
    if (options.spa && !isApi && request.method === 'GET' && options.webDist) {
      // Public share pages are capability URLs: keep them out of search indexes and make the
      // nested route's relative bundle paths resolve from the server root.
      if (pathOnly === '/s' || pathOnly.startsWith('/s/')) {
        reply.header('x-robots-tag', 'noindex, nofollow');
      }
      return sendIndexHtml(reply, options.webDist, options.collabPublicUrl ?? '', {
        absoluteAssets: pathOnly !== '/',
      });
    }
    return reply
      .code(404)
      .send(new ApiError(ERROR_CODES.NOT_FOUND, `接口不存在: ${request.method} ${request.url}`).toJSON());
  });
}
