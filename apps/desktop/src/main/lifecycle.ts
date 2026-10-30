/**
 * Quit intent.
 *
 * The window `close` handler needs to distinguish "hide to the tray" from "really exit". Electron's
 * own `App` type already declares members, so rather than augmenting it we keep an explicit flag —
 * it is also easier to reason about and to reset in tests.
 */
let quitting = false;

export function isQuitting(): boolean {
  return quitting;
}

export function setQuitting(value = true): void {
  quitting = value;
}
