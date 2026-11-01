import type { Hocuspocus } from '@hocuspocus/server';
import type { Sql } from 'postgres';
import {
  ApiError,
  ERROR_CODES,
  firstKey,
  keyBetween,
  workspaceDocName,
  type FolderDto,
  type SettingsDto,
  type TagDto,
  type TreeDto,
} from '@aimarkdown/shared';
import { DEFAULT_SETTINGS } from '@aimarkdown/shared';
import type { Logger } from '../utils/logger.js';
import { newId } from '../utils/ids.js';
import { toDateOr } from '../utils/dates.js';
import { parseJsonb } from '../db/json.js';
import { deleteFolder, deleteTag, writeFolder, writeSettings, writeTag, readFolders } from '../collab/docFactory.js';
import { docFromSnapshot, mutateDocument } from '../collab/direct.js';
import { mirrorWorkspace } from '../collab/persistence.js';

/**
 * Folder tree, tags and user settings.
 *
 * These live in the per-user workspace Y.Doc so that renaming a folder or recoloring a tag on
 * one device merges with an offline change made on another. Postgres holds a projection used
 * for rendering the sidebar and for counting.
 */

export interface WorkspaceDeps {
  sql: Sql;
  log: Logger;
  getHocuspocus(): Hocuspocus | null;
}

/** Apply a workspace-doc mutation and refresh the mirror inline. */
async function withWorkspace<T>(
  deps: WorkspaceDeps,
  userId: string,
  mutate: (doc: import('yjs').Doc) => T,
): Promise<T> {
  const docName = workspaceDocName(userId);
  const hocuspocus = deps.getHocuspocus();

  if (hocuspocus) {
    const { result, snapshot } = await mutateDocument(hocuspocus, docName, mutate);
    await deps.sql.begin((tx) => mirrorWorkspace(tx, userId, docFromSnapshot(snapshot), deps.log));
    return result;
  }

  // Offline/test path with no collab server attached.
  const rows = await deps.sql`select ydoc from workspace_documents where user_id = ${userId}`;
  const doc = docFromSnapshot(rows[0]?.ydoc ? toBytes(rows[0].ydoc) : new Uint8Array(0));
  const result = mutate(doc);
  const { encodeStateAsUpdate } = await import('yjs');
  await deps.sql.begin(async (tx) => {
    await tx`
      update workspace_documents set ydoc = ${toHex(encodeStateAsUpdate(doc))}::bytea, updated_at = now()
      where user_id = ${userId}
    `;
    await mirrorWorkspace(tx, userId, doc, deps.log);
  });
  return result;
}

function toBytes(value: unknown): Uint8Array {
  if (Buffer.isBuffer(value)) return new Uint8Array(value);
  if (value instanceof Uint8Array) return value;
  return new Uint8Array(0);
}

function toHex(bytes: Uint8Array): string {
  return `\\x${Buffer.from(bytes).toString('hex')}`;
}

/* --------------------------------- folders -------------------------------- */

async function siblingPositions(sql: Sql, ownerId: string, parentId: string | null): Promise<string[]> {
  const rows =
    parentId === null
      ? await sql`select position from folders where owner_id = ${ownerId} and parent_id is null order by position`
      : await sql`select position from folders where owner_id = ${ownerId} and parent_id = ${parentId} order by position`;
  return rows.map((row) => String(row.position));
}

/** True when `candidate` is `folderId` itself or one of its descendants. */
export async function isDescendant(
  sql: Sql,
  ownerId: string,
  folderId: string,
  candidate: string,
): Promise<boolean> {
  if (folderId === candidate) return true;
  const rows = await sql`select id, parent_id from folders where owner_id = ${ownerId}`;
  const parentOf = new Map<string, string | null>();
  for (const row of rows) {
    parentOf.set(String(row.id), row.parent_id == null ? null : String(row.parent_id));
  }
  let cursor: string | null = parentOf.get(candidate) ?? null;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === folderId) return true;
    if (seen.has(cursor)) return false;
    seen.add(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
  return false;
}

export async function createFolder(
  deps: WorkspaceDeps,
  ownerId: string,
  input: { id?: string; name: string; parentId?: string | null },
): Promise<FolderDto> {
  const name = input.name.trim();
  if (name.length === 0) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '目录名不能为空');
  const parentId = input.parentId ?? null;
  const id = input.id ?? newId();
  const existing = await deps.sql`
    select id, name, parent_id, position, created_at from folders
    where id = ${id} and owner_id = ${ownerId}
  `;
  if (existing[0]) {
    const row = existing[0];
    const counts = await deps.sql`
      select count(*)::int as c from notes
      where owner_id = ${ownerId} and folder_id = ${id} and deleted_at is null
    `;
    return {
      id,
      name: String(row.name),
      parentId: row.parent_id == null ? null : String(row.parent_id),
      position: String(row.position),
      noteCount: Number(counts[0]?.c ?? 0),
      createdAt: row.created_at ? toDateOr(row.created_at, new Date()).toISOString() : new Date().toISOString(),
    };
  }
  const other = await deps.sql`select id from folders where id = ${id}`;
  if (other.length > 0) throw new ApiError(ERROR_CODES.CONFLICT, '目录 ID 已被占用');
  if (parentId) {
    const rows = await deps.sql`select id from folders where id = ${parentId} and owner_id = ${ownerId}`;
    if (rows.length === 0) throw new ApiError(ERROR_CODES.NOT_FOUND, '父目录不存在');
  }
  const positions = await siblingPositions(deps.sql, ownerId, parentId);
  const position = positions.length > 0 ? keyBetween(positions[positions.length - 1] ?? null, null) : firstKey();
  const createdAt = new Date().toISOString();

  await withWorkspace(deps, ownerId, (doc) => {
    writeFolder(doc, { id, name, parentId, position, createdAt });
  });

  return { id, name, parentId, position, noteCount: 0, createdAt };
}

