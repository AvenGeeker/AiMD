import type { SettingsDto } from '@aimarkdown/shared';
import type { SyncStatus } from './sync.js';
import {
  getBridge,
  isDesktop,
  type HotkeyStates,
  type MenuCommand,
  type MenuStateSnapshot,
} from './platform.js';

/**
 * Web-bundle ↔ Electron-shell integration.
 *
 * Everything here is a no-op in a plain browser tab, so the same components run unchanged on both
 * surfaces. The shell needs two things it cannot observe on its own: current sync state (for the
 * tray label) and the user's synced settings (so the global hotkey follows whatever was changed on
 * any device, since settings live in the CRDT workspace document).
 */

interface ExtendedBridge {
  reportSyncStatus?(payload: { status: string; pending: number }): void;
  applySettings?(settings: Record<string, unknown>): Promise<unknown>;
  onHotkeyWarning?(callback: (states: HotkeyStates) => void): () => void;
}

function bridge(): (ReturnType<typeof getBridge> & Partial<ExtendedBridge>) | null {
  return getBridge() as (ReturnType<typeof getBridge> & Partial<ExtendedBridge>) | null;
}

export function reportSyncStatus(status: SyncStatus, pending: number): void {
  if (!isDesktop()) return;
  bridge()?.reportSyncStatus?.({ status, pending });
}

/**
 * Push settings into the shell.
 *
 * Returns both registration results so the settings dialog can warn when an accelerator is
 * already owned by another application.
 */
export async function applySettingsToShell(
  settings: SettingsDto,
): Promise<HotkeyStates | null> {
  if (!isDesktop()) return null;
  const result = await bridge()?.applySettings?.({ ...settings });
  return (result as { hotkeys?: HotkeyStates } | undefined)?.hotkeys ?? null;
}

export function subscribeHotkeyWarning(callback: (states: HotkeyStates) => void): () => void {
  if (!isDesktop()) return () => undefined;
  return bridge()?.onHotkeyWarning?.(callback) ?? (() => undefined);
}

/**
 * Mirror the TitleBar state into the native menu.
 *
 * The menu is a second surface for the same actions: mode radio items, rail checkboxes, sync
 * status and account details stay correct only while the renderer keeps reporting them.
 */
export function reportMenuState(state: Partial<MenuStateSnapshot>): void {
  if (!isDesktop()) return;
  getBridge()?.reportMenuState?.(state);
}

/** Release menu clicks queued while the workspace was still mounting. */
export function markMenuReady(): void {
  if (!isDesktop()) return;
  getBridge()?.menuReady?.();
}

/** Subscribe to native menu commands; returns an unsubscribe function. */
export function subscribeMenuCommands(
  callback: (command: MenuCommand) => void,
): () => void {
  if (!isDesktop()) return () => undefined;
  return getBridge()?.onMenuCommand?.(callback) ?? (() => undefined);
}

/** Open an external URL in the system browser; the shell validates the scheme again. */
export async function openExternalUrl(url: string): Promise<boolean> {
  if (!isDesktop()) {
    const opened = window.open(url, '_blank');
    if (!opened) return false;
    // Keep the public page from reaching back into the app window.
    try {
      opened.opener = null;
    } catch {
      // Cross-origin windows can refuse the assignment; opening still succeeded.
    }
    return true;
  }
  return (await bridge()?.openExternal?.(url)) ?? false;
}
