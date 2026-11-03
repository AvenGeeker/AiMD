import {
  ApiError,
  ERROR_CODES,
  toApiErrorBody,
  type ApiErrorBody,
  type ErrorCode,
  type HealthDto,
} from '@aimarkdown/shared';
import { apiBase, resolveBaseUrl, serverOrigin } from './config.js';
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

/** Outcome of reading a response body: either JSON, or an explanation of why it is not. */
interface ReadBody {
  /** Parsed JSON, or null when the body was empty or not JSON. */
  json: unknown | null;
  /** User-facing reason when a non-empty body could not be parsed as JSON. */
  invalid: string | null;
}

/**
 * Read a body without ever letting a raw `SyntaxError` reach the UI.
 *
 * Every API answer is supposed to be JSON. When it is not — a wrong server address, a router or
 * captive-portal login page, a reverse-proxy error page, a static host answering `POST /api/…`
 * with the SPA shell — `response.json()` throws V8's `Unexpected token '<', "<!DOCTYPE "… is not
 * valid JSON`, which the app used to display verbatim. That message is meaningless to the person
 * who has to fix the address, so the parse failure is translated here instead.
 */
async function readBody(response: Response): Promise<ReadBody> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return { json: null, invalid: null };
  }
  if (text.length === 0) return { json: null, invalid: null };
  try {
    return { json: JSON.parse(text) as unknown, invalid: null };
  } catch {
    const contentType = response.headers.get('content-type') ?? '未知 content-type';
    // The snippet goes to the console only: it is the fastest way to tell a router login page from
    // a proxy error page, but it must not be dumped into the UI.
    console.warn(
      `[AiMD] 非 JSON 响应：${response.status} ${contentType} ${response.url}\n${text.slice(0, 240)}`,
    );
    return { json: null, invalid: describeNonJsonBody(response, contentType, text) };
  }
}

function describeNonJsonBody(response: Response, contentType: string, text: string): string {
  const looksLikeHtml = /html/i.test(contentType) || /^\s*</.test(text);
  const where = response.url ? `（请求地址 ${response.url}）` : '';
  if (looksLikeHtml) {
    return `服务器返回了网页而不是 API 数据${where}。请在「服务器地址」里填写 AiMD 的部署地址（形如 https://notes.example.com），不要填成别的网站、路由器管理页或下载页。`;
  }
  return `服务器返回了无法解析的内容（HTTP ${response.status}，${contentType}）${where}。请确认该地址是 AiMD 服务。`;
}

/** Coerce a parsed error body into the shared contract, falling back to a readable message. */
function toErrorBody(json: unknown, invalid: string | null, fallback: string): ApiErrorBody {
  if (json && typeof json === 'object') {
    const candidate = json as Partial<ApiErrorBody>;
    if (typeof candidate.message === 'string') {
      return {
        code: (typeof candidate.code === 'string' ? candidate.code : ERROR_CODES.INTERNAL) as ErrorCode,
        message: candidate.message,
        details: candidate.details,
      };
    }
  }
  return { code: ERROR_CODES.INTERNAL, message: invalid ?? fallback };
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
        const payload =
          (await readJsonResponse<{ accessToken?: string; refreshToken?: string }>(
            response,
            '刷新登录状态失败',
          )) ?? {};
        if (typeof payload.accessToken !== 'string') {
          await clearTokens();
          return false;
        }
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
    const payload = (await readBody(response.clone())).json as ApiErrorBody | null;
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
    const { json, invalid } = await readBody(response);
    throw new HttpError(
      response.status,
      toErrorBody(json, invalid, response.statusText || '请求失败'),
    );
  }
  if (options.raw) return response as unknown as T;
  if (response.status === 204) return undefined as T;
  const { json, invalid } = await readBody(response);
  if (invalid) throw new ApiError(ERROR_CODES.INVALID_SERVER_RESPONSE, invalid);
  return (json ?? undefined) as T;
}

/**
 * Read one JSON response for the hand-written auth calls.
 *
 * `login` / `register` build their own `fetch` (they run before the client is initialised), so
 * they share this guard to keep the error contract identical everywhere.
 */
