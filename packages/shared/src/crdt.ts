import {
  CRDT_SCHEMA_VERSION,
  DEFAULT_HOTKEY,
  DEFAULT_MAIN_WINDOW_HOTKEY,
  DEFAULT_FAVORITE_HOTKEY,
  THEMES,
  EDITOR_MODES,
  STAMP_FORMATS,
  INBOX_NOTE_TITLE,
} from './constants.js';
import type { AiStatus } from './ai.js';

/**
 * CRDT document naming + structure.
 *
 * There are exactly two kinds of Y.Doc:
 *  - `note-{noteId}`      one per note. Holds the markdown body and note-level metadata.
 *  - `workspace-{userId}` one per user. Holds the folder tree, tag definitions and settings.
 *
 * Postgres mirrors a projection of both so that listing, searching and rendering the tree
 * never require materialising a Y.Doc.
 */

export const NOTE_DOC_PREFIX = 'note-';
export const WORKSPACE_DOC_PREFIX = 'workspace-';

/** Y.Doc sub-document keys for a note document. */
export const NOTE_KEYS = {
  /** `Y.Text` — the raw markdown source. The single source of truth for note content. */
  body: 'body',
  /**
   * `Y.Map` of scalar note metadata: title, titleManual, folderId, pinned, archived,
   * deletedAt, position, createdAt.
   */
  meta: 'meta',
  /**
   * `Y.Array<string>` of tag ids.
   *
   * Kept as a top-level array rather than a field inside `meta` so that adding a tag on one
   * device and removing a different tag on another merge element-wise instead of one device
   * clobbering the other's whole list.
   */
  tagIds: 'tagIds',
  /** `Y.Map` of AI summary state. Scalar values only; key points are stored as a JSON string. */
  ai: 'ai',
  /** `Y.Map<AiTodoEntry>` keyed by stable todo id so concurrent checkbox toggles merge. */
  aiTodos: 'aiTodos',
  /** `Y.Map<string | null>` source metadata for link/media favourites. */
  source: 'source',
  /** `Y.Map<string | null>` OCR/ASR processing state for favourites. */
  media: 'media',
} as const;

/** Y.Doc sub-document keys for a workspace document. */
export const WORKSPACE_KEYS = {
  /** `Y.Map<FolderEntry>` keyed by folderId */
  folders: 'folders',
  /** `Y.Map<TagEntry>` keyed by tagId */
  tags: 'tags',
  /** `Y.Map<WorkspaceSettings>` */
  settings: 'settings',
  /** `Y.Map<{ schemaVersion: number }>` */
  meta: 'meta',
} as const;

export interface NoteMeta {
  title: string;
  /** `null` means "root level" (no folder). */
  folderId: string | null;
  tagIds: string[];
  pinned: boolean;
  archived: boolean;
  /** Soft-delete tombstone. `null` when the note is alive. */
  deletedAt: string | null;
  /** Fractional index key controlling manual ordering inside a folder. */
  position: string;
  /** ISO timestamp, set once at creation. */
  createdAt: string;
}

export interface FolderEntry {
  id: string;
  name: string;
  parentId: string | null;
  position: string;
  createdAt: string;
}

export interface TagEntry {
  id: string;
  name: string;
  color: string;
}

/** Scalar fields stored in a note doc's `meta` map. */
export interface NoteMetaMap {
  title: string;
  /**
   * False while the title is derived from the body (first heading / first line). Set to true
   * the moment the user types a title, after which the body no longer overrides it.
   */
  titleManual: boolean;
  folderId: string | null;
  pinned: boolean;
  archived: boolean;
  deletedAt: string | null;
  position: string;
  createdAt: string;
}

/** Key order used when seeding a note doc, so seeded state is byte-comparable in tests. */
export const NOTE_META_DEFAULTS: NoteMetaMap = {
  title: '无标题',
  titleManual: false,
  folderId: null,
  pinned: false,
  archived: false,
  deletedAt: null,
  position: 'a0',
  createdAt: new Date(0).toISOString(),
};

export interface WorkspaceSettings {
  /** Note that the global-hotkey quick-capture window appends to. */
  inboxNoteId: string | null;
  /** Electron accelerator for the quick-capture (data-entry) window, e.g. `Alt+Space`. */
  hotkey: string;
  /** Electron accelerator for bringing the main workspace window to the front. */
  mainWindowHotkey: string;
  /** Electron accelerator for opening the quick-favourite dialog. */
  favoriteHotkey: string;
  theme: (typeof THEMES)[number];
  editorMode: (typeof EDITOR_MODES)[number];
  fontSize: number;
  /** Timestamp stamp inserted above each quick capture. */
  stampFormat: (typeof STAMP_FORMATS)[number];
  /** Hide the quick-capture window when it loses focus. */
  hideOnBlur: boolean;
  /** Keep the app resident in the tray after the main window is closed. */
  minimizeToTray: boolean;
  /** Launch the desktop app at login. */
  launchAtLogin: boolean;
  /** System folder holding all favourites. Read-only through the settings API. */
  favoritesFolderId: string | null;
  /** System folder under 收藏 where unclassified favourites wait. */
  favoritesInboxFolderId: string | null;
}

