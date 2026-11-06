import { randomBytes } from 'node:crypto';
import type { Sql } from 'postgres';
import {
  ApiError,
  ERROR_CODES,
  noteDocName,
  publicNoteShareDto,
  type NoteShareDto,
  type PublicNoteShareDto,
} from '@aimarkdown/shared';
import { projectNote, type NoteProjection } from '../collab/projection.js';
import { toDateOr } from '../utils/dates.js';
import { getNote, loadStoredDoc, type NotesDeps } from './notes.js';

/**
 * Public note sharing.
 *
 * `note_shares` is the access-control truth: a row means the capability token is live. It is
 * intentionally separate from the note Y.Doc, because publishing a document is a server-side
 * permission decision, not editable note content.
 */

export interface ActiveShare {
  noteId: string;
  ownerId: string;
  createdAt: Date;
}

function newShareToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Build the public URL from the deployment's canonical origin (or the request origin). */
export function shareUrlFor(origin: string, token: string): string {
  return new URL(`/s/${token}`, origin).toString();
}

async function noteExists(
  deps: NotesDeps,
  ownerId: string,
  noteId: string,
  options: { includeDeleted?: boolean } = {},
): Promise<boolean> {
  return (await getNote(deps, ownerId, noteId, options)) !== null;
}

function toNoteShareDto(noteId: string, token: string | null, createdAt: Date | null, origin: string): NoteShareDto {
  return {
    noteId,
    enabled: token !== null,
    url: token ? shareUrlFor(origin, token) : null,
    createdAt: createdAt ? createdAt.toISOString() : null,
  };
}

/** Current share state for one owner-visible note. */
export async function getNoteShare(
  deps: NotesDeps,
  ownerId: string,
  noteId: string,
  origin: string,
): Promise<NoteShareDto> {
  if (!(await noteExists(deps, ownerId, noteId))) {
    throw new ApiError(ERROR_CODES.NOT_FOUND, '笔记不存在');
  }
  const rows = await deps.sql`
    select token, created_at from note_shares
    where note_id = ${noteId} and owner_id = ${ownerId}
  `;
  const row = rows[0];
  return toNoteShareDto(
    noteId,
    row ? String(row.token) : null,
    row ? toDateOr(row.created_at, new Date(0)) : null,
    origin,
  );
}

/**
 * Enable sharing. Idempotent while the row exists: repeated calls return the same URL so a
 * retried request cannot silently invalidate a link the user already sent.
 */
export async function enableNoteShare(
  deps: NotesDeps,
  ownerId: string,
  noteId: string,
  origin: string,
): Promise<NoteShareDto> {
  if (!(await noteExists(deps, ownerId, noteId))) {
    throw new ApiError(ERROR_CODES.NOT_FOUND, '笔记不存在');
  }

  const token = newShareToken();
  const rows = await deps.sql`
    insert into note_shares (note_id, owner_id, token, created_at, updated_at)
    values (${noteId}, ${ownerId}, ${token}, now(), now())
    on conflict (note_id) do update set updated_at = now()
    returning token, created_at
  `;
  const row = rows[0];
  if (!row) throw new ApiError(ERROR_CODES.INTERNAL, '分享链接创建失败');
  return toNoteShareDto(noteId, String(row.token), toDateOr(row.created_at, new Date(0)), origin);
}

/** Revoke sharing. The next enable call creates a brand-new token. */
export async function disableNoteShare(
  deps: NotesDeps,
  ownerId: string,
  noteId: string,
  origin: string,
): Promise<NoteShareDto> {
  if (!(await noteExists(deps, ownerId, noteId, { includeDeleted: true }))) {
    throw new ApiError(ERROR_CODES.NOT_FOUND, '笔记不存在');
  }
  await deps.sql`
    delete from note_shares where note_id = ${noteId} and owner_id = ${ownerId}
  `;
  return toNoteShareDto(noteId, null, null, origin);
}

/**
 * Resolve a token to a live share. Joining `notes` makes a trashed note inaccessible even if a
 * share row somehow survived a crash or an older code path.
 */
export async function resolveActiveShare(sql: Sql, token: string): Promise<ActiveShare | null> {
  const rows = await sql`
    select s.note_id, s.owner_id, s.created_at
    from note_shares s
    join notes n on n.id = s.note_id and n.owner_id = s.owner_id
    where s.token = ${token} and n.deleted_at is null
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    noteId: String(row.note_id),
    ownerId: String(row.owner_id),
    createdAt: toDateOr(row.created_at, new Date(0)),
  };
}

/**
 * Read the authoritative document projection.
 *
 * A loaded in-memory document wins: it holds edits that the debounced store has not written yet.
 * When nothing is loaded there is also nothing pending — Hocuspocus only removes a document from
 * `documents` once its store is no longer debounced or in flight — so the stored snapshot is
 * current. Deliberately *not* a direct connection: `unloadImmediately` would run a store (a full
 * ydoc write plus mirror refresh) on every anonymous page view.
 */
async function readLiveProjection(deps: NotesDeps, noteId: string): Promise<NoteProjection> {
  const live = deps.getHocuspocus()?.documents.get(noteDocName(noteId));
  if (live) return projectNote(live);
  const doc = await loadStoredDoc(deps.sql, noteId);
  return projectNote(doc);
}

/** Public read-only payload. Every invalid/revoked/trashed token gets the same 404. */
export async function readPublicNoteShare(
  deps: NotesDeps,
  token: string,
): Promise<PublicNoteShareDto> {
  const share = await resolveActiveShare(deps.sql, token);
  if (!share) throw new ApiError(ERROR_CODES.NOT_FOUND, '分享链接不存在或已关闭');

  const record = await getNote(deps, share.ownerId, share.noteId);
  if (!record) throw new ApiError(ERROR_CODES.NOT_FOUND, '分享链接不存在或已关闭');

  const projection = await readLiveProjection(deps, share.noteId);
  return publicNoteShareDto.parse({
    title: projection.title,
    body: projection.bodyText,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.contentUpdatedAt.toISOString(),
  });
}
