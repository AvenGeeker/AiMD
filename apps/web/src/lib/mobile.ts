import { harmonyBridge, isMobile, mobilePlatform } from './platform.js';

/**
 * Web-bundle ↔ mobile-shell integration (Capacitor: Android / iOS / HarmonyOS).
 *
 * Everything here is a no-op in a plain browser tab. The mobile shell needs two things the web
 * page cannot infer: which self-hosted server to talk to, and durable tokens that survive
 * WebView reloads (a WebView has no cookie jar worth relying on, so the app uses the server's
 * bearer transport exactly like the Electron shell).
 *
 * Storage precedence per platform:
 *  - Android / iOS: Keychain / Android Keystore via `@aparajita/capacitor-secure-storage`.
 *  - HarmonyOS: a tiny native bridge (`window.aiMarkdownHarmony`) when the minimal ArkWeb harness
 *    is used, otherwise `@capacitor/preferences`.
 *  - Anything native without a working secure store: `@capacitor/preferences`. Plain storage on
 *    the device is a real trade-off (tokens are readable if the device is compromised), but it is
 *    the documented fallback for the self-hosted sideload scenario of v1.
 *
 * The server URL intentionally uses Preferences on every native platform: it is not a secret and
 * must survive app updates without touching keychain entitlements.
 */

const SERVER_URL_KEY = 'aimarkdown.serverUrl';
const ACCESS_TOKEN_KEY = 'aimarkdown.accessToken';
const REFRESH_TOKEN_KEY = 'aimarkdown.refreshToken';

export interface MobileTokens {
  accessToken: string | null;
  refreshToken: string | null;
}

/**
 * Last-resort storage for native shells without a working plug-in bridge (notably the minimal
 * HarmonyOS ArkWeb harness until its javaScriptProxy bridge is verified) and for tests.
 * Plain localStorage is acceptable there because those shells are single-app WebViews.
 */
function localGet(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function localSet(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — tokens stay in memory for this session */
  }
}

function localRemove(key: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

interface PreferencesStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

let preferencesPromise: Promise<PreferencesStore | null> | null = null;

/**
 * Resolve Preferences through a plain wrapper.
 *
 * Capacitor plug-ins are Proxy objects. Resolving one directly from an async function makes the
 * Promise machinery probe its synthetic `then`, and Capacitor answers that probe by rejecting an
 * orphaned native call while the outer Promise never settles. Keep the proxy inside this closure.
 */
function preferences(): Promise<PreferencesStore | null> {
  preferencesPromise ??= import('@capacitor/preferences')
    .then(({ Preferences }) => ({
      get: async (key: string) => (await Preferences.get({ key })).value,
      set: async (key: string, value: string) => {
        await Preferences.set({ key, value });
      },
      remove: async (key: string) => {
        await Preferences.remove({ key });
      },
    }))
    .catch(() => null);
  return preferencesPromise;
}

interface SecureStorageStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

let secureStoragePromise: Promise<SecureStorageStore | null> | null = null;

/** Same Proxy caveat as `preferences()`: resolve a wrapper, never the Capacitor proxy itself. */
function secureStorage(): Promise<SecureStorageStore | null> {
  secureStoragePromise ??= import('@aparajita/capacitor-secure-storage')
    .then(({ SecureStorage }) =>
      SecureStorage
        ? {
            getItem: (key: string) => SecureStorage.getItem(key),
            setItem: (key: string, value: string) => SecureStorage.setItem(key, value),
            removeItem: (key: string) => SecureStorage.removeItem(key),
          }
        : null,
    )
    .catch(() => null);
  return secureStoragePromise;
}

async function kvGet(key: string, secure = false): Promise<string | null> {
  try {
    // HarmonyOS first: the native bridge avoids depending on a community plug-in port.
    const bridge = secure ? harmonyBridge() : null;
    if (bridge) {
      try {
        return (await bridge.get(key)) || null;
      } catch {
        /* fall through to Preferences */
      }
    }
    if (secure && (mobilePlatform() === 'android' || mobilePlatform() === 'ios')) {
      const store = await secureStorage();
      if (store) {
        try {
          return await store.getItem(key);
        } catch {
          /* fall through to Preferences */
        }
      }
    }
    const store = await preferences();
    if (store) {
      try {
        const value = await store.get(key);
        if (value !== null) return value;
      } catch {
        /* plug-in unavailable on this shell — fall back to localStorage below */
      }
    }
  } catch {
    /* an unexpected bridge failure must never propagate out of storage */
  }
  return localGet(key) || null;
}

async function kvSet(key: string, value: string, secure = false): Promise<void> {
  try {
    const bridge = secure ? harmonyBridge() : null;
    if (bridge) {
      try {
        await bridge.set(key, value);
        return;
      } catch {
        /* fall through */
      }
    }
    if (secure && (mobilePlatform() === 'android' || mobilePlatform() === 'ios')) {
      const store = await secureStorage();
      if (store) {
        try {
          await store.setItem(key, value);
          return;
        } catch {
          /* fall through */
        }
      }
    }
    const store = await preferences();
    if (store) {
      try {
        await store.set(key, value);
        return;
      } catch {
        /* fall through to localStorage */
      }
    }
    localSet(key, value);
  } catch {
    localSet(key, value);
  }
}

async function kvRemove(key: string, secure = false): Promise<void> {
  try {
    const bridge = secure ? harmonyBridge() : null;
    if (bridge) {
      try {
        await bridge.remove(key);
        return;
      } catch {
        /* fall through */
      }
    }
    if (secure && (mobilePlatform() === 'android' || mobilePlatform() === 'ios')) {
      const store = await secureStorage();
      if (store) {
        try {
          await store.removeItem(key);
          return;
        } catch {
          /* fall through */
        }
      }
    }
    const store = await preferences();
    if (store) {
      try {
        await store.remove(key);
        return;
      } catch {
        /* fall through to localStorage */
      }
    }
    localRemove(key);
  } catch {
    localRemove(key);
  }
}

export async function mobileGetServerUrl(): Promise<string> {
  if (!isMobile()) return '';
  return (await kvGet(SERVER_URL_KEY)) ?? '';
}

export async function mobileSetServerUrl(url: string): Promise<void> {
  if (!isMobile()) return;
  await kvSet(SERVER_URL_KEY, url.replace(/\/+$/, ''));
}

export async function mobileGetTokens(): Promise<MobileTokens> {
  if (!isMobile()) return { accessToken: null, refreshToken: null };
  const [accessToken, refreshToken] = await Promise.all([
    kvGet(ACCESS_TOKEN_KEY, true),
    kvGet(REFRESH_TOKEN_KEY, true),
  ]);
  return { accessToken, refreshToken };
}

export async function mobileSetTokens(tokens: MobileTokens): Promise<void> {
  if (!isMobile()) return;
  await Promise.all([
    tokens.accessToken
      ? kvSet(ACCESS_TOKEN_KEY, tokens.accessToken, true)
      : kvRemove(ACCESS_TOKEN_KEY, true),
    tokens.refreshToken
      ? kvSet(REFRESH_TOKEN_KEY, tokens.refreshToken, true)
      : kvRemove(REFRESH_TOKEN_KEY, true),
  ]);
}

export async function mobileClearTokens(): Promise<void> {
  if (!isMobile()) return;
  await Promise.all([
    kvRemove(ACCESS_TOKEN_KEY, true),
    kvRemove(REFRESH_TOKEN_KEY, true),
  ]);
}
