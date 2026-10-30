import { app, safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Persisted desktop state.
 *
 * Secrets (access/refresh tokens) go through `safeStorage`, which uses the macOS Keychain,
 * Windows DPAPI or libsecret. On a Linux session with no keyring `isEncryptionAvailable()` is
 * false; rather than failing to start, we fall back to a 0600 file in the user data directory and
 * record that we did so, so the UI can warn the user.
 */

export interface PersistedState {
  serverUrl: string;
  accessToken: string | null;
  refreshToken: string | null;
  /** Accelerator currently registered for quick capture. */
  hotkey: string;
  inboxNoteId: string | null;
  stampFormat: string;
  launchAtLogin: boolean;
  minimizeToTray: boolean;
  /** Hide the capture panel when it loses focus. */
  hideOnBlur: boolean;
}

const FILE = 'state.json';

const DEFAULTS: PersistedState = {
  serverUrl: '',
  accessToken: null,
  refreshToken: null,
  hotkey: process.platform === 'darwin' ? 'Alt+Space' : 'Ctrl+Alt+Space',
  inboxNoteId: null,
  stampFormat: 'heading',
  launchAtLogin: false,
  minimizeToTray: true,
  hideOnBlur: true,
};

let cache: PersistedState | null = null;
let usingPlaintextFallback = false;

function filePath(): string {
  return join(app.getPath('userData'), FILE);
}

function encrypt(value: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return `enc:${safeStorage.encryptString(value).toString('base64')}`;
  }
  usingPlaintextFallback = true;
  return `plain:${Buffer.from(value, 'utf8').toString('base64')}`;
}

function decrypt(stored: string): string | null {
  if (stored.startsWith('enc:')) {
    if (!safeStorage.isEncryptionAvailable()) return null;
    try {
      return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
    } catch {
      // Keychain entry from another OS user or a restored profile: treat as signed-out.
      return null;
    }
  }
  if (stored.startsWith('plain:')) {
    usingPlaintextFallback = true;
    return Buffer.from(stored.slice(6), 'base64').toString('utf8');
  }
  return null;
}

export function loadState(): PersistedState {
  if (cache) return cache;
  const path = filePath();
  if (!existsSync(path)) {
    cache = { ...DEFAULTS };
    return cache;
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    const str = (key: keyof PersistedState, fallback: string): string =>
      typeof raw[key] === 'string' ? (raw[key] as string) : fallback;
    const strOrNull = (key: keyof PersistedState): string | null =>
      typeof raw[key] === 'string' ? (raw[key] as string) : null;
    const bool = (key: keyof PersistedState, fallback: boolean): boolean =>
      typeof raw[key] === 'boolean' ? (raw[key] as boolean) : fallback;

    cache = {
      serverUrl: str('serverUrl', DEFAULTS.serverUrl),
      accessToken: decrypt(str('accessToken', '')) ?? null,
      refreshToken: decrypt(str('refreshToken', '')) ?? null,
      hotkey: str('hotkey', DEFAULTS.hotkey),
      inboxNoteId: strOrNull('inboxNoteId'),
      stampFormat: str('stampFormat', DEFAULTS.stampFormat),
      launchAtLogin: bool('launchAtLogin', DEFAULTS.launchAtLogin),
      minimizeToTray: bool('minimizeToTray', DEFAULTS.minimizeToTray),
      hideOnBlur: bool('hideOnBlur', DEFAULTS.hideOnBlur),
    };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

export function saveState(patch: Partial<PersistedState>): PersistedState {
  const next = { ...loadState(), ...patch };
  cache = next;
  const serialised: Record<string, unknown> = {
    serverUrl: next.serverUrl,
    accessToken: next.accessToken ? encrypt(next.accessToken) : '',
    refreshToken: next.refreshToken ? encrypt(next.refreshToken) : '',
    hotkey: next.hotkey,
    inboxNoteId: next.inboxNoteId,
    stampFormat: next.stampFormat,
    launchAtLogin: next.launchAtLogin,
    minimizeToTray: next.minimizeToTray,
    hideOnBlur: next.hideOnBlur,
  };
  const path = filePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(serialised, null, 2), { encoding: 'utf8', mode: 0o600 });
  return next;
}

export function getState(): PersistedState {
  return loadState();
}

/** True when tokens had to be written unencrypted (Linux without a keyring). */
export function isPlaintextFallback(): boolean {
  return usingPlaintextFallback;
}

export function clearTokens(): void {
  saveState({ accessToken: null, refreshToken: null });
}
