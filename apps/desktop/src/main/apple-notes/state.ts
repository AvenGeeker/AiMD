import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface SyncNamespace {
  serverUrl: string;
  userId: string;
  appleAccountId: string;
}

export interface FolderLink {
  appleId: string;
  appId: string;
  lastAppleName: string;
  lastAppleParentId: string | null;
  lastAppName: string;
  lastAppParentId: string | null;
}

export interface NoteLink {
  appleId: string;
  appId: string;
  appleFolderId: string | null;
  lastAppleHash: string;
  lastAppHash: string;
  lastAppleModifiedAt: string | null;
  lastAppleMetaHash: string | null;
  lastAppUpdatedAt: string;
  tombstone: 'apple-deleted' | 'app-deleted' | null;
  readOnlyReason: string | null;
}

export interface AppleNotesState {
  version: 1;
  namespace: SyncNamespace;
  rootAppleFolderId: string | null;
  managedTrashFolderId: string | null;
  folders: Record<string, FolderLink>;
  notes: Record<string, NoteLink>;
  attachmentCache: Record<string, string>;
  readOnly: Record<string, { reason: string; appleId: string; appId: string; since: string }>;
  lastFullScanAt: string | null;
}

const FILE = 'apple-notes-sync.json';

export function sameNamespace(a: SyncNamespace, b: SyncNamespace): boolean {
  return a.serverUrl === b.serverUrl && a.userId === b.userId && a.appleAccountId === b.appleAccountId;
}

export function emptyState(namespace: SyncNamespace): AppleNotesState {
  return {
    version: 1,
    namespace,
    rootAppleFolderId: null,
    managedTrashFolderId: null,
    folders: {},
    notes: {},
    attachmentCache: {},
    readOnly: {},
    lastFullScanAt: null,
  };
}

function path(): string {
  return join(app.getPath('userData'), FILE);
}

/** Load the mapping only when it belongs to the same server/user/Apple account. */
export function loadSyncState(namespace: SyncNamespace): AppleNotesState | null {
  const file = path();
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as AppleNotesState;
    if (raw?.version !== 1 || !raw.namespace || !sameNamespace(raw.namespace, namespace)) return null;
    return {
      ...emptyState(namespace),
      ...raw,
      folders: raw.folders ?? {},
      notes: raw.notes ?? {},
      attachmentCache: raw.attachmentCache ?? {},
      readOnly: raw.readOnly ?? {},
    };
  } catch {
    // Preserve the damaged file for inspection instead of silently overwriting a mapping that
    // may be the only record of which Apple note belongs to which app note.
    const backup = `${file}.corrupt-${Date.now()}`;
    try { renameSync(file, backup); } catch { /* ignore */ }
    return null;
  }
}

export function saveSyncState(state: AppleNotesState): void {
  const file = path();
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temp, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(temp, file);
}
