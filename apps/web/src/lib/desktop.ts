import type { SettingsDto } from '@aimarkdown/shared';
import type { SyncStatus } from './sync.js';
import { getBridge, isDesktop } from './platform.js';

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
  onHotkeyWarning?(
    callback: (state: { accelerator: string; registered: boolean; error?: string }) => void,
  ): () => void;
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
 * Returns the resulting hotkey registration state so the settings dialog can warn when the
 * accelerator is already owned by another application.
 */
export async function applySettingsToShell(
  settings: SettingsDto,
): Promise<{ accelerator: string; registered: boolean; error?: string } | null> {
  if (!isDesktop()) return null;
  const result = await bridge()?.applySettings?.({ ...settings });
  return (result as { accelerator: string; registered: boolean; error?: string } | undefined) ?? null;
}

export function subscribeHotkeyWarning(
  callback: (state: { accelerator: string; registered: boolean; error?: string }) => void,
): () => void {
  if (!isDesktop()) return () => undefined;
  return bridge()?.onHotkeyWarning?.(callback) ?? (() => undefined);
}
