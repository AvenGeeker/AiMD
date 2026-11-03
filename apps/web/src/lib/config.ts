import { getBridge, isDesktop, isMobile } from './platform.js';
import { mobileGetServerUrl } from './mobile.js';

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
  if (isMobile()) {
    return (await mobileGetServerUrl()).replace(/\/+$/, '');
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

/** A scheme-qualified URL; anything the user typed without one gets a scheme inferred. */
const HAS_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

export type NormalizedServerUrl =
  | { ok: true; url: string; /** True when we picked the scheme, so the caller may try the other one. */ guessedScheme: boolean }
  | { ok: false; message: string };

/**
 * Loopback, LAN and mDNS hosts are served over plain HTTP in practice.
 *
 * Both documented local setups are `http://127.0.0.1:3000` (dev) and `http://<LAN-IP>:8080`
 * (an unregistered domain cannot get 80/443 through a mainland-China ISP), so guessing `https://`
 * for them would send the user into a TLS error they cannot explain.
 */
function isLocalHost(host: string): boolean {
  const value = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (value === 'localhost' || value === '::1') return true;
  if (value.startsWith('127.') || value.startsWith('10.') || value.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(value)) return true;
  return value.endsWith('.local') || value.endsWith('.lan');
}

/**
 * Turn whatever the user typed into a base URL the API client can concatenate against.
 *
 * `apiBase()` builds `${base}/api`, so a value that is not an absolute http(s) URL silently
 * produces a *relative* request path. In the browser that quietly hits the current origin; in the
 * Electron and mobile shells the document is `file://`, so the request cannot even be sent — and
 * when something does answer (a router, a static site, an intercepting proxy) it answers HTML,
 * which used to surface as `Unexpected token '<' … is not valid JSON`. Rejecting the value here
 * keeps the mistake on the screen where the user can fix it.
 */
export function normalizeServerUrl(raw: string): NormalizedServerUrl {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, message: '请填写服务器地址' };
  if (/\s/.test(trimmed)) return { ok: false, message: '服务器地址不能包含空格' };

  const explicitScheme = HAS_SCHEME_RE.test(trimmed);
  const withoutScheme = trimmed.replace(/^\/+/, '');

  let url: URL;
  try {
    if (explicitScheme) {
      url = new URL(trimmed);
    } else {
      // Parse once to learn the host, then pick the scheme it is most likely served over.
      const probe = new URL(`https://${withoutScheme}`);
      url = new URL(`${isLocalHost(probe.hostname) ? 'http' : 'https'}://${withoutScheme}`);
    }
  } catch {
    return { ok: false, message: `服务器地址格式不正确：${trimmed}（应形如 https://notes.example.com）` };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, message: '服务器地址必须以 https:// 或 http:// 开头' };
  }
  if (!url.hostname) {
    return { ok: false, message: `服务器地址缺少主机名：${trimmed}` };
  }

  // Query and fragment would end up glued in front of `/api`, so drop them.
  url.search = '';
  url.hash = '';
  return { ok: true, url: url.toString().replace(/\/+$/, ''), guessedScheme: !explicitScheme };
}

/** Human-readable origin for error messages; falls back to the raw value when unparseable. */
export function serverOrigin(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return baseUrl;
  }
}

export function apiBase(baseUrl: string): string {
  return baseUrl ? `${baseUrl.replace(/\/+$/, '')}/api` : '/api';
}
