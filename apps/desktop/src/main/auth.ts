import { clearTokens, getState, saveState } from './store.js';

/**
 * Single-flight token refresh for the desktop shell.
 *
 * The background Apple Notes sync and the renderer's HTTP client must not rotate the same
 * refresh token concurrently — the server invalidates the previous token on rotation. Both
 * paths therefore go through this function on macOS/Windows/Linux desktops.
 */

export interface DesktopTokens {
  accessToken: string;
  refreshToken: string;
}

export type DesktopRefreshResult =
  | ({ ok: true } & DesktopTokens)
  | { ok: false; reason: 'missing' | 'rejected' | 'transient' };

let inFlight: Promise<DesktopRefreshResult> | null = null;

export async function refreshDesktopSession(): Promise<DesktopRefreshResult> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const state = getState();
    const base = state.serverUrl.replace(/\/+$/, '');
    if (!base || !state.refreshToken) return { ok: false, reason: 'missing' };
    try {
      const response = await fetch(`${base}/api/auth/refresh`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-token-transport': 'bearer',
        },
        body: JSON.stringify({ refreshToken: state.refreshToken }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          // The server definitively rejected this refresh token. Clear it so the UI can ask for
          // credentials, but keep transient network/server failures from doing the same.
          clearTokens();
          return { ok: false, reason: 'rejected' };
        }
        return { ok: false, reason: 'transient' };
      }
      const payload = (await response.json()) as {
        accessToken?: unknown;
        refreshToken?: unknown;
      };
      if (typeof payload.accessToken !== 'string' || typeof payload.refreshToken !== 'string') {
        return { ok: false, reason: 'transient' };
      }
      saveState({
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken,
      });
      return { ok: true, accessToken: payload.accessToken, refreshToken: payload.refreshToken };
    } catch {
      return { ok: false, reason: 'transient' };
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
