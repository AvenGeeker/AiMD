import * as Y from 'yjs';
import {
  CRDT_SCHEMA_VERSION,
  DEFAULT_SETTINGS,
  NOTE_KEYS,
  NOTE_META_DEFAULTS,
  WORKSPACE_KEYS,
  NOTE_AI_DEFAULTS,
  FAVORITE_CATEGORY_STATUSES,
  MEDIA_STATUSES,
  SOURCE_PLATFORMS,
  CAPTURE_STATUSES,
  AI_STATUSES,
  type AiTodoEntry,
  type CaptureStatus,
  type FavoriteCategoryStatus,
  type FolderEntry,
  type MediaStatus,
  type NoteAiState,
  type NoteMediaState,
  type NoteMetaMap,
  type NoteSourceState,
  type SourcePlatform,
  type TagEntry,
  type WorkspaceSettings,
} from '@aimarkdown/shared';

/**
 * Creation and mutation of Y.Docs.
 *
 * Every write to CRDT state funnels through here — whether it originates from a browser,
 * from the Electron quick-capture window, or from a REST handler using a Hocuspocus direct
 * connection. Keeping the mutations in one module means there is exactly one definition of
 * what the document shape is, and it can be unit-tested without a server.
 */

/* --------------------------------- readers -------------------------------- */


/* ---------------------------------- AI state ------------------------------- */

export function readAiState(doc: Y.Doc): NoteAiState {
  const map = doc.getMap(NOTE_KEYS.ai);
  const str = (key: string, fallback: string | null): string | null => {
    const value = map.get(key);
    return typeof value === 'string' ? value : fallback;
  };
  const statusValue = str('status', 'idle');
  const status = statusValue && (AI_STATUSES as readonly string[]).includes(statusValue)
    ? (statusValue as NoteAiState['status'])
    : 'idle';
  let keyPoints: string[] = [];
  const rawKeyPoints = map.get('keyPoints');
  if (typeof rawKeyPoints === 'string') {
    try {
      const parsed = JSON.parse(rawKeyPoints) as unknown;
      if (Array.isArray(parsed)) {
        keyPoints = parsed.filter((value): value is string => typeof value === 'string');
      }
    } catch {
      keyPoints = [];
    }
  }
  return {
    status,
    summary: str('summary', '') ?? '',
    keyPoints,
    generatedAt: str('generatedAt', null),
    sourceHash: str('sourceHash', null),
    model: str('model', null),
    error: str('error', null),
    autoAttemptedAt: str('autoAttemptedAt', null),
    lastAttemptAt: str('lastAttemptAt', null),
    categoryFolderId: str('categoryFolderId', null),
    categoryName: str('categoryName', null),
    categoryStatus: categoryStatusOf(map.get('categoryStatus')),
    categorySuggestion: str('categorySuggestion', null),
    categoryAt: str('categoryAt', null),
    categoryError: str('categoryError', null),
  };
}

function categoryStatusOf(value: unknown): FavoriteCategoryStatus {
  return typeof value === 'string' && (FAVORITE_CATEGORY_STATUSES as readonly string[]).includes(value)
    ? (value as FavoriteCategoryStatus)
    : 'idle';
}

/** Write scalar AI state. Key points are serialized so Y.Map values stay primitive. */
export function writeAiState(doc: Y.Doc, patch: Partial<NoteAiState>): void {
  const map = doc.getMap(NOTE_KEYS.ai);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (key === 'keyPoints' && Array.isArray(value)) {
      map.set('keyPoints', JSON.stringify(value));
    } else {
      map.set(key, value as string | null);
    }
  }
}

