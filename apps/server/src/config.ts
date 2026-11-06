import { z } from 'zod';
import { DEFAULT_COLLAB_PORT, DEFAULT_REST_PORT } from '@aimarkdown/shared';

/**
 * Typed server configuration.
 *
 * Every value is read from the environment once at boot and validated here, so the rest of
 * the codebase never touches `process.env` and a misconfigured deploy fails fast with a
 * readable message instead of misbehaving at runtime.
 */

const booleanish = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

/**
 * Treat an empty/blank environment value as "not set".
 *
 * Docker Compose and most CI systems pass `FOO=` rather than omitting the variable, and zod sees
 * that as a present empty string — so an optional `min(8)` password would reject a deployment that
 * simply did not configure an admin. Normalising here keeps `.optional()` meaning what it says.
 */
const blankToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim().length === 0 ? undefined : value;

const optionalString = z.preprocess(blankToUndefined, z.string().optional());

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  REST_PORT: z.coerce.number().int().min(0).max(65535).default(DEFAULT_REST_PORT),
  COLLAB_PORT: z.coerce.number().int().min(0).max(65535).default(DEFAULT_COLLAB_PORT),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  /** HMAC secret for access/refresh tokens. Must be long and unique per deployment. */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),

  /** Comma-separated allowed web origins, or `*`. */
  CORS_ORIGIN: z.string().default('*'),

  ALLOW_REGISTRATION: booleanish.default(true),
  BOOTSTRAP_ADMIN_EMAIL: optionalString,
  BOOTSTRAP_ADMIN_PASSWORD: z.preprocess(blankToUndefined, z.string().min(8).optional()),

  UPLOAD_DIR: z.string().default('./data/uploads'),
  /** Public base URL used to build absolute attachment links. */
  PUBLIC_URL: z.preprocess(blankToUndefined, z.string().default('')),

  /** Reserved for a future Chinese word-segmentation driver. Only `trgm` is implemented. */
  SEARCH_DRIVER: z.enum(['trgm', 'zhparser']).default('trgm'),

  /** Hocuspocus persistence throttling (ms). */
  COLLAB_DEBOUNCE: z.coerce.number().int().min(200).default(2000),
  COLLAB_MAX_DEBOUNCE: z.coerce.number().int().min(1000).default(10000),
  COLLAB_TIMEOUT: z.coerce.number().int().min(5000).default(30000),
  COLLAB_MAX_PAYLOAD_BYTES: z.coerce.number().int().min(1024).default(10 * 1024 * 1024),

  /**
   * Credential-endpoint rate limit (requests per minute per IP). Tight by default to blunt
   * password guessing; raised in tests, which register many accounts from one address.
   */
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  /** Global API rate limit (requests per minute per IP). */
  API_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(600),

  /** Bounded wait for pending CRDT stores during shutdown, so SIGTERM cannot lose writes. */
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).default(10000),

  /**
   * WebSocket URL the browser should use for collaboration, injected into index.html at request
   * time. Leave empty when a reverse proxy maps `/collab` to the Hocuspocus port (the Compose
   * deployment does); set it when Fastify serves the SPA directly, e.g. `ws://host:1234`.
   */
  COLLAB_PUBLIC_URL: z.preprocess(blankToUndefined, z.string().default('')),

  /** Optional dedicated key for encrypting per-user AI provider credentials. */
  AI_CREDENTIALS_SECRET: z.preprocess(blankToUndefined, z.string().min(32).optional()),
  /** Allow HTTP/loopback/private AI base URLs. Intended for local models and tests only. */
  AI_ALLOW_PRIVATE_BASE_URL: z.preprocess(blankToUndefined, booleanish.default(false)),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(5_000).default(90_000),
  AI_REQUEST_INTERVAL_MS: z.coerce.number().int().min(0).default(750),
  AI_MAX_CHUNK_CHARS: z.coerce.number().int().min(1_000).default(16_000),
  AI_MAX_CHUNKS: z.coerce.number().int().min(1).default(48),

  /** Allow private/loopback link targets. Intended for local deployments and tests only. */
  LINK_FETCH_ALLOW_PRIVATE: z.preprocess(blankToUndefined, booleanish.default(false)),
  LINK_FETCH_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(15_000),
  LINK_FETCH_MAX_BYTES: z.coerce.number().int().min(64 * 1024).default(8 * 1024 * 1024),
  LINK_FETCH_MAX_IMAGES: z.coerce.number().int().min(0).default(20),
  LINK_FETCH_MAX_IMAGE_BYTES: z.coerce.number().int().min(1024).default(10 * 1024 * 1024),
  LINK_FETCH_MAX_TOTAL_MEDIA_BYTES: z.coerce.number().int().min(0).default(40 * 1024 * 1024),
  MEDIA_JOB_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  MEDIA_MAX_DURATION_SECONDS: z.coerce.number().int().min(1).default(7200),
  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),

  /** Absolute path to the SQL migrations directory. */
  MIGRATIONS_DIR: optionalString,

  /** Serve the built web client from this directory (empty disables static hosting). */
  // Blank means "API only"; the app then serves no SPA and returns JSON 404s.
  WEB_DIST_DIR: z.preprocess(blankToUndefined, z.string().default('')),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /** Access token lifetime override, mainly so tests can force expiry. */
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().optional(),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().optional(),
  /** Long-lived refresh token lifetime for "remember me" devices. */
  REMEMBERED_REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().optional(),
  /** How long a just-rotated refresh token may be retried without revoking the token family. */
  REFRESH_ROTATION_GRACE_SECONDS: z.coerce.number().int().min(0).max(600).default(60),
});

export type ServerConfig = z.infer<typeof configSchema>;

export class ConfigError extends Error {
  readonly issues: unknown;
  constructor(message: string, issues: unknown) {
    super(message);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const summary = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new ConfigError(`Invalid server configuration:\n${summary}`, result.error.issues);
  }
  return result.data;
}

export function isProduction(config: ServerConfig): boolean {
  return config.NODE_ENV === 'production';
}

export function corsOriginList(config: ServerConfig): string[] | boolean {
  const raw = config.CORS_ORIGIN.trim();
  if (raw === '*' || raw === '') return true;
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}
