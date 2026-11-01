import { getState, saveState } from './store.js';

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

let inFlight: Promise<DesktopTokens | null> | null = null;

export async function refreshDesktopSession(): Promise<DesktopTokens | null> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const state = getState();
    const base = state.serverUrl.replace(/\/+$/, '');
    if (!base || !state.refreshToken) return null;
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
      if (!response.ok) return null;
      const payload = (await response.json()) as {
        accessToken?: unknown;
        refreshToken?: unknown;
      };
      if (typeof payload.accessToken !== 'string' || typeof payload.refreshToken !== 'string') {
        return null;
      }
      saveState({
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken,
      });
      return { accessToken: payload.accessToken, refreshToken: payload.refreshToken };
    } catch {
      return null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
