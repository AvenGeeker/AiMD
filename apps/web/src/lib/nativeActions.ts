/**
 * Native shell actions that do not carry a payload.
 *
 * Home-screen widgets launch the app and call `window.__aimdOpenFavorite()`. The function is
 * installed before React mounts so a cold launch cannot lose the request; the event lets a live
 * workspace react immediately, while the stored flag survives the login screen or a reload.
 */

const PENDING_KEY = 'aimarkdown.pending-open-favorite';
const EVENT = 'aimarkdown:open-favorite';
let pendingInMemory = false;

declare global {
  interface Window {
    __aimdOpenFavorite?: () => void;
  }
}

export function requestOpenFavorite(): void {
  pendingInMemory = true;
  try {
    window.localStorage.setItem(PENDING_KEY, '1');
  } catch {
    // In-memory delivery still works when private mode blocks storage.
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function consumeOpenFavoriteRequest(): boolean {
  let stored = false;
  try {
    stored = window.localStorage.getItem(PENDING_KEY) === '1';
    if (stored) window.localStorage.removeItem(PENDING_KEY);
  } catch {
    // Fall back to the in-memory flag below.
  }
  const pending = pendingInMemory || stored;
  pendingInMemory = false;
  return pending;
}

export function subscribeOpenFavorite(callback: () => void): () => void {
  window.addEventListener(EVENT, callback);
  return () => window.removeEventListener(EVENT, callback);
}

export function installNativeActions(): void {
  if (typeof window === 'undefined') return;
  window.__aimdOpenFavorite = requestOpenFavorite;
}
