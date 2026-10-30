import {
  ApiError,
  ERROR_CODES,
  toApiErrorBody,
  type ApiErrorBody,
} from '@aimarkdown/shared';
import { apiBase, resolveBaseUrl } from './config.js';
import { getBridge, isDesktop } from './platform.js';

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
  }
}

export function clearTokens(): void {
  memoryTokens = { accessToken: null, refreshToken: null };
  void getBridge()?.setTokens({ accessToken: null, refreshToken: null });
}

/** Transport header set: bearer for desktop, cookies for the browser. */
function authInit(): RequestInit & { headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  if (isDesktop() && memoryTokens.accessToken) {
    headers.authorization = `Bearer ${memoryTokens.accessToken}`;
  }
  return { credentials: 'include', headers };
}

function bearerTransportHeaders(): Record<string, string> {
  // Ask the server for the refresh token in the body; only the desktop client needs this.
  return isDesktop() ? { 'x-token-transport': 'bearer' } : {};
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
        const base = apiBase(resolvedBase);
        // Desktop has no usable cookie jar on a file:// page, so it presents the refresh token
        // in the body and asks for the rotated one back in the response body.
        const useBodyToken = isDesktop() && Boolean(memoryTokens.refreshToken);
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
          clearTokens();
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

  const response = await fetch(buildUrl(path, options.query), {
    method: options.method ?? 'GET',
    headers,
    body,
    credentials: init.credentials,
    signal: options.signal,
  });

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
