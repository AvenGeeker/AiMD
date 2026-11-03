import { Database } from '@hocuspocus/extension-database';
import type { ISql, Sql } from 'postgres';
import type * as Y from 'yjs';
import { parseDocName } from '@aimarkdown/shared';
import { decodeBytea, encodeBytea } from '../db/bytea.js';
import { projectNote, projectWorkspace, sanitizeFolderTree, type NoteProjection } from './projection.js';
import type { Logger } from '../utils/logger.js';

/**
 * CRDT persistence + the Postgres mirror.
 *
 * `fetch` loads the stored document state; `store` writes the binary state **and** refreshes
 * the relational projection in a single transaction, so the read-model can never lag behind
 * the document it was derived from. Everything a client sees in lists, trees and search comes
 * from that projection.
 */

type Tx = ISql;

export interface NoteStoredEvent {
  noteId: string;
  ownerId: string;
  projection: NoteProjection;
}

export interface PersistenceDeps {
  sql: Sql;
  log: Logger;
  onNoteStored?(event: NoteStoredEvent): void | Promise<void>;
}

/** Write the projected note state into `notes` / `note_tags`. */
export async function mirrorNote(
  tx: Tx,
  noteId: string,
  ownerId: string,
  doc: Y.Doc,
  now: Date = new Date(),
): Promise<NoteProjection> {
  const projection = projectNote(doc, now);

  // `folder_id` is resolved through a correlated subquery: a folder created on another device
  // may not have reached the mirror yet, and a dangling FK would abort the whole store.
  await tx`
    update notes set
      title              = ${projection.title},
      body_text          = ${projection.bodyText},
      word_count         = ${projection.wordCount},
      folder_id          = (
        select f.id from folders f
        where f.id = ${projection.folderId} and f.owner_id = notes.owner_id
      ),
      is_pinned          = ${projection.pinned},
      is_archived        = ${projection.archived},
      deleted_at         = ${projection.deletedAt},
      position           = ${projection.position},
      ai_status          = ${projection.aiStatus},
      ai_result          = ${JSON.stringify(projection.aiResult ?? {})}::jsonb,
      ai_generated_at    = ${projection.aiGeneratedAt},
      ai_source_hash     = ${projection.aiSourceHash},
      ai_error           = ${projection.aiError},
      source_url         = ${projection.source?.url ?? null},
      source_platform    = ${projection.source?.platform ?? null},
      source_author      = ${projection.source?.author ?? null},
      source_cover_id    = ${projection.source?.coverAttachmentId ?? null},
      source_original_title = ${projection.source?.originalTitle ?? null},
      collected_at       = ${projection.source?.collectedAt ?? null},
      capture_status     = ${projection.source?.captureStatus ?? null},
      media_status       = ${projection.mediaStatus},
      ai_category_folder_id = ${projection.aiCategoryFolderId},
      ai_category_name   = ${projection.aiCategoryName},
      ai_category_status = ${projection.aiCategoryStatus},
      ai_category_suggestion = ${projection.aiCategorySuggestion},
      ai_category_at     = ${projection.aiCategoryAt},
      ai_category_error  = ${projection.aiCategoryError},
      content_updated_at = case
        when notes.body_text is distinct from ${projection.bodyText} then ${now}
        else notes.content_updated_at
      end,
      updated_at         = ${now}
    where id = ${noteId} and owner_id = ${ownerId}
  `;

  // Replace the tag links, restricted to tags this user actually owns. A tag id that no
  // longer exists (deleted on another device) is silently dropped, so the mirror self-heals.
  await tx`delete from note_tags where note_id = ${noteId}`;
  if (projection.tagIds.length > 0) {
    await tx`
      insert into note_tags (note_id, tag_id)
      select ${noteId}, t.id from tags t
      where t.owner_id = ${ownerId} and t.id = any(${projection.tagIds}::text[])
      on conflict do nothing
    `;
  }
  return projection;
}

/**
 * Write the projected workspace state into `folders` / `tags` / `user_settings`.
 *
 * @returns folder ids whose `parentId` had to be detached to break a CRDT merge cycle.
 */
