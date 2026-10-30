import type { ISql, Sql } from 'postgres';
import { toDate, toDateOr } from '../utils/dates.js';
import * as Y from 'yjs';
import {
  ApiError,
  ERROR_CODES,
  MIN_SEARCH_QUERY_LENGTH,
  STAMP_FORMATS,
  firstKey,
  keyBetween,
  noteDocName,
  type NoteSort,
  type StampFormat,
} from '@aimarkdown/shared';
import { NOTE_KEYS, type NoteSummaryDto } from '@aimarkdown/shared';
import type { Logger } from '../utils/logger.js';
import { newId } from '../utils/ids.js';
import { decodeBytea, encodeBytea } from '../db/bytea.js';
import { createNoteDoc, appendToBody, readBody, writeNoteMeta, setTagIds } from '../collab/docFactory.js';
import { mirrorNote } from '../collab/persistence.js';
import { docFromSnapshot, mutateDocument } from '../collab/direct.js';
import type { Hocuspocus } from '@hocuspocus/server';

/**
 * Note operations.
 *
 * Creation writes the Postgres row *and* the seeded CRDT document in one transaction, so a note
 * is never visible without a document (or vice versa). Every later mutation goes through the
 * Y.Doc — either from a connected client, or from a REST handler via a Hocuspocus direct
 * connection — and the relational mirror is refreshed from the projection.
 */

export interface NotesDeps {
  sql: Sql;
  log: Logger;
  /** Null until the collab server has started; tests may inject a stub. */
  getHocuspocus(): Hocuspocus | null;
}

export interface NoteRecord {
  id: string;
  ownerId: string;
  folderId: string | null;
  title: string;
  bodyText: string;
  isPinned: boolean;
  isArchived: boolean;
  deletedAt: Date | null;
  position: string;
  wordCount: number;
  createdAt: Date;
  contentUpdatedAt: Date;
  updatedAt: Date;
  tagIds: string[];
}

export interface CreateNoteInput {
  title?: string;
  folderId?: string | null;
  tagIds?: string[];
  body?: string;
  position?: string;
}

/** Build the initial document + row for a note and insert both atomically. */
export async function createNote(
  deps: NotesDeps,
  ownerId: string,
  input: CreateNoteInput = {},
): Promise<NoteRecord> {
  const { sql } = deps;
  const id = newId();
  const now = new Date();
  const body = input.body ?? '';
  const titleManual = typeof input.title === 'string' && input.title.trim().length > 0;

  const doc = createNoteDoc({
    meta: {
      title: titleManual ? (input.title as string).trim() : '无标题',
      titleManual,
      folderId: input.folderId ?? null,
      pinned: false,
      archived: false,
      deletedAt: null,
      position: input.position ?? firstKey(),
      createdAt: now.toISOString(),
    },
    tagIds: input.tagIds ?? [],
    body,
  });

  await sql.begin(async (tx) => {
    await assertFolderUsable(tx, ownerId, input.folderId ?? null);
    await tx`
      insert into notes (
        id, owner_id, folder_id, title, body_text, is_pinned, is_archived,
        position, word_count, created_at, content_updated_at, updated_at
      ) values (
        ${id}, ${ownerId}, ${input.folderId ?? null}, ${'无标题'}, ${''}, false, false,
        ${input.position ?? firstKey()}, ${0}, ${now}, ${now}, ${now}
      )
    `;
    await tx`
      insert into note_documents (note_id, ydoc, updated_at)
      values (${id}, ${encodeBytea(encodeDocBytes(doc))}::bytea, ${now})
    `;
    // Project immediately so the very first GET /notes reflects the created note.
    await mirrorNote(tx, id, ownerId, doc, now);
    const tagIds = input.tagIds ?? [];
    if (tagIds.length > 0) {
      // Only link tags that already exist for this owner; unknown ids are dropped rather than
      // failing the create (the same self-healing rule the mirror uses).
      await tx`
        insert into note_tags (note_id, tag_id)
        select ${id}, t.id from tags t
        where t.owner_id = ${ownerId} and t.id = any(${tagIds}::text[])
        on conflict do nothing
      `;
    }
  });

  const record = await getNote(deps, ownerId, id, { includeDeleted: true });
  if (!record) throw new ApiError(ERROR_CODES.INTERNAL, '笔记创建后无法读取');
  return record;
}

