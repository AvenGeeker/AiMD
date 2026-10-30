import type { ZodType } from 'zod';
import { ApiError, ERROR_CODES } from '@aimarkdown/shared';

/**
 * Parse untrusted input with zod, converting a failure into the shared error contract.
 *
 * Fastify's JSON-schema validation is bypassed deliberately: the same zod schemas validate
 * server input *and* type client code, so the contract cannot drift between the two.
 */
export function parse<T>(schema: ZodType<T>, data: unknown, label = '请求参数'): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const details = result.error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
  throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `${label}校验失败`, details);
}

/** Parse a comma-separated `tagIds` query parameter into a de-duplicated list. */
export function parseIdList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (trimmed.length > 0) seen.add(trimmed);
  }
  return [...seen];
}
