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
import { isDesktop, getBridge } from './platform.js';
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
  return isDesktop() ? { [TOKEN_TRANSPORT_HEADER]: BEARER_TRANSPORT } : {};
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [error, setError] = useState<string | null>(null);
  const [baseUrl, setBaseUrlState] = useState('');

  // Resolve the API base (desktop reads it from the shell) before attempting a session restore.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const base = await initApi();
      if (cancelled) return;
      setBaseUrlState(base);
      syncManager.configure(base);
      try {
        const me = await request<{ user: UserDto }>('/me');
        if (cancelled) return;
        setUser(me.user);
        setStatus('authenticated');
      } catch {
        if (cancelled) return;
        clearTokens();
        setStatus('anonymous');
      }
    })();
    return () => {
      cancelled = true;
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
    clearTokens();
    syncManager.destroy();
    setUser(null);
    setStatus('anonymous');
  }, []);

  const setBaseUrlNext = useCallback(async (url: string) => {
    const next = url.replace(/\/+$/, '');
    const bridge = getBridge();
    if (bridge && isDesktop()) {
      await bridge.setServerUrl(next);
    }
    await initApi({ baseUrl: next });
    setBaseUrlState(next);
    syncManager.configure(next);
  }, []);

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
