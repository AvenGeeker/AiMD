import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronState = vi.hoisted(() => ({ userData: '' }));

vi.mock('electron', () => ({
  app: { getPath: () => electronState.userData },
}));

import {
  emptyState,
  readSyncState,
  saveSyncState,
  type AppleNotesState,
  type SyncNamespace,
} from '../src/main/apple-notes/state.js';

const namespace: SyncNamespace = {
  serverUrl: 'https://myaimd.top',
  userId: 'u-test',
  appleAccountId: 'account-1',
};

function stateFile(): string {
  return join(electronState.userData, 'apple-notes-sync.json');
}

describe('apple notes sync state', () => {
  beforeEach(() => {
    electronState.userData = mkdtempSync(join(tmpdir(), 'aimd-apple-notes-state-'));
  });

  afterEach(() => {
    rmSync(electronState.userData, { recursive: true, force: true });
  });

  it('reports a genuinely missing mapping distinctly', () => {
    expect(readSyncState(namespace)).toEqual({ status: 'missing' });
  });

  it('loads a mapping for the current namespace', () => {
    saveSyncState(emptyState(namespace));
    const result = readSyncState(namespace);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.state.namespace).toEqual(namespace);
  });

  it('reports a mapping from another namespace instead of calling it corrupt', () => {
    saveSyncState(emptyState({ ...namespace, serverUrl: 'http://127.0.0.1:8080' }));
    const result = readSyncState(namespace);
    expect(result.status).toBe('namespace-mismatch');
    if (result.status === 'namespace-mismatch') {
      expect(result.namespace.serverUrl).toBe('http://127.0.0.1:8080');
    }
    expect(existsSync(stateFile())).toBe(true);
  });

  it('backs up damaged JSON before reporting corruption', () => {
    writeFileSync(stateFile(), '{not json', 'utf8');
    const result = readSyncState(namespace);
    expect(result.status).toBe('corrupt');
    if (result.status === 'corrupt') {
      expect(result.backupPath).toBeTruthy();
      expect(existsSync(result.backupPath!)).toBe(true);
    }
    expect(existsSync(stateFile())).toBe(false);
  });

  it('preserves the previous namespace mapping when saving a rebuilt one', () => {
    const previous = emptyState({ ...namespace, serverUrl: 'http://127.0.0.1:8080' });
    previous.notes.apple1 = {
      appleId: 'apple1',
      appId: 'app1',
      appleFolderId: null,
      lastAppleHash: 'a',
      lastAppHash: 'b',
      lastAppleModifiedAt: null,
      lastAppleMetaHash: null,
      lastAppUpdatedAt: '2026-01-01T00:00:00.000Z',
      tombstone: null,
      readOnlyReason: null,
    };
    saveSyncState(previous);

    saveSyncState(emptyState(namespace));

    const backups = readdirSync(electronState.userData)
      .filter((name) => name.includes('.namespace-backup-'));
    expect(backups).toHaveLength(1);
    const backup = JSON.parse(readFileSync(join(electronState.userData, backups[0]!), 'utf8')) as AppleNotesState;
    expect(backup.namespace.serverUrl).toBe('http://127.0.0.1:8080');
    expect(backup.notes.apple1?.appId).toBe('app1');
    const current = readSyncState(namespace);
    expect(current.status).toBe('ok');
  });
});
