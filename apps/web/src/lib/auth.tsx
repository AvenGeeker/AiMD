import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  BEARER_TRANSPORT,
  ERROR_CODES,
  TOKEN_TRANSPORT_HEADER,
  toApiErrorBody,
  type AuthSessionDto,
  type BearerSessionDto,
  type UserDto,
} from '@aimarkdown/shared';
import { apiBase, normalizeServerUrl } from './config.js';
import {
  clearTokens,
  describeError,
  getAccessToken,
  HttpError,
  initApi,
  probeServerUrl,
  readJsonResponse,
  refreshAccessToken,
  request,
  setTokens,
} from './api.js';
import { getBridge, isDesktop, isMobile } from './platform.js';
import { mobileSetServerUrl } from './mobile.js';
import { syncManager } from './sync.js';
import { forgetRememberedEmail, readRememberedEmail, rememberEmail } from './rememberedAccount.js';

/** Session state shared by the whole app. */

export interface AuthState {
  user: UserDto | null;
  status: 'loading' | 'anonymous' | 'authenticated';
  error: string | null;
  login(email: string, password: string, rememberMe?: boolean): Promise<void>;
  register(
    email: string,
    password: string,
    displayName?: string,
    rememberMe?: boolean,
  ): Promise<void>;
  logout(): Promise<void>;
  /** Server URL the desktop shell is pointed at (empty string for same-origin browser use). */
  baseUrl: string;
  /** Address remembered on this device for prefilling the sign-in form. Never a password. */
  rememberedEmail: string;
  /**
   * Validate, persist and apply a new server address.
   *
   * Resolves with the normalised address that is now in effect, so the caller can show exactly
   * what was stored (`myaimd.top` → `https://myaimd.top`). Rejects — without changing anything —
   * when the address is malformed or does not answer as an AiMD server.
   */
  setBaseUrl(url: string): Promise<string>;
}

const AuthContext = createContext<AuthState | null>(null);

interface SessionPayload {
  user: UserDto;
  accessToken: string;
  refreshToken?: string;
  refreshExpiresIn?: number;
  remembered?: boolean;
}

function isAuthenticationFailure(error: unknown): boolean {
  if (error instanceof HttpError) return error.status === 401 || error.status === 403;
  return false;
}