function encodeDocBytes(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

async function assertFolderUsable(tx: ISql, ownerId: string, folderId: string | null): Promise<void> {
  if (!folderId) return;
  const rows = await tx`select id from folders where id = ${folderId} and owner_id = ${ownerId}`;
  if (rows.length === 0) {
    throw new ApiError(ERROR_CODES.NOT_FOUND, '目标目录不存在');
  }
}

export interface GetNoteOptions {
  includeDeleted?: boolean;
}

/** Load one note plus its tags. Returns null when it is not visible to this owner. */
export async function getNote(
  deps: NotesDeps,
  ownerId: string,
  noteId: string,
  options: GetNoteOptions = {},
): Promise<NoteRecord | null> {
  const rows = await deps.sql`
    select
      n.id, n.owner_id, n.folder_id, n.title, n.body_text, n.is_pinned, n.is_archived,
      n.deleted_at, n.position, n.word_count, n.created_at, n.content_updated_at, n.updated_at,
      coalesce(
        array_agg(nt.tag_id) filter (where nt.tag_id is not null),
        '{}'
      ) as tag_ids
    from notes n
    left join note_tags nt on nt.note_id = n.id
    where n.id = ${noteId} and n.owner_id = ${ownerId}
    group by n.id
  `;
  const row = rows[0];
  if (!row) return null;
  if (!options.includeDeleted && row.deleted_at) return null;
  return mapRow(row);
}

function mapRow(row: Record<string, unknown>): NoteRecord {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    folderId: row.folder_id == null ? null : String(row.folder_id),
    title: String(row.title),
    bodyText: String(row.body_text ?? ''),
    isPinned: Boolean(row.is_pinned),
    isArchived: Boolean(row.is_archived),
    deletedAt: toDate(row.deleted_at),
    position: String(row.position),
    wordCount: Number(row.word_count ?? 0),
    // Passed through `toDateOr` rather than `new Date(String(...))`, which would truncate to
    // whole seconds and make same-second edits compare equal.
    createdAt: toDateOr(row.created_at, new Date(0)),
    contentUpdatedAt: toDateOr(row.content_updated_at, new Date(0)),
    updatedAt: toDateOr(row.updated_at, new Date(0)),
    tagIds: Array.isArray(row.tag_ids) ? (row.tag_ids as string[]).map(String) : [],
  };
}

/* --------------------------------- listing -------------------------------- */

export interface ListNotesInput {
  folderId?: string | null | undefined;
  /** Restrict to root-level notes (no folder). Overrides `folderId`. */
  rootOnly?: boolean;
  /** When provided, restrict to notes carrying *all* of these tags. */
  tagIds?: string[];
  q?: string | null;
  archived?: 'true' | 'false' | 'only';
  sort?: NoteSort;
  limit?: number;
  cursor?: string | null;
}

export interface ListNotesResult {
  items: NoteSummaryDto[];
  nextCursor: string | null;
  total: number;
}

const ORDER_BY: Record<NoteSort, string> = {
  updated: 'n.is_pinned desc, n.content_updated_at desc',
  created: 'n.is_pinned desc, n.created_at desc',
  title: 'n.is_pinned desc, n.title asc',
  position: 'n.is_pinned desc, n.position asc',
};

