import { app, safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppleNotesSchedule, AppleNotesSyncResult } from '@aimarkdown/shared';

/**
 * Persisted desktop state.
 *
 * Secrets (access/refresh tokens) go through `safeStorage`, which uses the macOS Keychain,
 * Windows DPAPI or libsecret. On a Linux session with no keyring `isEncryptionAvailable()` is
 * false; rather than failing to start, we fall back to a 0600 file in the user data directory and
 * record that we did so, so the UI can warn the user.
 */

export interface PersistedState {
  /** Stable per-install id; useful for logs and future sync-host election. */
  deviceId: string;
  serverUrl: string;
  accessToken: string | null;
  refreshToken: string | null;
  /** Accelerator currently registered for the quick-capture (data-entry) window. */
  hotkey: string;
  /** Accelerator currently registered for bringing the main window forward. */
  mainWindowHotkey: string;
  /** Accelerator for the global quick-favourite action. */
  favoriteHotkey: string;
  inboxNoteId: string | null;
  stampFormat: string;
  launchAtLogin: boolean;
  minimizeToTray: boolean;
  /** Hide the capture panel when it loses focus. */
  hideOnBlur: boolean;
  /** macOS Notes integration is intentionally local to this Mac. */
  appleNotesEnabled: boolean;
  appleNotesSchedule: AppleNotesSchedule;
  appleNotesSyncOnLaunch: boolean;
  appleNotesFirstSyncConfirmedAt: string | null;
  appleNotesLastSyncAt: string | null;
  appleNotesLastResult: AppleNotesSyncResult | null;
}

const FILE = 'state.json';

const DEFAULTS: PersistedState = {
  deviceId: '',
  serverUrl: '',
  accessToken: null,
  refreshToken: null,
  hotkey: process.platform === 'darwin' ? 'Alt+Space' : 'Ctrl+Alt+Space',
  // Keep defaults local: the packaged main process must not require the workspace package at runtime.
  mainWindowHotkey: 'CommandOrControl+Shift+M',
  favoriteHotkey: 'CommandOrControl+Shift+F',
  inboxNoteId: null,
  stampFormat: 'heading',
  launchAtLogin: false,
  minimizeToTray: true,
  hideOnBlur: true,
  appleNotesEnabled: false,
  appleNotesSchedule: '30m',
  appleNotesSyncOnLaunch: true,
  appleNotesFirstSyncConfirmedAt: null,
  appleNotesLastSyncAt: null,
  appleNotesLastResult: null,
};

let cache: PersistedState | null = null;
let usingPlaintextFallback = false;

const APPLE_NOTES_SCHEDULES = new Set(['off', '15m', '30m', '1h', '6h', 'daily']);

function appleNotesSchedule(value: unknown, fallback: AppleNotesSchedule): AppleNotesSchedule {
  return typeof value === 'string' && APPLE_NOTES_SCHEDULES.has(value)
    ? (value as AppleNotesSchedule)
    : fallback;
}

function resultOrNull(value: unknown): AppleNotesSyncResult | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<AppleNotesSyncResult>;
  return typeof candidate.startedAt === 'string' && typeof candidate.finishedAt === 'string'
    ? (candidate as AppleNotesSyncResult)
    : null;
}

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
    cache = { ...DEFAULTS, deviceId: randomUUID() };
    saveState({});
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
      deviceId: str('deviceId', '') || randomUUID(),
      serverUrl: str('serverUrl', DEFAULTS.serverUrl),
      accessToken: decrypt(str('accessToken', '')) ?? null,
      refreshToken: decrypt(str('refreshToken', '')) ?? null,
      hotkey: str('hotkey', DEFAULTS.hotkey),
      mainWindowHotkey: str('mainWindowHotkey', DEFAULTS.mainWindowHotkey),
      favoriteHotkey: str('favoriteHotkey', DEFAULTS.favoriteHotkey),
      inboxNoteId: strOrNull('inboxNoteId'),
      stampFormat: str('stampFormat', DEFAULTS.stampFormat),
      launchAtLogin: bool('launchAtLogin', DEFAULTS.launchAtLogin),
      minimizeToTray: bool('minimizeToTray', DEFAULTS.minimizeToTray),
      hideOnBlur: bool('hideOnBlur', DEFAULTS.hideOnBlur),
      appleNotesEnabled: bool('appleNotesEnabled', DEFAULTS.appleNotesEnabled),
      appleNotesSchedule: appleNotesSchedule(raw.appleNotesSchedule, DEFAULTS.appleNotesSchedule),
      appleNotesSyncOnLaunch: bool('appleNotesSyncOnLaunch', DEFAULTS.appleNotesSyncOnLaunch),
      appleNotesFirstSyncConfirmedAt: strOrNull('appleNotesFirstSyncConfirmedAt'),
      appleNotesLastSyncAt: strOrNull('appleNotesLastSyncAt'),
      appleNotesLastResult: resultOrNull(raw.appleNotesLastResult),
    };
  } catch {
    cache = { ...DEFAULTS, deviceId: randomUUID() };
  }
  return cache;
}

export function saveState(patch: Partial<PersistedState>): PersistedState {
  const next = { ...loadState(), ...patch };
  cache = next;
  const serialised: Record<string, unknown> = {
    deviceId: next.deviceId,
    serverUrl: next.serverUrl,
    accessToken: next.accessToken ? encrypt(next.accessToken) : '',
    refreshToken: next.refreshToken ? encrypt(next.refreshToken) : '',
    hotkey: next.hotkey,
    mainWindowHotkey: next.mainWindowHotkey,
    favoriteHotkey: next.favoriteHotkey,
    inboxNoteId: next.inboxNoteId,
    stampFormat: next.stampFormat,
    launchAtLogin: next.launchAtLogin,
    minimizeToTray: next.minimizeToTray,
    hideOnBlur: next.hideOnBlur,
    appleNotesEnabled: next.appleNotesEnabled,
    appleNotesSchedule: next.appleNotesSchedule,
    appleNotesSyncOnLaunch: next.appleNotesSyncOnLaunch,
    appleNotesFirstSyncConfirmedAt: next.appleNotesFirstSyncConfirmedAt,
    appleNotesLastSyncAt: next.appleNotesLastSyncAt,
    appleNotesLastResult: next.appleNotesLastResult,
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