function transportHeaders(): Record<string, string> {
  // Desktop and mobile have no cookie jar, so both use the bearer transport.
  return isDesktop() || isMobile() ? { [TOKEN_TRANSPORT_HEADER]: BEARER_TRANSPORT } : {};
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [error, setError] = useState<string | null>(null);
  const [baseUrl, setBaseUrlState] = useState('');
  const [rememberedEmail, setRememberedEmail] = useState(() => readRememberedEmail());

  /**
   * Resolve the API base (browser: same origin; desktop/mobile: stored server URL) before
   * attempting a session restore.
   *
   * Boot must never hang on the "正在连接…" spinner: `initApi()` does storage-bridge I/O on
   * mobile, and the `/me` probe can hang against an unreachable host. Every path therefore ends
   * in `anonymous` (the login / server-URL screen) — either normally, on error, or via the
   * watchdog below.
   */
  useEffect(() => {
    let cancelled = false;

    // Watchdog: if boot has not settled within 15s (a hung /me probe, a dead host that never
    // answers, a stuck storage bridge), surface the login/URL screen with an explanation
    // instead of spinning on "正在连接…" forever.
    const watchdog = window.setTimeout(() => {
      if (cancelled) return;
      setError('无法连接服务器，请检查服务器地址与网络后重试');
      setStatus('anonymous');
    }, 15_000);

    void (async () => {
      try {
        const base = await initApi();
        if (cancelled) return;
        setBaseUrlState(base);
        syncManager.configure(base);

        // First launch on desktop/mobile: no server URL configured yet, so a /me probe would
        // be a doomed request against the shell's own origin. Go straight to the URL prompt.
        if ((isDesktop() || isMobile()) && !base) {
          setStatus('anonymous');
          return;
        }

        try {
          const me = await request<{ user: UserDto }>('/me');
          if (cancelled) return;
          setUser(me.user);
          setStatus('authenticated');
          // A browser session lives in an httpOnly cookie, so boot has no access token for the
          // collab WebSocket yet. Mint one before the provider connects, otherwise a reload
          // leaves every document reporting 同步被拒绝 until the user signs in again.
          if (!getAccessToken()) void refreshAccessToken();
        } catch (caught) {
          if (cancelled) return;
          // Only an actual authentication rejection invalidates the stored session. A timeout,
          // offline network, proxy error or 5xx must not erase a valid refresh token: that used to
          // force a password prompt every time the app was opened before the server was reachable.
          if (isAuthenticationFailure(caught)) {
            await clearTokens();
          } else if (toApiErrorBody(caught).code === ERROR_CODES.INVALID_SERVER_RESPONSE) {
            // An address that is not an AiMD server at all is worth saying out loud: it is the one
            // failure the user can fix from this screen.
            setError(describeError(caught));
          } else {
            setError('暂时无法验证登录状态，本机登录信息已保留；请检查网络或服务器后重新打开。');
          }
          setStatus('anonymous');
        }
      } catch {
        // Storage/bridge failure during init (e.g. the WebView's secure-storage bridge). Do
        // not keep the loader spinning — hand over to the login/URL screen.
        if (cancelled) return;
        setStatus('anonymous');
      } finally {
        window.clearTimeout(watchdog);
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(watchdog);
    };
  }, []);

  const applySession = useCallback(async (payload: SessionPayload, rememberMe: boolean) => {
    await setTokens({
      accessToken: payload.accessToken,
      ...(payload.refreshToken !== undefined ? { refreshToken: payload.refreshToken } : {}),
    });
    const nextEmail = rememberMe ? payload.user.email : '';
    if (nextEmail) rememberEmail(nextEmail);
    else forgetRememberedEmail();
    setRememberedEmail(nextEmail);
    setUser(payload.user);
    setStatus('authenticated');
    setError(null);
  }, []);

  const login = useCallback(
    async (email: string, password: string, rememberMe = false) => {
      setError(null);
      try {
        const base = apiBase(baseUrl);
        const response = await fetch(`${base}/auth/login`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json', ...transportHeaders() },
          body: JSON.stringify({ email, password, rememberMe }),
        });
        // `readJsonResponse` maps a non-JSON answer (an HTML page from a wrong address) onto the
        // shared error contract instead of leaking V8's "Unexpected token '<'" into the UI.
        const payload = await readJsonResponse<SessionPayload>(response, '登录失败');
        if (!payload || typeof payload.accessToken !== 'string') {
          throw new Error('登录失败：服务器没有返回登录凭证，请确认服务器地址指向 AiMD 服务');
        }
        await applySession(payload, rememberMe);
      } catch (caught) {
        const message = describeError(caught);
        setError(message);
        throw new Error(message);
      }
    },
    [applySession, baseUrl],
  );

  const register = useCallback(
    async (email: string, password: string, displayName?: string, rememberMe = false) => {
      setError(null);
      try {
        const base = apiBase(baseUrl);
        const response = await fetch(`${base}/auth/register`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json', ...transportHeaders() },
          body: JSON.stringify({ email, password, rememberMe, ...(displayName ? { displayName } : {}) }),
        });
        const payload = await readJsonResponse<SessionPayload>(response, '注册失败');
        if (!payload || typeof payload.accessToken !== 'string') {
          throw new Error('注册失败：服务器没有返回登录凭证，请确认服务器地址指向 AiMD 服务');
        }
        await applySession(payload, rememberMe);
      } catch (caught) {
        const message = describeError(caught);
        setError(message);
        throw new Error(message);
      }
    },
    [applySession, baseUrl],
  );

  const logout = useCallback(async () => {
    try {
      await request('/auth/logout', { method: 'POST', body: {} });
    } catch {
      /* the local sign-out must succeed even if the server call fails */
    }
    await clearTokens();
    syncManager.destroy();
    forgetRememberedEmail();
    setRememberedEmail('');
    setUser(null);
    setStatus('anonymous');
  }, []);

  const setBaseUrlNext = useCallback(async (url: string) => {
    // Empty means "same origin" and is only valid in a browser tab, where the API is served by the
    // very host the page came from. Anything else has to be an absolute http(s) address.
    const localShell = isDesktop() || isMobile();
    let next = url.replace(/\/+$/, '');
    if (localShell || next) {
      const normalized = normalizeServerUrl(url);
      if (!normalized.ok) {
        setError(normalized.message);
        throw new Error(normalized.message);
      }
      next = normalized.url;
      if (localShell) {
        // A shell has no same-origin API, so a wrong address cannot be detected later by the
        // browser: it answers with somebody else's HTML. Verify it now, while the user is still
        // looking at the address field, and refuse to persist an address that is not AiMD.
        try {
          next = await probeServerUrl(next, normalized.guessedScheme);
        } catch (caught) {
          const message = describeError(caught);
          setError(message);
          throw new Error(message);
        }
      }
    }
    const changed = next !== baseUrl;
    const bridge = getBridge();
    if (bridge && isDesktop()) {
      await bridge.setServerUrl(next);
    } else if (isMobile()) {
      await mobileSetServerUrl(next);
    }
    if (changed) {
      // Tokens belong to the previous server. Clear them before initApi() re-reads the
      // storage bridge, so the new session can never accidentally reuse the old credentials.
      await clearTokens();
      syncManager.destroy();
      forgetRememberedEmail();
      setRememberedEmail('');
      setUser(null);
      setStatus('anonymous');
    }
    await initApi({ baseUrl: next });
    setBaseUrlState(next);
    syncManager.configure(next);
    setError(null);
    return next;
  }, [baseUrl]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      status,
      error,
      login,
      register,
      logout,
      baseUrl,
      rememberedEmail,
      setBaseUrl: setBaseUrlNext,
    }),
    [user, status, error, login, register, logout, baseUrl, rememberedEmail, setBaseUrlNext],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export type { AuthSessionDto, BearerSessionDto };