/** Decode an opaque list cursor into an offset. */
export function decodeCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = Number.parseInt(decoded.replace(/^o:/, ''), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

export function encodeCursor(offset: number): string {
  return Buffer.from(`o:${offset}`, 'utf8').toString('base64url');
}

export async function listNotes(
  deps: NotesDeps,
  ownerId: string,
  input: ListNotesInput = {},
): Promise<ListNotesResult> {
  const sql = deps.sql;
  const sort = input.sort ?? 'updated';
  const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
  const offset = decodeCursor(input.cursor);
  const tagIds = input.tagIds ?? [];

  const q = (input.q ?? '').trim();
  if (q.length > 0 && q.length < MIN_SEARCH_QUERY_LENGTH) {
    throw new ApiError(
      ERROR_CODES.SEARCH_QUERY_TOO_SHORT,
      `搜索关键词至少 ${MIN_SEARCH_QUERY_LENGTH} 个字符`,
    );
  }

  // Trash = soft-deleted. `archived` is a separate user flag on live notes.
  const archivedMode = input.archived ?? 'false';
  const folderFilter = input.rootOnly ? null : input.folderId === undefined ? undefined : input.folderId;

  const rows = await sql`
    select
      n.id, n.folder_id, n.title, n.body_text, n.is_pinned, n.is_archived, n.deleted_at,
      n.position, n.word_count, n.created_at, n.content_updated_at, n.updated_at,
      coalesce(array_agg(nt.tag_id) filter (where nt.tag_id is not null), '{}') as tag_ids
    from notes n
    left join note_tags nt on nt.note_id = n.id
    where n.owner_id = ${ownerId}
      and ${visibilityClause(sql, archivedMode)}
      and ${folderClause(sql, folderFilter)}
      and ${searchClause(sql, q)}
      and ${tagClause(sql, tagIds)}
    group by n.id
    order by ${sql.unsafe(ORDER_BY[sort])}
    limit ${limit} offset ${offset}
  `;

  const countRows = await sql`
    select count(*)::int as total
    from notes n
    where n.owner_id = ${ownerId}
      and ${visibilityClause(sql, archivedMode)}
      and ${folderClause(sql, folderFilter)}
      and ${searchClause(sql, q)}
      and ${tagClause(sql, tagIds)}
  `;
  const total = Number(countRows[0]?.total ?? 0);

  const items = rows.map((row) => {
    const record = mapRow(row);
    return toSummary(record, q);
  });

  const nextOffset = offset + items.length;
  return {
    items,
    nextCursor: nextOffset < total ? encodeCursor(nextOffset) : null,
    total,
  };
}

/**
 * Trash vs. archive are distinct states: `deleted_at` marks the trash, `is_archived` is a
 * user-facing flag on a live note. The three modes map onto those two columns.
 */
function visibilityClause(sql: Sql, mode: 'true' | 'false' | 'only') {
  if (mode === 'only') return sql`n.deleted_at is not null`;
  if (mode === 'true') return sql`n.deleted_at is null and n.is_archived = true`;
  return sql`n.deleted_at is null and n.is_archived = false`;
}

function folderClause(sql: Sql, folderId: string | null | undefined) {
  if (folderId === undefined) return sql`true`;
  if (folderId === null) return sql`n.folder_id is null`;
  return sql`n.folder_id = ${folderId}`;
}

function searchClause(sql: Sql, q: string) {
  if (!q) return sql`true`;
  const pattern = `%${escapeLike(q)}%`;
  return sql`(n.title || ' ' || n.body_text) ilike ${pattern}`;
}

function tagClause(sql: Sql, tagIds: string[]) {
  if (tagIds.length === 0) return sql`true`;
  // AND semantics: the note must carry every selected tag.
  return sql`(
    select count(*) from note_tags nt2
    where nt2.note_id = n.id and nt2.tag_id = any(${tagIds}::text[])
  ) >= ${tagIds.length}`;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Note list rows never carry the full body — only a short excerpt and optional match context. */
export function toSummary(record: NoteRecord, query = ''): NoteSummaryDto {
  const summary: NoteSummaryDto = {
    id: record.id,
    title: record.title,
    folderId: record.folderId,
    tagIds: record.tagIds,
    excerpt: makeShortExcerpt(record.bodyText, 200),
    pinned: record.isPinned,
    archived: record.isArchived,
    position: record.position,
    wordCount: record.wordCount,
    createdAt: record.createdAt.toISOString(),
    contentUpdatedAt: record.contentUpdatedAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
  if (query) {
    const matches = findMatches(record.bodyText, query, 3);
    if (matches.length > 0) summary.matches = matches;
  }
  return summary;
}

function makeShortExcerpt(body: string, length: number): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  if (flat.length <= length) return flat;
  return `${flat.slice(0, length).trimEnd()}…`;
}

/** Short context windows around each occurrence of the query, for search result highlighting. */
export function findMatches(body: string, query: string, max = 3): string[] {
  if (!query) return [];
  const haystack = body.toLowerCase();
  const needle = query.toLowerCase();
  const out: string[] = [];
  let from = 0;
  while (out.length < max) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    const start = Math.max(0, at - 30);
    const end = Math.min(body.length, at + needle.length + 30);
    const snippet = body.slice(start, end).replace(/\s+/g, ' ').trim();
    out.push(`${start > 0 ? '…' : ''}${snippet}${end < body.length ? '…' : ''}`);
    from = at + needle.length;
  }
  return out;
}

/* -------------------------------- mutations ------------------------------- */

export interface NoteMetaPatch {
  folderId?: string | null;
  pinned?: boolean;
  archived?: boolean;
  deletedAt?: string | null;
  position?: string;
  title?: string;
  tagIds?: string[];
}

/**
 * Apply a metadata change through the CRDT.
 *
 * Using a direct connection means every other connected device receives the change as an
 * ordinary Yjs update. The mirror is then refreshed inline so the HTTP response cannot be
 * stale relative to the debounced store hook.
 */
export async function patchNoteMeta(
  deps: NotesDeps,
  ownerId: string,
  noteId: string,
  patch: NoteMetaPatch,
): Promise<NoteRecord> {
  const existing = await getNote(deps, ownerId, noteId, { includeDeleted: true });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, '笔记不存在');

  if (patch.folderId !== undefined) {
    await assertFolderUsable(deps.sql, ownerId, patch.folderId ?? null);
  }

  const hocuspocus = deps.getHocuspocus();
  const docName = noteDocName(noteId);

  const metaPatch: Parameters<typeof writeNoteMeta>[1] = {};
  if (patch.folderId !== undefined) metaPatch.folderId = patch.folderId;
  if (patch.pinned !== undefined) metaPatch.pinned = patch.pinned;
  if (patch.archived !== undefined) metaPatch.archived = patch.archived;
  if (patch.deletedAt !== undefined) metaPatch.deletedAt = patch.deletedAt;
  if (patch.position !== undefined) metaPatch.position = patch.position;
  if (patch.title !== undefined) {
    metaPatch.title = patch.title;
    metaPatch.titleManual = true;
  }

  if (hocuspocus) {
    const { snapshot } = await mutateDocument(hocuspocus, docName, (doc) => {
      writeNoteMeta(doc, metaPatch);
      if (patch.tagIds) setTagIds(doc, patch.tagIds);
    });
    const projected = docFromSnapshot(snapshot);
    await deps.sql.begin((tx) => mirrorNote(tx, noteId, ownerId, projected));
  } else {
    // No collab server (unit-test path): mutate a detached doc seeded from storage.
    const doc = await loadStoredDoc(deps.sql, noteId);
    writeNoteMeta(doc, metaPatch);
    if (patch.tagIds) setTagIds(doc, patch.tagIds);
    await deps.sql.begin(async (tx) => {
      await tx`
        update note_documents set ydoc = ${encodeBytea(Y.encodeStateAsUpdate(doc))}::bytea, updated_at = now()
        where note_id = ${noteId}
      `;
      await mirrorNote(tx, noteId, ownerId, doc);
    });
  }

  const updated = await getNote(deps, ownerId, noteId, { includeDeleted: true });
  if (!updated) throw new ApiError(ERROR_CODES.NOT_FOUND, '笔记不存在');
  return updated;
}

