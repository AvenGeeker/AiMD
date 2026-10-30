import { describe, expect, it } from 'vitest';
import {
  canAccessWorkspaceDoc,
  noteDocName,
  parseDocName,
  workspaceDocName,
  NOTE_KEYS,
  WORKSPACE_KEYS,
  DEFAULT_SETTINGS,
  initialWorkspaceMeta,
} from '../src/crdt.js';
import { CRDT_SCHEMA_VERSION, INBOX_NOTE_TITLE } from '../src/constants.js';

describe('document naming', () => {
  it('round-trips a note doc name', () => {
    expect(noteDocName('abc123')).toBe('note-abc123');
    expect(parseDocName(noteDocName('abc123'))).toEqual({ kind: 'note', id: 'abc123', raw: 'note-abc123' });
  });

  it('round-trips a workspace doc name', () => {
    expect(workspaceDocName('u_1-XYZ')).toBe('workspace-u_1-XYZ');
    expect(parseDocName('workspace-u_1-XYZ')).toEqual({ kind: 'workspace', id: 'u_1-XYZ', raw: 'workspace-u_1-XYZ' });
  });

  it('rejects malformed ids so a doc name can never alias another tenant', () => {
    expect(parseDocName('note-').kind).toBe('unknown');
    expect(parseDocName('note-a/b').kind).toBe('unknown');
    expect(parseDocName('note-a.b').kind).toBe('unknown');
    expect(parseDocName('note-a b').kind).toBe('unknown');
    expect(parseDocName('note-' + 'x'.repeat(65)).kind).toBe('unknown');
    expect(parseDocName('WORKSPACE-abc').kind).toBe('unknown');
    expect(parseDocName('note-abc/def').kind).toBe('unknown');
    expect(parseDocName('').kind).toBe('unknown');
    expect(parseDocName('random-thing').kind).toBe('unknown');
  });

  it('treats a nested-looking workspace id as an opaque id, not as a note doc', () => {
    // `note-abc` is a legal nanoid-shaped *user* id, so this is a valid workspace doc name.
    // Safety comes from `canAccessWorkspaceDoc` comparing the id for exact equality against
    // the authenticated user, never from prefix sniffing.
    expect(parseDocName('workspace-note-abc')).toEqual({
      kind: 'workspace',
      id: 'note-abc',
      raw: 'workspace-note-abc',
    });
    expect(canAccessWorkspaceDoc('workspace-note-abc', 'note-abc')).toBe(true);
    expect(canAccessWorkspaceDoc('workspace-note-abc', 'u1')).toBe(false);
  });

  it('accepts nanoid-shaped ids', () => {
    const id = 'V1StGXR8_Z5jdHi6B-myT';
    expect(parseDocName(noteDocName(id))).toMatchObject({ kind: 'note', id });
  });

  it('does not let a path traversal escape the prefix', () => {
    expect(parseDocName('note-../../etc/passwd').kind).toBe('unknown');
    expect(parseDocName('workspace-../other').kind).toBe('unknown');
  });
});

describe('workspace access control', () => {
  it('allows the owner', () => {
    expect(canAccessWorkspaceDoc('workspace-u1', 'u1')).toBe(true);
  });

  it('denies another user', () => {
    expect(canAccessWorkspaceDoc('workspace-u1', 'u2')).toBe(false);
  });

  it('denies note docs (they are checked against notes.owner_id instead)', () => {
    expect(canAccessWorkspaceDoc('note-n1', 'u1')).toBe(false);
  });

  it('denies malformed docs', () => {
    expect(canAccessWorkspaceDoc('workspace-', 'u1')).toBe(false);
    expect(canAccessWorkspaceDoc('garbage', 'u1')).toBe(false);
  });
});

describe('document shape constants', () => {
  it('uses distinct keys for note body and meta', () => {
    expect(NOTE_KEYS.body).toBe('body');
    expect(NOTE_KEYS.meta).toBe('meta');
    expect(WORKSPACE_KEYS.folders).toBe('folders');
    expect(WORKSPACE_KEYS.tags).toBe('tags');
    expect(WORKSPACE_KEYS.settings).toBe('settings');
    // No collision between the two document kinds' key namespaces.
    const noteKeys = Object.values(NOTE_KEYS);
    const wsKeys = Object.values(WORKSPACE_KEYS);
    expect(new Set([...noteKeys, ...wsKeys]).size).toBe(noteKeys.length + wsKeys.length - 1); // 'meta' shared by design
  });

  it('provides complete default settings', () => {
    expect(DEFAULT_SETTINGS.inboxNoteId).toBeNull();
    expect(DEFAULT_SETTINGS.hotkey).toBe('Alt+Space');
    expect(DEFAULT_SETTINGS.editorMode).toBe('split');
    expect(DEFAULT_SETTINGS.stampFormat).toBe('heading');
    expect(DEFAULT_SETTINGS.fontSize).toBe(14);
  });

  it('stamps the schema version and inbox title into a new workspace', () => {
    expect(initialWorkspaceMeta()).toEqual({
      schemaVersion: CRDT_SCHEMA_VERSION,
      inboxTitle: INBOX_NOTE_TITLE,
    });
  });
});
