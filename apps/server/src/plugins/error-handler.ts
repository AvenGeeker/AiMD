import type { FastifyError, FastifyInstance } from 'fastify';
import { ApiError, ERROR_CODES, toApiErrorBody } from '@aimarkdown/shared';

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

  app.setNotFoundHandler((request, reply) => {
    void reply
      .code(404)
      .send(new ApiError(ERROR_CODES.NOT_FOUND, `接口不存在: ${request.method} ${request.url}`).toJSON());
  });
}
