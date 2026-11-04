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

export type SyncStateLoadResult =
  | { status: 'ok'; state: AppleNotesState }
  | { status: 'missing' }
  | { status: 'namespace-mismatch'; namespace: SyncNamespace }
  | { status: 'corrupt'; backupPath: string | null };

/**
 * Inspect the mapping without conflating a missing/corrupt file with one that belongs to a
 * different server or account. The latter is a normal consequence of switching servers and must
 * go through a fresh preview rather than being reported as file corruption.
 */
export function readSyncState(namespace: SyncNamespace): SyncStateLoadResult {
  const file = path();
  if (!existsSync(file)) return { status: 'missing' };
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as AppleNotesState;
    if (raw?.version !== 1 || !raw.namespace) {
      return { status: 'corrupt', backupPath: backupFile(file, 'corrupt') };
    }
    if (!sameNamespace(raw.namespace, namespace)) {
      return { status: 'namespace-mismatch', namespace: raw.namespace };
    }
    return {
      status: 'ok',
      state: {
        ...emptyState(namespace),
        ...raw,
        folders: raw.folders ?? {},
        notes: raw.notes ?? {},
        attachmentCache: raw.attachmentCache ?? {},
        readOnly: raw.readOnly ?? {},
      },
    };
  } catch {
    // Preserve the damaged file for inspection instead of silently overwriting a mapping that
    // may be the only record of which Apple note belongs to which app note.
    return { status: 'corrupt', backupPath: backupFile(file, 'corrupt') };
  }
}

/** Load the mapping only when it belongs to the same server/user/Apple account. */
export function loadSyncState(namespace: SyncNamespace): AppleNotesState | null {
  const result = readSyncState(namespace);
  return result.status === 'ok' ? result.state : null;
}

function backupFile(file: string, reason: string): string | null {
  const backup = `${file}.${reason}-${Date.now()}`;
  try {
    renameSync(file, backup);
    return backup;
  } catch {
    return null;
  }
}

function storedNamespace(file: string): { namespace: SyncNamespace | null; valid: boolean } {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as AppleNotesState;
    return {
      namespace: raw?.version === 1 && raw.namespace ? raw.namespace : null,
      valid: raw?.version === 1 && Boolean(raw.namespace),
    };
  } catch {
    return { namespace: null, valid: false };
  }
}

/**
 * Resolve the Apple note ids linked to a set of app note ids.
 *
 * `state.notes` is keyed by Apple id; looking it up directly with an app id silently returns
 * undefined. That broke the post-write hash refresh and made every synced note look changed on
 * the next run, which turned into a new conflict copy on every sync.
 */
export function appleIdsForAppIds(
  state: AppleNotesState,
  appIds: Iterable<string>,
): string[] {
  const wanted = new Set(appIds);
  const out = new Set<string>();
  for (const link of Object.values(state.notes)) {
    if (wanted.has(link.appId)) out.add(link.appleId);
  }
  return [...out];
}

export function saveSyncState(state: AppleNotesState): void {
  const file = path();
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file)) {
    const existing = storedNamespace(file);
    // Switching server/account must never destroy the previous mapping on the first write.
    if (!existing.valid || (existing.namespace && !sameNamespace(existing.namespace, state.namespace))) {
      backupFile(file, existing.valid ? 'namespace-backup' : 'corrupt');
    }
  }
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temp, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(temp, file);
}
