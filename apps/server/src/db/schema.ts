/**
 * Row types for `migrations/0001_init.sql`.
 *
 * These are compile-time documentation of the DDL, not a runtime schema. The authoritative DDL
 * is the SQL migration; `test/integration/schema.test.ts` asserts the live database matches
 * these shapes so the two cannot silently drift.
 */

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  is_admin: boolean;
  created_at: Date;
}

export interface FolderRow {
  id: string;
  owner_id: string;
  parent_id: string | null;
  name: string;
  position: string;
  created_at: Date;
  updated_at: Date;
}

export interface NoteRow {
  id: string;
  owner_id: string;
  folder_id: string | null;
  title: string;
  body_text: string;
  is_pinned: boolean;
  is_archived: boolean;
  deleted_at: Date | null;
  position: string;
  word_count: number;
  created_at: Date;
  content_updated_at: Date;
  updated_at: Date;
}

/** The CRDT document. `ydoc` is the authoritative state for a note's content and metadata. */
export interface NoteDocumentRow {
  note_id: string;
  ydoc: Uint8Array;
  updated_at: Date;
}

/** The per-user CRDT document: folder tree, tag definitions and settings. */
export interface WorkspaceDocumentRow {
  user_id: string;
  ydoc: Uint8Array;
  updated_at: Date;
}

export interface UserSettingsRow {
  user_id: string;
  settings: Record<string, unknown>;
  updated_at: Date;
}

export interface TagRow {
  id: string;
  owner_id: string;
  name: string;
  color: string;
}

export interface NoteTagRow {
  note_id: string;
  tag_id: string;
}

export interface AttachmentRow {
  id: string;
  owner_id: string;
  note_id: string | null;
  filename: string;
  mime: string;
  size: number;
  storage_key: string;
  created_at: Date;
}

export interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  user_agent: string | null;
  created_at: Date;
}

/** Every table the application owns, used by the schema test and by `truncateAll`. */
export const TABLES = [
  'users',
  'folders',
  'notes',
  'note_documents',
  'workspace_documents',
  'user_settings',
  'tags',
  'note_tags',
  'attachments',
  'refresh_tokens',
] as const;

export type TableName = (typeof TABLES)[number];

/** Columns each table must expose, asserted against `information_schema` in tests. */
export const EXPECTED_COLUMNS: Record<TableName, readonly string[]> = {
  users: ['id', 'email', 'password_hash', 'display_name', 'is_admin', 'created_at'],
  folders: ['id', 'owner_id', 'parent_id', 'name', 'position', 'created_at', 'updated_at'],
  notes: [
    'id', 'owner_id', 'folder_id', 'title', 'body_text', 'is_pinned', 'is_archived',
    'deleted_at', 'position', 'word_count', 'created_at', 'content_updated_at', 'updated_at',
  ],
  note_documents: ['note_id', 'ydoc', 'updated_at'],
  workspace_documents: ['user_id', 'ydoc', 'updated_at'],
  user_settings: ['user_id', 'settings', 'updated_at'],
  tags: ['id', 'owner_id', 'name', 'color'],
  note_tags: ['note_id', 'tag_id'],
  attachments: ['id', 'owner_id', 'note_id', 'filename', 'mime', 'size', 'storage_key', 'created_at'],
  refresh_tokens: ['id', 'user_id', 'token_hash', 'expires_at', 'revoked_at', 'user_agent', 'created_at'],
};