export function readAiTodos(doc: Y.Doc): AiTodoEntry[] {
  const map = doc.getMap(NOTE_KEYS.aiTodos);
  const out: AiTodoEntry[] = [];
  map.forEach((value) => {
    if (!value || typeof value !== 'object') return;
    const item = value as Record<string, unknown>;
    if (
      typeof item.id === 'string' &&
      typeof item.text === 'string' &&
      typeof item.done === 'boolean' &&
      typeof item.order === 'number'
    ) {
      out.push({ id: item.id, text: item.text, done: item.done, order: item.order });
    }
  });
  return out.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/**
 * Replace the AI todo map while preserving entries by id. The map key is the todo id, so two
 * devices toggling different checkboxes never overwrite each other's whole todo list.
 */
export function writeAiTodos(doc: Y.Doc, todos: readonly AiTodoEntry[]): void {
  const map = doc.getMap<AiTodoEntry>(NOTE_KEYS.aiTodos);
  const desired = new Map(todos.map((todo) => [todo.id, todo]));
  const existingKeys: string[] = [];
  map.forEach((_value, key) => existingKeys.push(key));
  for (const key of existingKeys) {
    if (!desired.has(key)) map.delete(key);
  }
  for (const todo of todos) {
    const current = map.get(todo.id);
    if (
      current &&
      current.text === todo.text &&
      current.done === todo.done &&
      current.order === todo.order
    ) {
      continue;
    }
    map.set(todo.id, { ...todo });
  }
}

export function setAiTodoDone(doc: Y.Doc, todoId: string, done: boolean): void {
  const map = doc.getMap<AiTodoEntry>(NOTE_KEYS.aiTodos);
  const current = map.get(todoId);
  if (!current || current.done === done) return;
  map.set(todoId, { ...current, done });
}

export function readAiSummaryState(doc: Y.Doc): NoteAiState {
  return { ...NOTE_AI_DEFAULTS, ...readAiState(doc) };
}

/** Read provenance from a note doc. Unknown/invalid values fall back to null. */
export function readSource(doc: Y.Doc): NoteSourceState {
  const map = doc.getMap(NOTE_KEYS.source);
  const str = (key: string): string | null => {
    const value = map.get(key);
    return typeof value === 'string' && value.length > 0 ? value : null;
  };
  const platform = str('platform');
  const captureStatus = str('captureStatus');
  return {
    url: str('url'),
    platform: platform && (SOURCE_PLATFORMS as readonly string[]).includes(platform)
      ? (platform as SourcePlatform)
      : null,
    author: str('author'),
    coverAttachmentId: str('coverAttachmentId'),
    originalTitle: str('originalTitle'),
    collectedAt: str('collectedAt'),
    captureStatus: captureStatus && (CAPTURE_STATUSES as readonly string[]).includes(captureStatus)
      ? (captureStatus as CaptureStatus)
      : null,
  };
}

export function writeSource(doc: Y.Doc, patch: Partial<NoteSourceState>): void {
  const map = doc.getMap(NOTE_KEYS.source);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    map.set(key, value as string | null);
  }
}

export function readMedia(doc: Y.Doc): NoteMediaState {
  const map = doc.getMap(NOTE_KEYS.media);
  const statusValue = map.get('status');
  const status = typeof statusValue === 'string' && (MEDIA_STATUSES as readonly string[]).includes(statusValue)
    ? (statusValue as MediaStatus)
    : 'idle';
  const error = map.get('error');
  const updatedAt = map.get('updatedAt');
  return {
    status,
    error: typeof error === 'string' ? error : null,
    updatedAt: typeof updatedAt === 'string' ? updatedAt : null,
  };
}

export function writeMedia(doc: Y.Doc, patch: Partial<NoteMediaState>): void {
  const map = doc.getMap(NOTE_KEYS.media);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    map.set(key, value as string | null);
  }
}

export function readBody(doc: Y.Doc): string {
  return doc.getText(NOTE_KEYS.body).toString();
}

export function readNoteMeta(doc: Y.Doc): NoteMetaMap {
  const meta = doc.getMap(NOTE_KEYS.meta);
  const str = (key: keyof NoteMetaMap, fallback: string): string => {
    const value = meta.get(key);
    return typeof value === 'string' ? value : fallback;
  };
  const bool = (key: keyof NoteMetaMap, fallback: boolean): boolean => {
    const value = meta.get(key);
    return typeof value === 'boolean' ? value : fallback;
  };
  // A doc created before `titleManual` existed has no value; treat a concrete title as manual
  // so an upgrade never lets the body overwrite a title the user already had.
  const hasTitleManual = meta.has('titleManual');
  const strOrNull = (key: keyof NoteMetaMap): string | null => {
    const value = meta.get(key);
    return typeof value === 'string' ? value : null;
  };

  return {
    title: str('title', NOTE_META_DEFAULTS.title),
    titleManual: hasTitleManual ? bool('titleManual', false) : true,
    folderId: strOrNull('folderId'),
    pinned: bool('pinned', false),
    archived: bool('archived', false),
    deletedAt: strOrNull('deletedAt'),
    position: str('position', NOTE_META_DEFAULTS.position),
    createdAt: str('createdAt', NOTE_META_DEFAULTS.createdAt),
  };
}