export async function readJsonResponse<T>(
  response: Response,
  failureMessage: string,
): Promise<T | null> {
  const { json, invalid } = await readBody(response);
  if (!response.ok) {
    throw new HttpError(response.status, toErrorBody(json, invalid, failureMessage));
  }
  if (invalid) throw new ApiError(ERROR_CODES.INVALID_SERVER_RESPONSE, invalid);
  return (json ?? null) as T | null;
}

/** Fetch a binary payload (ZIP export, attachment download). */
export async function requestBlob(path: string, options: RequestOptions = {}): Promise<Blob> {
  const response = await doFetch(path, options, true);
  if (!response.ok) {
    const { json, invalid } = await readBody(response);
    throw new HttpError(response.status, toErrorBody(json, invalid, '下载失败'));
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


/* ------------------------- server address validation ------------------------ */

const PROBE_TIMEOUT_MS = 10_000;

/**
 * Check that an address really is an AiMD server before the shell persists it.
 *
 * `GET /api/health` is public, tiny and present in every deployment. A degraded instance (503 with
 * a JSON body) still counts as reachable — the point of the probe is to catch addresses that are
 * not this application at all, which otherwise fail much later with an opaque parse error.
 */
export async function probeServerHealth(baseUrl: string): Promise<HealthDto> {
  const url = `${apiBase(baseUrl)}/health`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ApiError(ERROR_CODES.INVALID_SERVER_RESPONSE, describeConnectFailure(baseUrl, error));
  }

  const { json, invalid } = await readBody(response);
  const health = json as Partial<HealthDto> | null;
  if (health && (health.status === 'ok' || health.status === 'degraded')) {
    return health as HealthDto;
  }
  const origin = serverOrigin(baseUrl);
  if (invalid) throw new ApiError(ERROR_CODES.INVALID_SERVER_RESPONSE, invalid);
  if (response.status === 404) {
    throw new ApiError(
      ERROR_CODES.INVALID_SERVER_RESPONSE,
      `${origin} 上没有找到 AiMD 服务（/api/health 返回 404）。请确认填写的是部署地址本身，不要带 /api 之类的前缀。`,
    );
  }
  throw new ApiError(
    ERROR_CODES.INVALID_SERVER_RESPONSE,
    `${origin} 返回了意料之外的响应（HTTP ${response.status}）。请确认这是 AiMD 的部署地址，并且服务已启动。`,
  );
}

function describeConnectFailure(baseUrl: string, error: unknown): string {
  const origin = serverOrigin(baseUrl);
  // `AbortSignal.timeout()` rejects with a DOMException, which is *not* an `instanceof Error` in
  // every runtime, so read `name` structurally instead of narrowing by class.
  const name =
    error && typeof error === 'object' && 'name' in error ? String((error as { name: unknown }).name) : '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return `连接 ${origin} 超时（${PROBE_TIMEOUT_MS / 1000} 秒）。请检查服务器是否已启动、端口是否放行。`;
  }
  if (baseUrl.startsWith('http://') && typeof location !== 'undefined' && location.protocol === 'https:') {
    return `无法连接 ${origin}：HTTPS 页面不能请求 http:// 地址（浏览器会按混合内容拦截）。请改用 https:// 部署地址。`;
  }
  return `无法连接 ${origin}：域名解析失败、证书不受信任、服务未启动，或被当前网络拦截。请检查地址与网络后重试。`;
}

/**
 * Probe an address, trying the other scheme when we had to guess it.
 *
 * Returns the address that actually answered, which may differ from the one passed in
 * (`myaimd.top` → `https://myaimd.top`, `192.168.1.20:8080` → `http://192.168.1.20:8080`).
 */
export async function probeServerUrl(url: string, guessedScheme: boolean): Promise<string> {
  try {
    await probeServerHealth(url);
    return url;
  } catch (firstError) {
    if (!guessedScheme) throw firstError;
    const alternate = swapScheme(url);
    if (!alternate) throw firstError;
    try {
      await probeServerHealth(alternate);
      return alternate;
    } catch {
      // Neither scheme answered. Report the first attempt: it is the one the user most likely
      // meant, and two stacked explanations would only obscure the real problem.
      throw firstError;
    }
  }
}

function swapScheme(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') parsed.protocol = 'http:';
    else if (parsed.protocol === 'http:') parsed.protocol = 'https:';
    else return null;
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}
