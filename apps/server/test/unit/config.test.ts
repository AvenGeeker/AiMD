import { describe, expect, it } from 'vitest';
import { ConfigError, corsOriginList, loadConfig } from '../../src/config.js';

const BASE = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
  JWT_SECRET: 'x'.repeat(48),
};

describe('loadConfig', () => {
  it('applies documented defaults', () => {
    const config = loadConfig(BASE as NodeJS.ProcessEnv);
    expect(config.REST_PORT).toBe(3000);
    expect(config.COLLAB_PORT).toBe(1234);
    expect(config.SEARCH_DRIVER).toBe('trgm');
    expect(config.ALLOW_REGISTRATION).toBe(true);
    expect(config.COLLAB_DEBOUNCE).toBe(2000);
    expect(config.COLLAB_MAX_DEBOUNCE).toBe(10000);
    expect(config.SHUTDOWN_TIMEOUT_MS).toBe(10000);
  });

  it('requires DATABASE_URL and a long JWT_SECRET', () => {
    expect(() => loadConfig({ JWT_SECRET: 'x'.repeat(48) } as NodeJS.ProcessEnv)).toThrow(ConfigError);
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x' } as NodeJS.ProcessEnv)).toThrow(ConfigError);
    expect(() =>
      loadConfig({ DATABASE_URL: 'postgres://x', JWT_SECRET: 'too-short' } as NodeJS.ProcessEnv),
    ).toThrow(/JWT_SECRET/);
  });

  it('lists every problem in one readable message', () => {
    try {
      loadConfig({} as NodeJS.ProcessEnv);
      expect.unreachable('should have thrown');
    } catch (error) {
      const message = (error as ConfigError).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('JWT_SECRET');
    }
  });

  /** Docker Compose passes `FOO=` for unset variables; that must not fail validation. */
  it('treats blank optional values as unset', () => {
    const config = loadConfig({
      ...BASE,
      BOOTSTRAP_ADMIN_EMAIL: '',
      BOOTSTRAP_ADMIN_PASSWORD: '',
      PUBLIC_URL: '',
      WEB_DIST_DIR: '',
      MIGRATIONS_DIR: '',
    } as NodeJS.ProcessEnv);
    expect(config.BOOTSTRAP_ADMIN_EMAIL).toBeUndefined();
    expect(config.BOOTSTRAP_ADMIN_PASSWORD).toBeUndefined();
    expect(config.PUBLIC_URL).toBe('');
    expect(config.WEB_DIST_DIR).toBe('');
  });

  it('still rejects a too-short non-blank admin password', () => {
    expect(() =>
      loadConfig({
        ...BASE,
        BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com',
        BOOTSTRAP_ADMIN_PASSWORD: 'short',
      } as NodeJS.ProcessEnv),
    ).toThrow(/BOOTSTRAP_ADMIN_PASSWORD/);
  });

  it('accepts a valid bootstrap admin', () => {
    const config = loadConfig({
      ...BASE,
      BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com',
      BOOTSTRAP_ADMIN_PASSWORD: 'longenough',
    } as NodeJS.ProcessEnv);
    expect(config.BOOTSTRAP_ADMIN_EMAIL).toBe('admin@example.com');
  });

  it('parses booleans from the usual shell spellings', () => {
    for (const value of ['true', '1', 'yes']) {
      expect(loadConfig({ ...BASE, ALLOW_REGISTRATION: value } as NodeJS.ProcessEnv).ALLOW_REGISTRATION).toBe(true);
    }
    for (const value of ['false', '0', 'no']) {
      expect(loadConfig({ ...BASE, ALLOW_REGISTRATION: value } as NodeJS.ProcessEnv).ALLOW_REGISTRATION).toBe(false);
    }
  });

  it('coerces numeric ports and rejects out-of-range values', () => {
    expect(loadConfig({ ...BASE, REST_PORT: '8080' } as NodeJS.ProcessEnv).REST_PORT).toBe(8080);
    // Port 0 asks the OS for an ephemeral port, which the test harness relies on.
    expect(loadConfig({ ...BASE, COLLAB_PORT: '0' } as NodeJS.ProcessEnv).COLLAB_PORT).toBe(0);
    expect(() => loadConfig({ ...BASE, REST_PORT: '99999' } as NodeJS.ProcessEnv)).toThrow(ConfigError);
  });
});

describe('corsOriginList', () => {
  it('allows any origin for a wildcard', () => {
    expect(corsOriginList(loadConfig({ ...BASE, CORS_ORIGIN: '*' } as NodeJS.ProcessEnv))).toBe(true);
  });

  it('splits and trims an explicit list', () => {
    const config = loadConfig({
      ...BASE,
      CORS_ORIGIN: 'https://a.example, https://b.example ,',
    } as NodeJS.ProcessEnv);
    expect(corsOriginList(config)).toEqual(['https://a.example', 'https://b.example']);
  });
});