/**
 * Read the note's tag ids.
 *
 * De-duplicated on read: two devices adding the *same* tag concurrently both insert into the
 * Y.Array, and Yjs has no way to know the inserts are semantically identical. Collapsing them
 * here (and letting the next `setTagIds` physically clean the array up) keeps the projection
 * correct without needing a custom CRDT type.
 */
export function readTagIds(doc: Y.Doc): string[] {
  const array = doc.getArray<string>(NOTE_KEYS.tagIds);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of array.toArray()) {
    if (typeof id !== 'string' || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function readFolders(doc: Y.Doc): FolderEntry[] {
  const map = doc.getMap(WORKSPACE_KEYS.folders);
  const out: FolderEntry[] = [];
  map.forEach((value) => {
    if (isFolderEntry(value)) out.push(value);
  });
  return out;
}

export function readTags(doc: Y.Doc): TagEntry[] {
  const map = doc.getMap(WORKSPACE_KEYS.tags);
  const out: TagEntry[] = [];
  map.forEach((value) => {
    if (isTagEntry(value)) out.push(value);
  });
  return out;
}

/** Merge the doc's settings map over the defaults, ignoring unknown/invalid values. */
export function readSettings(doc: Y.Doc): WorkspaceSettings {
  const map = doc.getMap(WORKSPACE_KEYS.settings);
  const base: WorkspaceSettings = { ...DEFAULT_SETTINGS };
  const get = <K extends keyof WorkspaceSettings>(key: K): WorkspaceSettings[K] | undefined => {
    const value = map.get(key as string);
    return value === undefined ? undefined : (value as WorkspaceSettings[K]);
  };

  const inboxNoteId = get('inboxNoteId');
  if (inboxNoteId === null || typeof inboxNoteId === 'string') base.inboxNoteId = inboxNoteId;
  const hotkey = get('hotkey');
  if (typeof hotkey === 'string' && hotkey.length > 0) base.hotkey = hotkey;
  const mainWindowHotkey = get('mainWindowHotkey');
  if (typeof mainWindowHotkey === 'string' && mainWindowHotkey.length > 0) {
    base.mainWindowHotkey = mainWindowHotkey;
  }
  const favoriteHotkey = get('favoriteHotkey');
  if (typeof favoriteHotkey === 'string' && favoriteHotkey.length > 0) {
    base.favoriteHotkey = favoriteHotkey;
  }
  const theme = get('theme');
  if (theme === 'light' || theme === 'dark' || theme === 'system') base.theme = theme;
  const editorMode = get('editorMode');
  if (editorMode === 'split' || editorMode === 'edit' || editorMode === 'preview') {
    base.editorMode = editorMode;
  }
  const fontSize = get('fontSize');
  if (typeof fontSize === 'number' && fontSize >= 10 && fontSize <= 24) base.fontSize = fontSize;
  const stampFormat = get('stampFormat');
  if (stampFormat === 'none' || stampFormat === 'heading' || stampFormat === 'bullet') {
    base.stampFormat = stampFormat;
  }
  const hideOnBlur = get('hideOnBlur');
  if (typeof hideOnBlur === 'boolean') base.hideOnBlur = hideOnBlur;
  const minimizeToTray = get('minimizeToTray');
  if (typeof minimizeToTray === 'boolean') base.minimizeToTray = minimizeToTray;
  const launchAtLogin = get('launchAtLogin');
  if (typeof launchAtLogin === 'boolean') base.launchAtLogin = launchAtLogin;
  const favoritesFolderId = get('favoritesFolderId');
  if (favoritesFolderId === null || typeof favoritesFolderId === 'string') {
    base.favoritesFolderId = favoritesFolderId;
  }
  const favoritesInboxFolderId = get('favoritesInboxFolderId');
  if (favoritesInboxFolderId === null || typeof favoritesInboxFolderId === 'string') {
    base.favoritesInboxFolderId = favoritesInboxFolderId;
  }

  return base;
}

function isFolderEntry(value: unknown): value is FolderEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.name === 'string';
}

function isTagEntry(value: unknown): value is TagEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.name === 'string';
}

