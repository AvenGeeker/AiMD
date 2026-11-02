import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const preferenceValues = new Map<string, string>();
  const secureValues = new Map<string, string>();

  return {
    preferenceValues,
    secureValues,
    preferences: {
      get: vi.fn(async ({ key }: { key: string }) => ({ value: preferenceValues.get(key) ?? null })),
      set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
        preferenceValues.set(key, value);
      }),
      remove: vi.fn(async ({ key }: { key: string }) => {
        preferenceValues.delete(key);
      }),
    },
    secure: {
      getItem: vi.fn(async (key: string) => secureValues.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        secureValues.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        secureValues.delete(key);
      }),
      // Capacitor plug-ins are Proxy objects with a synthetic `then`. Resolving one directly
      // from an async function invokes this and leaves the Promise pending forever.
      get then() {
        return () => new Promise<never>(() => undefined);
      },
    },
  };
});

vi.mock('@capacitor/preferences', () => ({ Preferences: mocks.preferences }));
vi.mock('@aparajita/capacitor-secure-storage', () => ({ SecureStorage: mocks.secure }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.preferenceValues.clear();
  mocks.secureValues.clear();
  localStorage.clear();
  (window as unknown as Record<string, unknown>).Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
  };
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).Capacitor;
});

describe('mobile storage', () => {
  it('keeps the non-secret server URL in Preferences and resolves normally', async () => {
    const { mobileGetServerUrl, mobileSetServerUrl } = await import('./mobile.js');

    await mobileSetServerUrl('https://myaimd.top///');

    expect(mocks.preferenceValues.get('aimarkdown.serverUrl')).toBe('https://myaimd.top');
    expect(mocks.secure.setItem).not.toHaveBeenCalled();
    await expect(mobileGetServerUrl()).resolves.toBe('https://myaimd.top');
  });

  it('settles token I/O even when SecureStorage is a Capacitor proxy', async () => {
    const { mobileGetTokens, mobileSetTokens } = await import('./mobile.js');

    const outcome = await Promise.race([
      mobileSetTokens({ accessToken: 'access', refreshToken: 'refresh' }).then(() => 'done' as const),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 250)),
    ]);

    expect(outcome).toBe('done');
    expect(mocks.secureValues.get('aimarkdown.accessToken')).toBe('access');
    expect(mocks.secureValues.get('aimarkdown.refreshToken')).toBe('refresh');
    await expect(mobileGetTokens()).resolves.toEqual({
      accessToken: 'access',
      refreshToken: 'refresh',
    });
  });
});
