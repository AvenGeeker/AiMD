import {
  ApiError,
  ERROR_CODES,
  toApiErrorBody,
  type ApiErrorBody,
} from '@aimarkdown/shared';
import { apiBase, resolveBaseUrl } from './config.js';
import { getBridge, isDesktop, isMobile } from './platform.js';
import { mobileClearTokens, mobileGetTokens, mobileSetTokens } from './mobile.js';

/**
 * HTTP client.
 *
 * One implementation serves both runtimes:
 *  - browser: credentials ride in httpOnly cookies (`credentials: 'include'`)
 *  - desktop: the Electron preload supplies tokens from the OS keychain and they are sent as a
 *    bearer header, because a `file://` page has no usable cookie jar
 *
 * A `TOKEN_EXPIRED` response triggers exactly one refresh-and-retry, so callers never have to
 * think about token lifetimes.
 */

export interface ClientOptions {
  baseUrl?: string;
}

let memoryTokens: { accessToken: string | null; refreshToken: string | null } = {
  accessToken: null,
  refreshToken: null,
};

let resolvedBase = '';

export async function initApi(options: ClientOptions = {}): Promise<string> {
  resolvedBase = options.baseUrl ?? (await resolveBaseUrl());
  if (isDesktop()) {
    const bridge = getBridge();
    if (bridge) memoryTokens = await bridge.getTokens();
  } else if (isMobile()) {
    memoryTokens = await mobileGetTokens();
  }
  return resolvedBase;
}

export function currentBaseUrl(): string {
  return resolvedBase;
}

export function getAccessToken(): string | null {
  return memoryTokens.accessToken;
}

export function getRefreshToken(): string | null {
  return memoryTokens.refreshToken;
}

export async function setTokens(tokens: {
  accessToken: string | null;
  refreshToken?: string | null;
}): Promise<void> {
  memoryTokens = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken !== undefined ? tokens.refreshToken : memoryTokens.refreshToken,
  };
  if (isDesktop()) {
    await getBridge()?.setTokens(memoryTokens);
  } else if (isMobile()) {
    await mobileSetTokens(memoryTokens);
  }
}

export async function clearTokens(): Promise<void> {
  memoryTokens = { accessToken: null, refreshToken: null };
  try {
    if (isDesktop()) {
      await getBridge()?.setTokens({ accessToken: null, refreshToken: null });
    } else if (isMobile()) {
      await mobileClearTokens();
    }
  } catch {
    // Memory is already clear; a failing secure-storage bridge must not block sign-out.
  }
}

/** True when the client has no cookie jar and must use the bearer transport. */
function usesBearerTransport(): boolean {
  return isDesktop() || isMobile();
}

/** Transport header set: bearer for desktop/mobile, cookies for the browser. */
function authInit(): RequestInit & { headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  if (usesBearerTransport() && memoryTokens.accessToken) {
    headers.authorization = `Bearer ${memoryTokens.accessToken}`;
  }
  return { credentials: 'include', headers };
}

function bearerTransportHeaders(): Record<string, string> {
  // Ask the server for the refresh token in the body; desktop and mobile have no cookie jar.
  return usesBearerTransport() ? { 'x-token-transport': 'bearer' } : {};
}

export class HttpError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;
  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
  get code(): string {
    return this.body.code;
  }
}

let refreshing: Promise<boolean> | null = null;