export async function updateFolder(
  deps: WorkspaceDeps,
  ownerId: string,
  folderId: string,
  input: { name?: string; parentId?: string | null; before?: string | null; after?: string | null },
): Promise<FolderDto> {
  const existing = await deps.sql`
    select id, name, parent_id, position, created_at from folders
    where id = ${folderId} and owner_id = ${ownerId}
  `;
  const row = existing[0];
  if (!row) throw new ApiError(ERROR_CODES.NOT_FOUND, '目录不存在');

  const nextParentId = input.parentId === undefined ? (row.parent_id == null ? null : String(row.parent_id)) : input.parentId;

  if (nextParentId && nextParentId !== row.parent_id) {
    if (await isDescendant(deps.sql, ownerId, folderId, nextParentId)) {
      throw new ApiError(ERROR_CODES.CYCLIC_FOLDER, '不能把目录移动到它自己或它的子目录下');
    }
    const parentRows = await deps.sql`select id from folders where id = ${nextParentId} and owner_id = ${ownerId}`;
    if (parentRows.length === 0) throw new ApiError(ERROR_CODES.NOT_FOUND, '父目录不存在');
  }

  const nextName = (input.name ?? String(row.name)).trim();
  if (nextName.length === 0) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '目录名不能为空');

  // Recompute the position only when the move target or explicit neighbours are supplied.
  let nextPosition = String(row.position);
  const moved = nextParentId !== (row.parent_id == null ? null : String(row.parent_id));
  if (moved || input.before !== undefined || input.after !== undefined) {
    const positions = (await siblingPositions(deps.sql, ownerId, nextParentId)).filter((p) => p !== nextPosition);
    nextPosition = keyBetween(input.before ?? positions[positions.length - 1] ?? null, input.after ?? null);
  }

  const createdAt = row.created_at ? toDateOr(row.created_at, new Date()).toISOString() : new Date().toISOString();

  await withWorkspace(deps, ownerId, (doc) => {
    writeFolder(doc, { id: folderId, name: nextName, parentId: nextParentId, position: nextPosition, createdAt });
  });

  const counts = await deps.sql`
    select count(*)::int as c from notes
    where owner_id = ${ownerId} and folder_id = ${folderId} and deleted_at is null
  `;

  return {
    id: folderId,
    name: nextName,
    parentId: nextParentId,
    position: nextPosition,
    noteCount: Number(counts[0]?.c ?? 0),
    createdAt,
  };
}

export async function removeFolder(deps: WorkspaceDeps, ownerId: string, folderId: string): Promise<void> {
  const existing = await deps.sql`select id from folders where id = ${folderId} and owner_id = ${ownerId}`;
  if (existing.length === 0) throw new ApiError(ERROR_CODES.NOT_FOUND, '目录不存在');

  await withWorkspace(deps, ownerId, (doc) => {
    deleteFolder(doc, folderId);
  });

  // The mirror deletes the row; notes referencing it fall back to the root via FK SET NULL.
  await deps.sql`update notes set folder_id = null where owner_id = ${ownerId} and folder_id = ${folderId}`;
}

/* ---------------------------------- tags ---------------------------------- */

export async function listTags(deps: WorkspaceDeps, ownerId: string): Promise<TagDto[]> {
  const rows = await deps.sql`
    select t.id, t.name, t.color, count(nt.note_id)::int as note_count
    from tags t
    left join note_tags nt on nt.tag_id = t.id
    left join notes n on n.id = nt.note_id and n.deleted_at is null
    where t.owner_id = ${ownerId}
    group by t.id, t.name, t.color
    order by t.name asc
  `;
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    color: String(row.color),
    noteCount: Number(row.note_count ?? 0),
  }));
}

