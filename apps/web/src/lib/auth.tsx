import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  BEARER_TRANSPORT,
  TOKEN_TRANSPORT_HEADER,
  type AuthSessionDto,
  type BearerSessionDto,
  type UserDto,
} from '@aimarkdown/shared';
import { apiBase } from './config.js';
import { clearTokens, describeError, initApi, request, setTokens } from './api.js';
import { getBridge, isDesktop, isMobile } from './platform.js';
import { mobileSetServerUrl } from './mobile.js';
import { syncManager } from './sync.js';

/** Session state shared by the whole app. */

export interface AuthState {
  user: UserDto | null;
  status: 'loading' | 'anonymous' | 'authenticated';
  error: string | null;
  login(email: string, password: string): Promise<void>;
  register(email: string, password: string, displayName?: string): Promise<void>;
  logout(): Promise<void>;
  /** Server URL the desktop shell is pointed at (empty string for same-origin browser use). */
  baseUrl: string;
  setBaseUrl(url: string): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

interface SessionPayload {
  user: UserDto;
  accessToken: string;
  refreshToken?: string;
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
        } catch {
          if (cancelled) return;
          await clearTokens();
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

  const applySession = useCallback(async (payload: SessionPayload) => {
    await setTokens({
      accessToken: payload.accessToken,
      ...(payload.refreshToken !== undefined ? { refreshToken: payload.refreshToken } : {}),
    });
    setUser(payload.user);
    setStatus('authenticated');
    setError(null);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      setError(null);
      try {
        const base = apiBase(baseUrl);
        const response = await fetch(`${base}/auth/login`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json', ...transportHeaders() },
          body: JSON.stringify({ email, password }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new Error(body?.message ?? '登录失败');
        }
        await applySession((await response.json()) as SessionPayload);
      } catch (caught) {
        const message = describeError(caught);
        setError(message);
        throw new Error(message);
      }
    },
    [applySession, baseUrl],
  );

  const register = useCallback(
    async (email: string, password: string, displayName?: string) => {
      setError(null);
      try {
        const base = apiBase(baseUrl);
        const response = await fetch(`${base}/auth/register`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json', ...transportHeaders() },
          body: JSON.stringify({ email, password, ...(displayName ? { displayName } : {}) }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new Error(body?.message ?? '注册失败');
        }
        await applySession((await response.json()) as SessionPayload);
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
    setUser(null);
    setStatus('anonymous');
  }, []);

  const setBaseUrlNext = useCallback(async (url: string) => {
    const next = url.replace(/\/+$/, '');
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
      setUser(null);
      setStatus('anonymous');
    }
    await initApi({ baseUrl: next });
    setBaseUrlState(next);
    syncManager.configure(next);
    setError(null);
  }, [baseUrl]);

  const value = useMemo<AuthState>(
    () => ({ user, status, error, login, register, logout, baseUrl, setBaseUrl: setBaseUrlNext }),
    [user, status, error, login, register, logout, baseUrl, setBaseUrlNext],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export type { AuthSessionDto, BearerSessionDto };
