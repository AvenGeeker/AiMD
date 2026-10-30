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

/** Runtime config the server inlines into index.html (see apps/server/src/plugins/spa.ts). */
interface RuntimeConfig {
  collabUrl?: string | null;
}

declare global {
  interface Window {
    __AIMARKDOWN_CONFIG__?: RuntimeConfig;
  }
}

function injectedCollabUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const value = window.__AIMARKDOWN_CONFIG__?.collabUrl;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * WebSocket URL for collaboration.
 *
 * Resolution order:
 *  1. an explicit base URL (Electron, which points at a remote server)
 *  2. `window.__AIMARKDOWN_CONFIG__.collabUrl`, injected by the server when the deployment has no
 *     reverse proxy fronting `/collab`
 *  3. same-origin `/collab`, which is what the Compose deployment uses (Caddy strips the prefix)
 */
export function collabUrl(baseUrl: string): string {
  if (baseUrl) {
    const url = new URL(baseUrl);
    // The base url is http(s); a WebSocket needs ws(s) or the connection is refused outright.
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/collab';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  }

  const injected = injectedCollabUrl();
  if (injected) return injected;

  const proto = typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss' : 'ws';
  const host = typeof location !== 'undefined' ? location.host : 'localhost';
  return `${proto}://${host}/collab`;
}

export function apiBase(baseUrl: string): string {
  return baseUrl ? `${baseUrl.replace(/\/+$/, '')}/api` : '/api';
}
