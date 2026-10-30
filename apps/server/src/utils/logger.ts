/** Minimal structured logger shape, satisfied by Fastify's logger and by pino/console. */
export interface Logger {
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

function noop(): void {}

function format(level: string, obj: unknown, msg?: string): string {
  const when = new Date().toISOString();
  const detail = typeof obj === 'string' ? obj : safeStringify(obj);
  return `${when} ${level.toUpperCase()} ${msg ?? ''} ${detail ?? ''}`.trimEnd();
}

function safeStringify(value: unknown): string {
  if (value === undefined || value === null) return '';
  try {
    return JSON.stringify(value, (_key, v) =>
      v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v,
    );
  } catch {
    return String(value);
  }
}

/** Console-backed logger with the same call signature as Fastify's, for pre-app bootstrapping. */
export function createConsoleLogger(level: 'silent' | 'error' | 'warn' | 'info' | 'debug' = 'info'): Logger {
  const ranks = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 } as const;
  const threshold = ranks[level];
  const emit = (rank: number, label: keyof typeof ranks) =>
    rank <= threshold
      ? (obj: unknown, msg?: string) => {
          const line = format(label, obj, msg);
          if (rank <= 1) console.error(line);
          else if (rank === 2) console.warn(line);
          else console.log(line);
        }
      : noop;

  return {
    debug: emit(4, 'debug'),
    info: emit(3, 'info'),
    warn: emit(2, 'warn'),
    error: emit(1, 'error'),
  };
}

export const silentLogger: Logger = { debug: noop, info: noop, warn: noop, error: noop };
