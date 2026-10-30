import { getBridge, isDesktop } from './platform.js';

/**
 * API base URL resolution.
 *
 * In the browser the app is served by the API itself, so a relative base works and avoids CORS
 * entirely. In Electron the bundle is loaded from `file://` and must be pointed at whatever
 * server the user configured on first launch.
 */

const STORAGE_KEY = 'aimarkdown.serverUrl';

let cached: string | null = null;

export function getStoredServerUrl(): string {
  if (cached !== null) return cached;
  try {
    cached = localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    cached = '';
  }
  return cached;
}

export function setStoredServerUrl(url: string): void {
  cached = url.replace(/\/+$/, '');
  try {
    localStorage.setItem(STORAGE_KEY, cached);
  } catch {
    /* private mode: fall back to the in-memory value for this session */
  }
}

/** Resolve the base URL, preferring the value the desktop shell persisted in the keychain. */
export async function resolveBaseUrl(): Promise<string> {
  const bridge = getBridge();
  if (bridge && isDesktop()) {
    const fromBridge = await bridge.getServerUrl();
    if (fromBridge) return fromBridge.replace(/\/+$/, '');
  }
  return getStoredServerUrl() || '';
}

/** WebSocket URL for collaboration, derived from the REST base. */
export function collabUrl(baseUrl: string): string {
  if (!baseUrl) {
    // Same-origin dev/prod: the reverse proxy maps /collab to the Hocuspocus port.
    const proto = typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss' : 'ws';
    const host = typeof location !== 'undefined' ? location.host : 'localhost';
    return `${proto}://${host}/collab`;
  }
  const url = new URL(baseUrl);
  // The base url is http(s); a WebSocket needs ws(s) or the connection is refused outright.
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/collab';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/, '');
}

export function apiBase(baseUrl: string): string {
  return baseUrl ? `${baseUrl.replace(/\/+$/, '')}/api` : '/api';
}