export const DEFAULT_SETTINGS: WorkspaceSettings = {
  inboxNoteId: null,
  hotkey: DEFAULT_HOTKEY.darwin,
  mainWindowHotkey: DEFAULT_MAIN_WINDOW_HOTKEY,
  favoriteHotkey: DEFAULT_FAVORITE_HOTKEY,
  theme: 'system',
  editorMode: 'split',
  fontSize: 14,
  stampFormat: 'heading',
  hideOnBlur: true,
  minimizeToTray: true,
  launchAtLogin: false,
  favoritesFolderId: null,
  favoritesInboxFolderId: null,
};


/** Classification states for a favourite note. */
export const FAVORITE_CATEGORY_STATUSES = [
  'idle',
  'queued',
  'running',
  'done',
  'suggested',
  'error',
] as const;
export type FavoriteCategoryStatus = (typeof FAVORITE_CATEGORY_STATUSES)[number];

export const MEDIA_STATUSES = ['idle', 'queued', 'running', 'partial', 'done', 'error', 'unconfigured'] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

export const SOURCE_PLATFORMS = ['xiaohongshu', 'douyin', 'wechat', 'web', 'manual'] as const;
export type SourcePlatform = (typeof SOURCE_PLATFORMS)[number];

export const CAPTURE_STATUSES = ['fetched', 'manual', 'media', 'partial'] as const;
export type CaptureStatus = (typeof CAPTURE_STATUSES)[number];

/** Optional provenance stored in a note doc's `source` map. */
export interface NoteSourceState {
  url: string | null;
  platform: SourcePlatform | null;
  author: string | null;
  coverAttachmentId: string | null;
  originalTitle: string | null;
  collectedAt: string | null;
  captureStatus: CaptureStatus | null;
}

export const NOTE_SOURCE_DEFAULTS: NoteSourceState = {
  url: null,
  platform: null,
  author: null,
  coverAttachmentId: null,
  originalTitle: null,
  collectedAt: null,
  captureStatus: null,
};

/** OCR/ASR processing state stored in a note doc's `media` map. */
export interface NoteMediaState {
  status: MediaStatus;
  error: string | null;
  updatedAt: string | null;
}

export const NOTE_MEDIA_DEFAULTS: NoteMediaState = {
  status: 'idle',
  error: null,
  updatedAt: null,
};

/** Final AI summary state stored inside a note document. */
export interface NoteAiState {
  status: AiStatus;
  summary: string;
  keyPoints: string[];
  generatedAt: string | null;
  sourceHash: string | null;
  model: string | null;
  error: string | null;
  autoAttemptedAt: string | null;
  lastAttemptAt: string | null;
  /** Folder assigned by AI/manual classification (favourites only). */
  categoryFolderId: string | null;
  categoryName: string | null;
  categoryStatus: FavoriteCategoryStatus;
  /** A non-preset category proposed by AI and waiting for user confirmation. */
  categorySuggestion: string | null;
  categoryAt: string | null;
  categoryError: string | null;
}

export interface AiTodoEntry {
  id: string;
  text: string;
  done: boolean;
  order: number;
}

export const NOTE_AI_DEFAULTS: NoteAiState = {
  status: 'idle',
  summary: '',
  keyPoints: [],
  generatedAt: null,
  sourceHash: null,
  model: null,
  error: null,
  autoAttemptedAt: null,
  lastAttemptAt: null,
  categoryFolderId: null,
  categoryName: null,
  categoryStatus: 'idle',
  categorySuggestion: null,
  categoryAt: null,
  categoryError: null,
};

/** Build the collaboration document name for a note. */
export function noteDocName(noteId: string): string {
  return `${NOTE_DOC_PREFIX}${noteId}`;
}

/** Build the collaboration document name for a user's workspace. */
export function workspaceDocName(userId: string): string {
  return `${WORKSPACE_DOC_PREFIX}${userId}`;
}

export type DocKind = 'note' | 'workspace' | 'unknown';

export interface ParsedDocName {
  kind: DocKind;
  /** noteId for note docs, userId for workspace docs, otherwise `null`. */
  id: string | null;
  raw: string;
}

/**
 * Parse and validate a collaboration document name.
 *
 * IDs are nanoid-shaped (`[A-Za-z0-9_-]`). Rejecting anything else here means the
 * Hocuspocus `onAuthenticate` hook can never be tricked into a doc name that aliases
 * another tenant's document.
 */
export function parseDocName(raw: string): ParsedDocName {
  const idPattern = /^[A-Za-z0-9_-]{1,64}$/;
  if (raw.startsWith(NOTE_DOC_PREFIX)) {
    const id = raw.slice(NOTE_DOC_PREFIX.length);
    return idPattern.test(id) ? { kind: 'note', id, raw } : { kind: 'unknown', id: null, raw };
  }
  if (raw.startsWith(WORKSPACE_DOC_PREFIX)) {
    const id = raw.slice(WORKSPACE_DOC_PREFIX.length);
    return idPattern.test(id) ? { kind: 'workspace', id, raw } : { kind: 'unknown', id: null, raw };
  }
  return { kind: 'unknown', id: null, raw };
}

/**
 * Assert that `userId` is allowed to open `documentName`.
 * Workspace docs are strictly per-user; note docs are checked by the caller against the
 * `notes.owner_id` row (this helper only rejects malformed names and foreign workspaces).
 */
export function canAccessWorkspaceDoc(documentName: string, userId: string): boolean {
  const parsed = parseDocName(documentName);
  return parsed.kind === 'workspace' && parsed.id === userId;
}

export function initialWorkspaceMeta(): { schemaVersion: number; inboxTitle: string } {
  return { schemaVersion: CRDT_SCHEMA_VERSION, inboxTitle: INBOX_NOTE_TITLE };
}