/* --------------------------------- creators -------------------------------- */

export interface CreateNoteDocInput {
  meta?: Partial<NoteMetaMap>;
  tagIds?: string[];
  body?: string;
  source?: Partial<NoteSourceState>;
  media?: Partial<NoteMediaState>;
  ai?: Partial<NoteAiState>;
}

/** Build a brand-new note document, ready to be encoded and stored. */
export function createNoteDoc(input: CreateNoteDocInput = {}): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const meta = doc.getMap(NOTE_KEYS.meta);
    const merged: NoteMetaMap = { ...NOTE_META_DEFAULTS, ...(input.meta ?? {}) };
    meta.set('title', merged.title);
    meta.set('titleManual', merged.titleManual);
    meta.set('folderId', merged.folderId);
    meta.set('pinned', merged.pinned);
    meta.set('archived', merged.archived);
    meta.set('deletedAt', merged.deletedAt);
    meta.set('position', merged.position);
    meta.set('createdAt', merged.createdAt);

    const tagIds = doc.getArray<string>(NOTE_KEYS.tagIds);
    if (input.tagIds && input.tagIds.length > 0) tagIds.insert(0, input.tagIds);

    if (input.body && input.body.length > 0) {
      doc.getText(NOTE_KEYS.body).insert(0, input.body);
    }
    if (input.source) writeSource(doc, input.source);
    if (input.media) writeMedia(doc, input.media);
    if (input.ai) writeAiState(doc, input.ai);
  });
  return doc;
}

/** Build a brand-new workspace document seeded with default settings. */
export function createWorkspaceDoc(settings: Partial<WorkspaceSettings> = {}): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const meta = doc.getMap(WORKSPACE_KEYS.meta);
    meta.set('schemaVersion', CRDT_SCHEMA_VERSION);
    writeSettings(doc, { ...DEFAULT_SETTINGS, ...settings });
  });
  return doc;
}

/* --------------------------------- writers --------------------------------- */
/* All of these are meant to run inside a `doc.transact()` (or a direct-connection
 * `transact()`), so a batch of changes produces a single CRDT update. */

export function writeNoteMeta(doc: Y.Doc, patch: Partial<NoteMetaMap>): void {
  const meta = doc.getMap(NOTE_KEYS.meta);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    meta.set(key, value as string | boolean | null);
  }
  // Renaming a note by hand pins the title so body edits stop overriding it.
  if (typeof patch.title === 'string' && patch.titleManual === undefined) {
    meta.set('titleManual', true);
  }
}

/**
 * Replace the note's tag set using a **minimal diff**.
 *
 * Clearing and re-inserting the whole array would destroy the CRDT identity of untouched tags,
 * so two devices that each add a different tag would merge into duplicated entries. Instead we
 * delete only what was removed and insert only what is new, leaving shared tags physically in
 * place — then concurrent additions from two devices merge into their union.
 */
export function setTagIds(doc: Y.Doc, nextTagIds: string[]): void {
  const array = doc.getArray<string>(NOTE_KEYS.tagIds);
  const next = [...new Set(nextTagIds.filter((id) => typeof id === 'string' && id.length > 0))];
  const current = array.toArray();
  if (current.length === next.length && current.every((value, i) => value === next[i])) return;

  const nextSet = new Set(next);

  // 1. Remove tags that are no longer present, back-to-front so indices stay valid.
  for (let i = current.length - 1; i >= 0; i--) {
    if (!nextSet.has(current[i] as string)) array.delete(i, 1);
  }

  // 2. Walk the desired order, inserting only tags that are missing at that position.
  let index = 0;
  for (const id of next) {
    if (array.get(index) === id) {
      index++;
      continue;
    }
    const existingAt = array.toArray().indexOf(id);
    if (existingAt > index) {
      // Present but out of order: leave it in place rather than churn the document. Tag order
      // is not user-meaningful, so avoiding a needless CRDT write wins.
      index++;
      continue;
    }
    array.insert(index, [id]);
    index++;
  }

  // 3. Drop any surplus entries beyond the desired length.
  if (array.length > next.length) array.delete(next.length, array.length - next.length);
}