/** Refresh the access token. Concurrent callers share one in-flight refresh. */
export async function refreshAccessToken(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        if (isDesktop()) {
          const bridge = getBridge();
          if (bridge?.refreshSession) {
            const result = await bridge.refreshSession();
            if (!result) {
              await clearTokens();
              return false;
            }
            await setTokens(result);
            return true;
          }
        }
        const base = apiBase(resolvedBase);
        // Desktop and mobile have no usable cookie jar, so they present the refresh token in
        // the body and ask for the rotated one back in the response body.
        const useBodyToken = usesBearerTransport() && Boolean(memoryTokens.refreshToken);
        const response = await fetch(`${base}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/json',
            ...(useBodyToken ? bearerTransportHeaders() : {}),
          },
          body: JSON.stringify(useBodyToken ? { refreshToken: memoryTokens.refreshToken } : {}),
        });
        if (!response.ok) {
          await clearTokens();
          return false;
        }
        const payload = (await response.json()) as {
          accessToken: string;
          refreshToken?: string;
        };
        await setTokens({
          accessToken: payload.accessToken,
          ...(payload.refreshToken !== undefined ? { refreshToken: payload.refreshToken } : {}),
        });
        return true;
      } catch {
        return false;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  raw?: boolean;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const base = apiBase(resolvedBase).replace(/\/+$/, '');
  const full = path.startsWith('/') ? `${base}${path}` : `${base}/${path}`;
  const absolute = base.startsWith('http');

  // A relative base (same-origin browser use) cannot be parsed on its own; resolving it
  // against `location.origin` lets us use URLSearchParams, then we hand back the relative form
  // so cookies and same-origin rules apply normally.
  let url: URL;
  try {
    url = new URL(full);
  } catch {
    url = new URL(full, typeof location !== 'undefined' ? location.origin : 'http://localhost');
  }

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return absolute ? url.toString() : `${url.pathname}${url.search}`;
}

/**
 * Requests must never hang the UI forever: if the host is unreachable but never refuses the
 * connection (routable black hole, unusual WebView networking), a bare fetch can stay pending
 * indefinitely. Large uploads (FormData) are exempt — aborting those after a fixed budget would
 * break slow networks.
 */
const REQUEST_TIMEOUT_MS = 20_000;

function signalWithTimeout(signal?: AbortSignal): { signal: AbortSignal; done(): void } {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort);
  }
  return {
    signal: controller.signal,
    done: () => {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

async function doFetch(path: string, options: RequestOptions, allowRetry: boolean): Promise<Response> {
  const init = authInit();
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string>),
    ...(options.headers ?? {}),
  };

  let body: BodyInit | undefined;
  if (options.body instanceof FormData) {
    body = options.body;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const upload = options.body instanceof FormData;
  const guard = upload ? null : signalWithTimeout(options.signal);
  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers,
      body,
      credentials: init.credentials,
      signal: guard ? guard.signal : options.signal,
    });
  } finally {
    guard?.done();
  }

  if (response.status === 401 && allowRetry) {
    const payload = (await response.clone().json().catch(() => null)) as ApiErrorBody | null;
    if (payload?.code === ERROR_CODES.TOKEN_EXPIRED || !isDesktop()) {
      const refreshed = await refreshAccessToken();
      if (refreshed) return doFetch(path, options, false);
    }
  }
  return response;
}

/** Perform a JSON request, throwing `HttpError` with the shared error contract on failure. */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await doFetch(path, options, true);
  if (!response.ok) {
    const parsed = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new HttpError(response.status, parsed ?? { code: ERROR_CODES.INTERNAL, message: response.statusText });
  }
  if (options.raw) return response as unknown as T;
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text.length > 0 ? JSON.parse(text) : undefined) as T;
}

/** Fetch a binary payload (ZIP export, attachment download). */
export async function requestBlob(path: string, options: RequestOptions = {}): Promise<Blob> {
  const response = await doFetch(path, options, true);
  if (!response.ok) {
    const parsed = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new HttpError(response.status, parsed ?? { code: ERROR_CODES.INTERNAL, message: '下载失败' });
  }
  return response.blob();
}

/** Turn anything thrown into the shared error shape for display. */
export function describeError(error: unknown): string {
  if (error instanceof HttpError) return error.body.message;
  if (error instanceof ApiError) return error.message;
  return toApiErrorBody(error).message;
}

/** Absolute URL for an attachment, usable directly in an `<img src>`. */
export function attachmentUrl(id: string): string {
  return `${apiBase(resolvedBase)}/attachments/${id}`;
}
