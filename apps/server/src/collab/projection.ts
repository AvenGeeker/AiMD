import type * as Y from 'yjs';
import { countWords, deriveTitle, makeExcerpt } from '@aimarkdown/markdown';
import type { AiResultDto, FolderEntry, NoteAiState, NoteMediaState, TagEntry, WorkspaceSettings } from '@aimarkdown/shared';
import { readAiState, readAiTodos, readBody, readFolders, readMedia, readNoteMeta, readSettings, readSource, readTagIds, readTags } from './docFactory.js';

/**
 * Project CRDT state into the flat shape Postgres stores.
 *
 * This is the only place that knows how to turn a Y.Doc into relational rows. The Hocuspocus
 * store hook calls it, and the same functions back the import pipeline and the unit tests, so
 * "what the doc says" and "what the mirror says" can never disagree by construction.
 */

export interface NoteProjection {
  title: string;
  bodyText: string;
  wordCount: number;
  excerpt: string;
  folderId: string | null;
  tagIds: string[];
  pinned: boolean;
  archived: boolean;
  deletedAt: Date | null;
  position: string;
  createdAt: Date;
  /** True when the title was derived from the body rather than set by the user. */
  titleIsAuto: boolean;
  aiStatus: NoteAiState['status'];
  aiResult: AiResultDto | null;
  aiGeneratedAt: Date | null;
  aiSourceHash: string | null;
  aiError: string | null;
  aiAutoAttemptedAt: string | null;
  source: NoteSourceProjection | null;
  mediaStatus: NoteMediaState['status'];
  aiCategoryFolderId: string | null;
  aiCategoryName: string | null;
  aiCategoryStatus: NoteAiState['categoryStatus'];
  aiCategorySuggestion: string | null;
  aiCategoryAt: Date | null;
  aiCategoryError: string | null;
}

export interface NoteSourceProjection {
  url: string | null;
  platform: string | null;
  author: string | null;
  coverAttachmentId: string | null;
  originalTitle: string | null;
  collectedAt: Date | null;
  captureStatus: string | null;
}

function toDate(value: string | null | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function toNullableDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function projectNote(doc: Y.Doc, now: Date = new Date()): NoteProjection {
  const meta = readNoteMeta(doc);
  const bodyText = readBody(doc);
  const titleIsAuto = !meta.titleManual;
  const title = titleIsAuto ? deriveTitle(bodyText, meta.title) : meta.title;
  const ai = readAiState(doc);
  const aiTodos = readAiTodos(doc);
  const source = readSource(doc);
  const media = readMedia(doc);
  const hasSource = Boolean(source.url || source.platform || source.author || source.collectedAt);
  const aiResult: AiResultDto | null = ai.generatedAt
    ? {
        summary: ai.summary,
        keyPoints: ai.keyPoints,
        todos: aiTodos,
        model: ai.model ?? '',
      }
    : null;

  return {
    title: title.length > 0 ? title : deriveTitle('', meta.title),
    bodyText,
    wordCount: countWords(bodyText),
    excerpt: makeExcerpt(bodyText, 200),
    folderId: meta.folderId,
    tagIds: readTagIds(doc),
    pinned: meta.pinned,
    archived: meta.archived,
    deletedAt: meta.deletedAt ? toDate(meta.deletedAt, now) : null,
    position: meta.position,
    createdAt: toDate(meta.createdAt, now),
    titleIsAuto,
    aiStatus: ai.status,
    aiResult,
    aiGeneratedAt: toNullableDate(ai.generatedAt),
    aiSourceHash: ai.sourceHash,
    aiError: ai.error,
    aiAutoAttemptedAt: ai.autoAttemptedAt,
    source: hasSource
      ? {
          url: source.url,
          platform: source.platform,
          author: source.author,
          coverAttachmentId: source.coverAttachmentId,
          originalTitle: source.originalTitle,
          collectedAt: toNullableDate(source.collectedAt),
          captureStatus: source.captureStatus,
        }
      : null,
    mediaStatus: media.status,
    aiCategoryFolderId: ai.categoryFolderId,
    aiCategoryName: ai.categoryName,
    aiCategoryStatus: ai.categoryStatus,
    aiCategorySuggestion: ai.categorySuggestion,
    aiCategoryAt: toNullableDate(ai.categoryAt),
    aiCategoryError: ai.categoryError,
  };
}

export interface WorkspaceProjection {
  folders: FolderEntry[];
  tags: TagEntry[];
  settings: WorkspaceSettings;
}

export function projectWorkspace(doc: Y.Doc): WorkspaceProjection {
  return {
    folders: readFolders(doc),
    tags: readTags(doc),
    settings: readSettings(doc),
  };
}

/**
 * Validate a folder tree, dropping self-parenting and cyclic edges.
 *
 * The tree lives in a CRDT that merges without coordination, so a cycle can legitimately
 * appear after two offline devices each move the same folder. Rather than failing the store,
 * the cycle is broken deterministically (every device resolves it the same way) so the mirror
 * stays a valid tree.
 *
 * @returns the list of folder ids whose `parentId` had to be nulled.
 */
export function sanitizeFolderTree(folders: FolderEntry[]): string[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const repaired: string[] = [];

  for (const folder of folders) {
    if (!folder.parentId) continue;
    if (folder.parentId === folder.id) {
      folder.parentId = null;
      repaired.push(folder.id);
      continue;
    }
    // Walk up; if we return to `folder.id` there is a cycle.
    const seen = new Set<string>([folder.id]);
    let cursor = byId.get(folder.parentId);
    let cyclic = false;
    while (cursor) {
      if (seen.has(cursor.id)) {
        cyclic = true;
        break;
      }
      seen.add(cursor.id);
      if (!cursor.parentId) break;
      cursor = byId.get(cursor.parentId);
    }
    // A parent that no longer exists is not a cycle, but it must still be detached.
    const dangling = !byId.has(folder.parentId);
    if (cyclic || dangling) {
      folder.parentId = null;
      repaired.push(folder.id);
    }
  }
  return repaired;
}