export async function upsertTag(
  deps: WorkspaceDeps,
  ownerId: string,
  input: { id?: string; name: string; color?: string },
): Promise<TagDto> {
  const name = input.name.trim();
  if (name.length === 0) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '标签名不能为空');

  let id = input.id;
  if (id) {
    const rows = await deps.sql`select id from tags where id = ${id} and owner_id = ${ownerId}`;
    if (rows.length === 0) throw new ApiError(ERROR_CODES.NOT_FOUND, '标签不存在');
  } else {
    // Reuse an existing tag with the same (case-insensitive) name instead of duplicating it.
    const dupes = await deps.sql`select id from tags where owner_id = ${ownerId} and lower(name) = lower(${name})`;
    id = dupes[0] ? String(dupes[0].id) : newId();
  }

  const color = input.color ?? '#6b7280';
  const tagId = id;

  await withWorkspace(deps, ownerId, (doc) => {
    writeTag(doc, { id: tagId, name, color });
  });

  const counts = await deps.sql`select count(*)::int as c from note_tags where tag_id = ${tagId}`;
  return { id: tagId, name, color, noteCount: Number(counts[0]?.c ?? 0) };
}

export async function removeTag(deps: WorkspaceDeps, ownerId: string, tagId: string): Promise<void> {
  const existing = await deps.sql`select id from tags where id = ${tagId} and owner_id = ${ownerId}`;
  if (existing.length === 0) throw new ApiError(ERROR_CODES.NOT_FOUND, '标签不存在');
  await withWorkspace(deps, ownerId, (doc) => {
    deleteTag(doc, tagId);
  });
  await deps.sql`delete from tags where id = ${tagId} and owner_id = ${ownerId}`;
}

/* -------------------------------- settings -------------------------------- */

export async function getSettings(deps: WorkspaceDeps, ownerId: string): Promise<SettingsDto> {
  const rows = await deps.sql`select settings from user_settings where user_id = ${ownerId}`;
  const source = parseJsonb<Record<string, unknown>>(rows[0]?.settings);
  if (!source) return { ...DEFAULT_SETTINGS };
  return {
    inboxNoteId: typeof source.inboxNoteId === 'string' ? source.inboxNoteId : null,
    hotkey: typeof source.hotkey === 'string' ? source.hotkey : DEFAULT_SETTINGS.hotkey,
    mainWindowHotkey:
      typeof source.mainWindowHotkey === 'string'
        ? source.mainWindowHotkey
        : DEFAULT_SETTINGS.mainWindowHotkey,
    theme: pickEnum(source.theme, ['light', 'dark', 'system'], DEFAULT_SETTINGS.theme),
    editorMode: pickEnum(source.editorMode, ['split', 'edit', 'preview'], DEFAULT_SETTINGS.editorMode),
    fontSize: typeof source.fontSize === 'number' ? source.fontSize : DEFAULT_SETTINGS.fontSize,
    stampFormat: pickEnum(source.stampFormat, ['none', 'heading', 'bullet'], DEFAULT_SETTINGS.stampFormat),
    hideOnBlur: typeof source.hideOnBlur === 'boolean' ? source.hideOnBlur : DEFAULT_SETTINGS.hideOnBlur,
    minimizeToTray:
      typeof source.minimizeToTray === 'boolean' ? source.minimizeToTray : DEFAULT_SETTINGS.minimizeToTray,
    launchAtLogin:
      typeof source.launchAtLogin === 'boolean' ? source.launchAtLogin : DEFAULT_SETTINGS.launchAtLogin,
  };
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export async function updateSettings(
  deps: WorkspaceDeps,
  ownerId: string,
  patch: Partial<SettingsDto>,
): Promise<SettingsDto> {
  await withWorkspace(deps, ownerId, (doc) => {
    writeSettings(doc, patch);
  });
  return getSettings(deps, ownerId);
}

/* ---------------------------------- tree ---------------------------------- */

export async function getTree(deps: WorkspaceDeps, ownerId: string): Promise<TreeDto> {
  const [folderRows, tagRows, countRows] = await Promise.all([
    deps.sql`
      select f.id, f.name, f.parent_id, f.position, f.created_at,
             (select count(*)::int from notes n
                where n.owner_id = f.owner_id and n.folder_id = f.id and n.deleted_at is null) as note_count
      from folders f
      where f.owner_id = ${ownerId}
      order by f.position asc
    `,
    listTags(deps, ownerId),
    deps.sql`
      select
        count(*) filter (where deleted_at is null)::int as notes,
        count(*) filter (where deleted_at is not null)::int as trashed
      from notes where owner_id = ${ownerId}
    `,
  ]);

  const folders: FolderDto[] = folderRows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    parentId: row.parent_id == null ? null : String(row.parent_id),
    position: String(row.position),
    noteCount: Number(row.note_count ?? 0),
    createdAt: toDateOr(row.created_at, new Date()).toISOString(),
  }));

  return {
    folders,
    tags: tagRows,
    settings: await getSettings(deps, ownerId),
    counts: {
      notes: Number(countRows[0]?.notes ?? 0),
      trashed: Number(countRows[0]?.trashed ?? 0),
    },
  };
}

/** Direct read of the workspace doc's folder list (used by the cycle-repair test). */
export async function readWorkspaceFolders(deps: WorkspaceDeps, ownerId: string) {
  const rows = await deps.sql`select ydoc from workspace_documents where user_id = ${ownerId}`;
  const bytes = rows[0]?.ydoc;
  if (!bytes) return [];
  return readFolders(docFromSnapshot(toBytes(bytes)));
}