/**
 * Append text to the end of the note body.
 *
 * Used by the quick-capture window. Appending at `length` is the CRDT-friendly way to add a
 * capture: it merges cleanly with a concurrent edit happening anywhere else in the document,
 * so a capture taken on the phone while the desktop edits the middle never loses either.
 *
 * @returns the number of characters inserted.
 */
export function appendToBody(doc: Y.Doc, text: string, separator = '\n\n'): number {
  const body = doc.getText(NOTE_KEYS.body);
  if (text.length === 0) return 0;
  const current = body.toString();
  const prefix = current.length === 0 ? '' : current.endsWith('\n\n') ? '' : separator;
  const payload = prefix + text;
  body.insert(body.length, payload);
  return payload.length;
}

/**
 * Replace the whole body with a minimal prefix/suffix diff.
 *
 * Full delete+insert would destroy the CRDT identity of unchanged text. A prefix/suffix diff
 * keeps the common edges intact; the caller must still guard concurrent edits with a state hash
 * when the replacement comes from an external system.
 */
export function replaceBody(doc: Y.Doc, next: string): number {
  const body = doc.getText(NOTE_KEYS.body);
  const current = body.toString();
  if (current === next) return 0;

  let prefix = 0;
  const maxPrefix = Math.min(current.length, next.length);
  while (prefix < maxPrefix && current.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix++;

  let suffix = 0;
  const maxSuffix = Math.min(current.length - prefix, next.length - prefix);
  while (
    suffix < maxSuffix &&
    current.charCodeAt(current.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix++;
  }

  const deleteCount = current.length - prefix - suffix;
  const inserted = next.slice(prefix, next.length - suffix);
  doc.transact(() => {
    if (deleteCount > 0) body.delete(prefix, deleteCount);
    if (inserted.length > 0) body.insert(prefix, inserted);
  });
  return Math.max(deleteCount, inserted.length);
}

export function writeFolder(doc: Y.Doc, entry: FolderEntry): void {
  doc.getMap(WORKSPACE_KEYS.folders).set(entry.id, { ...entry });
}

export function deleteFolder(doc: Y.Doc, folderId: string): void {
  const folders = doc.getMap(WORKSPACE_KEYS.folders);
  const existing = folders.get(folderId);
  if (!isFolderEntry(existing)) return;

  // Read the parent *before* deleting: children are promoted onto it, so the value is still
  // needed after the entry itself is gone.
  const promotedParentId = existing.parentId;
  folders.delete(folderId);

  // Collect child keys first — mutating a Y.Map while iterating it is not safe.
  const children: { key: string; value: FolderEntry }[] = [];
  folders.forEach((value, key) => {
    if (isFolderEntry(value) && value.parentId === folderId) children.push({ key, value });
  });
  for (const child of children) {
    folders.set(child.key, { ...child.value, parentId: promotedParentId });
  }
}

export function writeTag(doc: Y.Doc, entry: TagEntry): void {
  doc.getMap(WORKSPACE_KEYS.tags).set(entry.id, { ...entry });
}

export function deleteTag(doc: Y.Doc, tagId: string): void {
  doc.getMap(WORKSPACE_KEYS.tags).delete(tagId);
}

export function writeSettings(doc: Y.Doc, patch: Partial<WorkspaceSettings>): void {
  const map = doc.getMap(WORKSPACE_KEYS.settings);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    map.set(key, value as string | number | boolean | null);
  }
}

/* --------------------------------- encoding -------------------------------- */

/** Serialise a doc for storage in a `bytea` column. */
export function encodeDoc(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

/** Load a doc from stored bytes. Returns a fresh empty doc when `bytes` is null. */
export function decodeDoc(bytes: Uint8Array | null | undefined): Y.Doc {
  const doc = new Y.Doc();
  if (bytes && bytes.byteLength > 0) Y.applyUpdate(doc, bytes);
  return doc;
}
