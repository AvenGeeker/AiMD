/**
 * Unified API error contract shared by the server (producer) and every client (consumer).
 */
export const ERROR_CODES = {
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  REGISTRATION_DISABLED: 'REGISTRATION_DISABLED',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  CYCLIC_FOLDER: 'CYCLIC_FOLDER',
  SEARCH_QUERY_TOO_SHORT: 'SEARCH_QUERY_TOO_SHORT',
  HOTKEY_TAKEN: 'HOTKEY_TAKEN',
  AI_NOT_CONFIGURED: 'AI_NOT_CONFIGURED',
  AI_DISABLED: 'AI_DISABLED',
  AI_UPSTREAM_ERROR: 'AI_UPSTREAM_ERROR',
  AI_RATE_LIMITED: 'AI_RATE_LIMITED',
  AI_INVALID_RESPONSE: 'AI_INVALID_RESPONSE',
  AI_NOTE_TOO_LONG: 'AI_NOTE_TOO_LONG',
  AI_JOB_ALREADY_RUNNING: 'AI_JOB_ALREADY_RUNNING',
  /**
   * The peer answered, but not with the JSON API contract — typically an HTML page from a wrong
   * server address, a router/captive-portal login page, or a reverse-proxy error page. Raised by
   * clients; the server never sends it.
   */
  INVALID_SERVER_RESPONSE: 'INVALID_SERVER_RESPONSE',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

/** Maps an error code to the HTTP status the server must return. */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 422,
  UNAUTHENTICATED: 401,
  TOKEN_EXPIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  EMAIL_TAKEN: 409,
  INVALID_CREDENTIALS: 401,
  REGISTRATION_DISABLED: 403,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  CYCLIC_FOLDER: 409,
  SEARCH_QUERY_TOO_SHORT: 422,
  HOTKEY_TAKEN: 409,
  AI_NOT_CONFIGURED: 422,
  AI_DISABLED: 403,
  AI_UPSTREAM_ERROR: 502,
  AI_RATE_LIMITED: 429,
  AI_INVALID_RESPONSE: 502,
  AI_NOTE_TOO_LONG: 413,
  AI_JOB_ALREADY_RUNNING: 409,
  INVALID_SERVER_RESPONSE: 502,
  INTERNAL: 500,
};

export class ApiError extends Error implements ApiErrorBody {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return ERROR_STATUS[this.code] ?? 500;
  }

  toJSON(): ApiErrorBody {
    return { code: this.code, message: this.message, details: this.details };
  }
}

/** Narrow an unknown thrown value into an `ApiErrorBody`-shaped object. */
export function toApiErrorBody(value: unknown, fallbackMessage = '未知错误'): ApiErrorBody {
  if (value instanceof ApiError) return value.toJSON();
  if (value && typeof value === 'object') {
    const candidate = value as Partial<ApiErrorBody>;
    if (typeof candidate.code === 'string' && typeof candidate.message === 'string') {
      return { code: candidate.code as ErrorCode, message: candidate.message, details: candidate.details };
    }
    if (typeof candidate.message === 'string') {
      return { code: ERROR_CODES.INTERNAL, message: candidate.message };
    }
  }
  if (value instanceof Error) return { code: ERROR_CODES.INTERNAL, message: value.message };
  return { code: ERROR_CODES.INTERNAL, message: fallbackMessage };
}