/** Read the stored CRDT state for a note (used when no collab server is attached). */
export async function loadStoredDoc(sql: Sql, noteId: string): Promise<Y.Doc> {
  const rows = await sql`select ydoc from note_documents where note_id = ${noteId}`;
  const bytes = decodeBytea(rows[0]?.ydoc);
  const doc = new Y.Doc();
  if (bytes && bytes.byteLength > 0) Y.applyUpdate(doc, bytes);
  return doc;
}

/** Read the authoritative markdown body straight from the CRDT document. */
export async function readNoteBody(deps: NotesDeps, ownerId: string, noteId: string): Promise<string> {
  const existing = await getNote(deps, ownerId, noteId, { includeDeleted: true });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, '笔记不存在');
  const doc = await loadStoredDoc(deps.sql, noteId);
  return readBody(doc);
}

/* ------------------------------ quick capture ----------------------------- */

/** Format the timestamp header inserted above a quick capture. */
export function formatStamp(format: StampFormat, at: Date = new Date()): string {
  if (format === 'none') return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = at.getFullYear();
  const mo = pad(at.getMonth() + 1);
  const d = pad(at.getDate());
  const hh = pad(at.getHours());
  const mm = pad(at.getMinutes());
  if (format === 'heading') return `## ${y}-${mo}-${d} ${hh}:${mm}`;
  return `- [${hh}:${mm}]`;
}