export async function mirrorWorkspace(
  tx: Tx,
  userId: string,
  doc: Y.Doc,
  log?: Logger,
): Promise<string[]> {
  const projection = projectWorkspace(doc);
  const now = new Date();

  await tx`
    insert into user_settings (user_id, settings, updated_at)
    values (${userId}, ${JSON.stringify(projection.settings)}::jsonb, ${now})
    on conflict (user_id) do update
      set settings = excluded.settings, updated_at = excluded.updated_at
  `;

  /* ---- folders ---- */
  const folders = projection.folders.map((folder) => ({ ...folder }));
  const repaired = sanitizeFolderTree(folders);
  if (repaired.length > 0) {
    // Not an error: a CRDT merge can legitimately produce a cycle, and every device breaks it
    // the same deterministic way. Logged so an operator can see it happened.
    log?.warn({ userId, folderIds: repaired }, 'folder tree cycle or dangling parent repaired');
  }

  const keepFolderIds = folders.map((folder) => folder.id);
  if (keepFolderIds.length === 0) {
    await tx`delete from folders where owner_id = ${userId}`;
  } else {
    await tx`delete from folders where owner_id = ${userId} and id != all(${keepFolderIds}::text[])`;
  }

  // Pass 1: upsert rows without parent links, so a child inserted before its parent cannot
  // violate the self-referencing FK. `on conflict` deliberately leaves parent_id alone here.
  for (const folder of folders) {
    await tx`
      insert into folders (id, owner_id, parent_id, name, position, created_at, updated_at)
      values (
        ${folder.id}, ${userId}, null, ${folder.name}, ${folder.position},
        ${folder.createdAt ? new Date(folder.createdAt) : now}, ${now}
      )
      on conflict (id) do update set
        name = excluded.name,
        position = excluded.position,
        updated_at = excluded.updated_at
    `;
  }
  // Pass 2: attach parents now that every row exists.
  for (const folder of folders) {
    if (!folder.parentId || folder.parentId === folder.id) continue;
    await tx`
      update folders set parent_id = ${folder.parentId}, updated_at = ${now}
      where id = ${folder.id} and owner_id = ${userId}
    `;
  }

  /* ---- tags ---- */
  const tags = projection.tags;
  const keepTagIds = tags.map((tag) => tag.id);
  if (keepTagIds.length === 0) {
    await tx`delete from tags where owner_id = ${userId}`;
  } else {
    await tx`delete from tags where owner_id = ${userId} and id != all(${keepTagIds}::text[])`;
  }
  for (const tag of tags) {
    await tx`
      insert into tags (id, owner_id, name, color)
      values (${tag.id}, ${userId}, ${tag.name}, ${tag.color || '#6b7280'})
      on conflict (id) do update set name = excluded.name, color = excluded.color
    `;
  }

  return repaired;
}

export function createCollabPersistence(deps: PersistenceDeps): Database {
  const { sql, log } = deps;

  return new Database({
    async fetch({ documentName }) {
      const parsed = parseDocName(documentName);
      if (!parsed.id) {
        log.warn({ documentName }, 'collab fetch for an unparseable document name');
        return null;
      }
      try {
        if (parsed.kind === 'note') {
          const rows = await sql`select ydoc from note_documents where note_id = ${parsed.id}`;
          return decodeBytea(rows[0]?.ydoc);
        }
        if (parsed.kind === 'workspace') {
          const rows = await sql`select ydoc from workspace_documents where user_id = ${parsed.id}`;
          return decodeBytea(rows[0]?.ydoc);
        }
      } catch (error) {
        log.error({ err: error, documentName }, 'collab fetch failed');
        throw error;
      }
      return null;
    },

    async store({ documentName, document, state }) {
      const parsed = parseDocName(documentName);
      // Capture into a const: TypeScript cannot keep the `parsed.id` narrowing across the
      // async transaction callback below.
      const docId = parsed.id;
      if (!docId) return;

      let storedEvent: NoteStoredEvent | null = null;
      try {
        await sql.begin(async (tx) => {
          if (parsed.kind === 'note') {
            const ownerRows = await tx`select owner_id from notes where id = ${docId}`;
            const ownerId = ownerRows[0]?.owner_id;
            if (typeof ownerId !== 'string') {
              // The note row is gone (hard delete) — drop the document instead of failing the
              // FK and taking down every other pending store in this batch.
              log.warn({ documentName }, 'store skipped: note row no longer exists');
              return;
            }
            await tx`
              insert into note_documents (note_id, ydoc, updated_at)
              values (${docId}, ${encodeBytea(state)}::bytea, now())
              on conflict (note_id) do update
                set ydoc = excluded.ydoc, updated_at = excluded.updated_at
            `;
            const projection = await mirrorNote(tx, docId, ownerId, document);
            storedEvent = { noteId: docId, ownerId, projection };
            return;
          }

          if (parsed.kind === 'workspace') {
            const userRows = await tx`select id from users where id = ${docId}`;
            if (userRows.length === 0) {
              log.warn({ documentName }, 'store skipped: user row no longer exists');
              return;
            }
            await tx`
              insert into workspace_documents (user_id, ydoc, updated_at)
              values (${docId}, ${encodeBytea(state)}::bytea, now())
              on conflict (user_id) do update
                set ydoc = excluded.ydoc, updated_at = excluded.updated_at
            `;
            await mirrorWorkspace(tx, docId, document, log);
          }
        });
      } catch (error) {
        log.error({ err: error, documentName }, 'collab store failed');
        throw error;
      }

      if (storedEvent) {
        try {
          await deps.onNoteStored?.(storedEvent);
        } catch (error) {
          log.error({ err: error, documentName }, 'post-store AI scheduling failed');
        }
      }
    },
  });
}

/** Exposed for tests: repaired-folder diagnostics from a projection. */
export function diagnoseFolderTree(doc: Y.Doc): string[] {
  const { folders } = projectWorkspace(doc);
  return sanitizeFolderTree(folders.map((folder) => ({ ...folder })));
}