export interface QuickCaptureResult {
  noteId: string;
  appendedChars: number;
  body: string;
}

/**
 * Append a quick capture to the end of a note body through the CRDT.
 *
 * Appending at the document end is what makes this safe across devices: a capture taken while
 * another device edits the middle of the same note merges without either change being lost.
 */
export async function appendQuickCapture(
  deps: NotesDeps,
  ownerId: string,
  noteId: string,
  text: string,
  stampFormat: StampFormat = 'heading',
): Promise<QuickCaptureResult> {
  if (!STAMP_FORMATS.includes(stampFormat)) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '未知的时间戳格式');
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new ApiError(ERROR_CODES.BAD_REQUEST, '速记内容不能为空');

  const existing = await getNote(deps, ownerId, noteId, { includeDeleted: true });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, '收集箱笔记不存在');

  const stamp = formatStamp(stampFormat);
  const payload = stamp ? `${stamp}\n\n${trimmed}` : trimmed;

  const hocuspocus = deps.getHocuspocus();
  let appended = 0;
  let snapshot: Uint8Array;

  if (hocuspocus) {
    const outcome = await mutateDocument(hocuspocus, noteDocName(noteId), (doc) => {
      appended = appendToBody(doc, payload);
    });
    snapshot = outcome.snapshot;
  } else {
    const doc = await loadStoredDoc(deps.sql, noteId);
    appended = appendToBody(doc, payload);
    snapshot = Y.encodeStateAsUpdate(doc);
    await deps.sql`
      update note_documents set ydoc = ${encodeBytea(snapshot)}::bytea, updated_at = now()
      where note_id = ${noteId}
    `;
  }

  const projected = docFromSnapshot(snapshot);
  await deps.sql.begin((tx) => mirrorNote(tx, noteId, ownerId, projected));

  return { noteId, appendedChars: appended, body: projected.getText(NOTE_KEYS.body).toString() };
}

/* -------------------------------- ordering -------------------------------- */

/** Compute the position key that lands a note between two neighbours in the same folder. */
export function positionBetween(before: string | null | undefined, after: string | null | undefined): string {
  if (!before && !after) return firstKey();
  return keyBetween(before ?? null, after ?? null);
}
