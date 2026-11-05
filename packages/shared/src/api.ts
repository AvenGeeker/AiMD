import { z } from 'zod';
import {
  ALLOWED_ATTACHMENT_MIME,
  DEFAULT_PAGE_SIZE,
  EDITOR_MODES,
  MAX_PAGE_SIZE,
  NOTE_SORTS,
  STAMP_FORMATS,
  THEMES,
  FAVORITE_CATEGORY_PRESETS,
} from './constants.js';
import {
  CAPTURE_STATUSES,
  FAVORITE_CATEGORY_STATUSES,
  MEDIA_STATUSES,
  SOURCE_PLATFORMS,
} from './crdt.js';

/**
 * Wire contracts for the REST API. The server uses these for request validation and
 * response serialisation; clients use the inferred types so the two can never drift.
 */

const isoDateTime = z.string();
const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, '状态哈希格式不正确');

/* ---------------------------------- auth ---------------------------------- */

export const passwordSchema = z.string().min(8, '密码至少 8 位').max(128);

export const registerInput = z.object({
  email: z.email('邮箱格式不正确').toLowerCase(),
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(60).optional(),
});
export type RegisterInput = z.infer<typeof registerInput>;

export const loginInput = z.object({
  email: z.email('邮箱格式不正确').toLowerCase(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginInput>;

export const userDto = z.object({
  id: idSchema,
  email: z.string(),
  displayName: z.string(),
  createdAt: isoDateTime,
});
export type UserDto = z.infer<typeof userDto>;

/**
 * Session payload for cookie-based clients (the browser).
 *
 * The refresh token is deliberately absent: it lives only in an httpOnly cookie, so a XSS in the
 * web client cannot exfiltrate a long-lived credential.
 */
export const authSessionDto = z.object({
  user: userDto,
  accessToken: z.string(),
  expiresIn: z.number().int().positive(),
});
export type AuthSessionDto = z.infer<typeof authSessionDto>;

/**
 * Session payload for bearer clients (the Electron desktop app), which cannot use httpOnly
 * cookies and instead keep the refresh token in the OS keychain via `safeStorage`.
 *
 * Returned only when the request opts in with `X-Token-Transport: bearer`.
 */
export const bearerSessionDto = authSessionDto.extend({
  refreshToken: z.string(),
});
export type BearerSessionDto = z.infer<typeof bearerSessionDto>;

/** Header a non-browser client sends to request bearer-style session payloads. */
export const TOKEN_TRANSPORT_HEADER = 'x-token-transport';
export const BEARER_TRANSPORT = 'bearer';

/* -------------------------------- settings -------------------------------- */

export const settingsDto = z.object({
  inboxNoteId: idSchema.nullable(),
  hotkey: z.string().min(1).max(64),
  mainWindowHotkey: z.string().min(1).max(64),
  favoriteHotkey: z.string().min(1).max(64),
  theme: z.enum(THEMES),
  editorMode: z.enum(EDITOR_MODES),
  fontSize: z.number().int().min(10).max(24),
  stampFormat: z.enum(STAMP_FORMATS),
  hideOnBlur: z.boolean(),
  minimizeToTray: z.boolean(),
  launchAtLogin: z.boolean(),
  favoritesFolderId: idSchema.nullable(),
  favoritesInboxFolderId: idSchema.nullable(),
});
export type SettingsDto = z.infer<typeof settingsDto>;

/** System folder ids are informational and must never be writable through the settings API. */
export const settingsPatchInput = settingsDto
  .omit({ favoritesFolderId: true, favoritesInboxFolderId: true })
  .partial();
export type SettingsPatchInput = z.infer<typeof settingsPatchInput>;

/* --------------------------------- folder --------------------------------- */

export const folderDto = z.object({
  id: idSchema,
  name: z.string(),
  parentId: idSchema.nullable(),
  position: z.string(),
  noteCount: z.number().int().nonnegative(),
  createdAt: isoDateTime,
});
export type FolderDto = z.infer<typeof folderDto>;

export const createFolderInput = z.object({
  /** Optional client id for idempotent sync imports. */
  id: idSchema.optional(),
  name: z.string().trim().min(1, '目录名不能为空').max(120),
  parentId: idSchema.nullable().optional(),
});
export type CreateFolderInput = z.infer<typeof createFolderInput>;

export const updateFolderInput = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  parentId: idSchema.nullable().optional(),
  /** Neighbouring keys of the target slot; the server derives the new position. */
  before: z.string().nullish(),
  after: z.string().nullish(),
});
export type UpdateFolderInput = z.infer<typeof updateFolderInput>;

/* ---------------------------------- tag ----------------------------------- */

export const tagDto = z.object({
  id: idSchema,
  name: z.string(),
  color: z.string(),
  noteCount: z.number().int().nonnegative(),
});
export type TagDto = z.infer<typeof tagDto>;

export const tagColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, '颜色必须是 #RRGGBB');

export const upsertTagInput = z.object({
  id: idSchema.optional(),
  name: z.string().trim().min(1).max(40),
  color: tagColorSchema.optional(),
});
export type UpsertTagInput = z.infer<typeof upsertTagInput>;

/* ---------------------------------- note ---------------------------------- */

export const sourcePlatformSchema = z.enum(SOURCE_PLATFORMS);
export const captureStatusSchema = z.enum(CAPTURE_STATUSES);
export const mediaStatusSchema = z.enum(MEDIA_STATUSES);
export const favoriteCategoryStatusSchema = z.enum(FAVORITE_CATEGORY_STATUSES);

export const noteSourceDto = z.object({
  url: z.string().nullable(),
  platform: sourcePlatformSchema.nullable(),
  author: z.string().nullable(),
  coverAttachmentId: idSchema.nullable(),
  originalTitle: z.string().nullable(),
  collectedAt: isoDateTime.nullable(),
  captureStatus: captureStatusSchema.nullable(),
});
export type NoteSourceDto = z.infer<typeof noteSourceDto>;

export const noteCategoryDto = z.object({
  folderId: idSchema.nullable(),
  name: z.string().nullable(),
  status: favoriteCategoryStatusSchema,
  suggestion: z.string().nullable(),
  updatedAt: isoDateTime.nullable(),
  error: z.string().nullable(),
});
export type NoteCategoryDto = z.infer<typeof noteCategoryDto>;

export const noteSummaryDto = z.object({
  id: idSchema,
  title: z.string(),
  folderId: idSchema.nullable(),
  tagIds: z.array(idSchema),
  /** First ~200 chars of the body, used for list previews. Never the full text. */
  excerpt: z.string(),
  pinned: z.boolean(),
  archived: z.boolean(),
  position: z.string(),
  wordCount: z.number().int().nonnegative(),
  createdAt: isoDateTime,
  contentUpdatedAt: isoDateTime,
  updatedAt: isoDateTime,
  /** Present for favourites; null for ordinary notes. */
  source: noteSourceDto.nullable(),
  mediaStatus: mediaStatusSchema,
  aiCategory: noteCategoryDto.nullable(),
  /**
   * One-paragraph AI summary when the note has been analysed; null otherwise. List cards prefer
   * this over `excerpt` so favourites never show raw markdown scaffolding.
   */
  aiSummary: z.string().nullable(),
  /** Present only for search results. */
  matches: z.array(z.string()).optional(),
});
export type NoteSummaryDto = z.infer<typeof noteSummaryDto>;

export const noteDto = noteSummaryDto.extend({
  body: z.string(),
});
export type NoteDto = z.infer<typeof noteDto>;

export const createNoteInput = z.object({
  /** Optional client id for idempotent sync imports. */
  id: idSchema.optional(),
  /** Optional original creation time for imported notes. */
  createdAt: isoDateTime.optional(),
  title: z.string().trim().max(200).optional(),
  folderId: idSchema.nullable().optional(),
  tagIds: z.array(idSchema).max(50).optional(),
  body: z.string().max(2_000_000).optional(),
  position: z.string().optional(),
});
export type CreateNoteInput = z.infer<typeof createNoteInput>;

export const updateNoteInput = z.object({
  folderId: idSchema.nullable().optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  /** Replaces the note's whole tag set; the server diffs it into the CRDT array. */
  tagIds: z.array(idSchema).max(50).optional(),
  title: z.string().trim().max(200).optional(),
  /** Replaces the whole markdown body through mutateDocument(). */
  body: z.string().max(2_000_000).optional(),
  /** Atomic optimistic-concurrency guard: SHA-256 of [title, folderId, body]. */
  expectedStateHash: sha256HexSchema.optional(),
  before: z.string().nullish(),
  after: z.string().nullish(),
});
export type UpdateNoteInput = z.infer<typeof updateNoteInput>;

/** Batch body reads used by the desktop Apple Notes sync engine. */
export const noteBodyBatchInput = z.object({
  ids: z.array(idSchema).min(1).max(100),
});
export type NoteBodyBatchInput = z.infer<typeof noteBodyBatchInput>;

export const noteBodyDto = noteSummaryDto.extend({
  body: z.string(),
  /** SHA-256 of [title, folderId, body]; computed from the authoritative Y.Doc. */
  stateHash: sha256HexSchema,
});
export type NoteBodyDto = z.infer<typeof noteBodyDto>;

export const noteBodyBatchDto = z.object({
  items: z.array(noteBodyDto),
});
export type NoteBodyBatchDto = z.infer<typeof noteBodyBatchDto>;

/** Batch creation is idempotent when the caller supplies a stable id. */
export const createNotesBatchInput = z.object({
  items: z.array(createNoteInput).min(1).max(100),
});
export type CreateNotesBatchInput = z.infer<typeof createNotesBatchInput>;

export const createNotesBatchItemDto = z.object({
  index: z.number().int().nonnegative(),
  ok: z.boolean(),
  note: noteDto.optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});
export type CreateNotesBatchItemDto = z.infer<typeof createNotesBatchItemDto>;

export const createNotesBatchDto = z.object({
  items: z.array(createNotesBatchItemDto),
});
export type CreateNotesBatchDto = z.infer<typeof createNotesBatchDto>;


/* ------------------------------ batch mutations ---------------------------- */

/**
 * Multi-select note operations shared by the mobile and desktop shells.
 *
 * Every op except `destroy` is applied through each note's CRDT document (`mutateDocument()`),
 * so a batch action taken on a phone reaches every other connected device exactly like a single
 * edit does. `destroy` deletes the Postgres row and relies on the FK cascade to drop
 * `note_documents` / `note_tags`; the collab `store` hook already skips documents whose note row
 * disappeared, so a pending flush can neither resurrect the note nor take down the batch.
 */
export const NOTE_BATCH_OPS = [
  'trash',
  'restore',
  'destroy',
  'pin',
  'unpin',
  'move',
  'addTags',
  'removeTags',
] as const;
export type NoteBatchOp = (typeof NOTE_BATCH_OPS)[number];

/** Upper bound for one batch call; `scope` matches beyond it are reported as `truncated`. */
export const NOTE_BATCH_MAX_IDS = 200;

export const noteBatchInput = z
  .object({
    /** Explicit targets. Mutually exclusive with `scope`. */
    ids: z.array(idSchema).max(NOTE_BATCH_MAX_IDS).optional(),
    /** Server-resolved targets; `trashed` is every soft-deleted note of the caller. */
    scope: z.enum(['trashed']).optional(),
    op: z.enum(NOTE_BATCH_OPS),
    /** Required by `move`; `null` moves the notes to the root level. */
    folderId: idSchema.nullish(),
    /** Required by `addTags` / `removeTags`. */
    tagIds: z.array(idSchema).max(50).optional(),
  })
  .superRefine((value, ctx) => {
    const hasIds = value.ids !== undefined;
    const hasScope = value.scope !== undefined;
    if (hasIds === hasScope) {
      ctx.addIssue({
        code: 'custom',
        path: [hasIds ? 'ids' : 'scope'],
        message: 'ids 与 scope 必须二选一',
      });
      return;
    }
    if (hasIds && (value.ids ?? []).length === 0) {
      ctx.addIssue({ code: 'custom', path: ['ids'], message: '至少选择一篇笔记' });
      return;
    }
    if (value.op === 'move' && value.folderId === undefined) {
      ctx.addIssue({ code: 'custom', path: ['folderId'], message: '移动操作需要目标目录' });
      return;
    }
    const tagging = value.op === 'addTags' || value.op === 'removeTags';
    if (tagging && (value.tagIds ?? []).length === 0) {
      ctx.addIssue({ code: 'custom', path: ['tagIds'], message: '标签操作至少需要一个标签' });
      return;
    }
    if (
      !tagging &&
      value.op !== 'move' &&
      (value.folderId !== undefined || value.tagIds !== undefined)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['op'],
        message: `${value.op} 不接受 folderId / tagIds`,
      });
    }
  });
export type NoteBatchInput = z.infer<typeof noteBatchInput>;

export const noteBatchItemDto = z.object({
  id: idSchema,
  ok: z.boolean(),
  note: noteSummaryDto.optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});
export type NoteBatchItemDto = z.infer<typeof noteBatchItemDto>;

export const noteBatchDto = z.object({
  op: z.enum(NOTE_BATCH_OPS),
  /** Per-note outcomes; empty for `destroy`, which runs as one owner-scoped statement. */
  items: z.array(noteBatchItemDto),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  /** True when `scope` matched more notes than a single call is allowed to process. */
  truncated: z.boolean(),
});
export type NoteBatchDto = z.infer<typeof noteBatchDto>;

export const listNotesQuery = z.object({
  folderId: idSchema.nullish(),
  /**
   * Restrict to notes that live at the root level (no folder).
   *
   * A separate flag rather than `folderId=null`, because `"null"` is itself a legal id-shaped
   * string and would be silently treated as a folder that happens to have no notes.
   */
  rootOnly: z
    .enum(['true', 'false'])
    .nullish()
    .transform((v) => v === 'true'),
  tagIds: z.string().nullish(),
  /** Include notes in every descendant folder of `folderId`. */
  recursive: z
    .enum(['true', 'false'])
    .nullish()
    .transform((v) => v === 'true'),
  sourcePlatform: sourcePlatformSchema.nullish(),
  q: z.string().trim().max(200).nullish(),
  archived: z
    .enum(['true', 'false', 'only', 'all'])
    .nullish()
    .transform((v) => (v === undefined || v === null ? 'false' : v)),
  sort: z.enum(NOTE_SORTS).default('updated'),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  cursor: z.string().max(200).nullish(),
});
export type ListNotesQuery = z.infer<typeof listNotesQuery>;
export type ListNotesInput = z.input<typeof listNotesQuery>;

export const noteListDto = z.object({
  items: z.array(noteSummaryDto),
  nextCursor: z.string().nullable(),
  total: z.number().int().nonnegative(),
});
export type NoteListDto = z.infer<typeof noteListDto>;

/* ---------------------------------- tree ---------------------------------- */

export const treeDto = z.object({
  folders: z.array(folderDto),
  tags: z.array(tagDto),
  settings: settingsDto,
  /** Root-level notes are fetched separately; this is the tree skeleton only. */
  counts: z.object({
    notes: z.number().int().nonnegative(),
    trashed: z.number().int().nonnegative(),
    favorites: z.number().int().nonnegative(),
    favoritesPending: z.number().int().nonnegative(),
  }),
});
export type TreeDto = z.infer<typeof treeDto>;

/* ------------------------------- attachments ------------------------------ */

export const attachmentDto = z.object({
  id: idSchema,
  filename: z.string(),
  mime: z.string(),
  size: z.number().int().nonnegative(),
  url: z.string(),
  createdAt: isoDateTime,
});
export type AttachmentDto = z.infer<typeof attachmentDto>;

export const ALLOWED_ATTACHMENT_MIME_LIST: readonly string[] = ALLOWED_ATTACHMENT_MIME;

/* ------------------------------- import/export ---------------------------- */

export const importResultDto = z.object({
  createdNotes: z.number().int().nonnegative(),
  createdFolders: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })),
});
export type ImportResultDto = z.infer<typeof importResultDto>;

/* --------------------------------- health --------------------------------- */

export const healthDto = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  uptimeSeconds: z.number(),
  db: z.enum(['ok', 'error']),
  collab: z.enum(['ok', 'error']),
});
export type HealthDto = z.infer<typeof healthDto>;

/* ------------------------------- favourites ------------------------------- */

export const favoritePreviewInput = z.object({
  url: z.string().trim().min(1, '链接不能为空').max(2000),
});
export type FavoritePreviewInput = z.infer<typeof favoritePreviewInput>;

export const favoritePreviewDto = z.object({
  url: z.string(),
  platform: sourcePlatformSchema,
  title: z.string(),
  author: z.string().nullable(),
  coverUrl: z.string().nullable(),
  body: z.string(),
  excerpt: z.string(),
  imageCount: z.number().int().nonnegative(),
  videoDetected: z.boolean(),
  blocked: z.boolean(),
  blockReason: z.string().nullable(),
  warnings: z.array(z.string()),
  existingNoteId: idSchema.nullable(),
});
export type FavoritePreviewDto = z.infer<typeof favoritePreviewDto>;

export const favoriteSaveInput = z.object({
  url: z.string().trim().url('链接格式不正确').max(2000).nullable().optional(),
  platform: sourcePlatformSchema.optional(),
  /** Optional: the server derives a title from the page, URL, or body when omitted. */
  title: z.string().trim().max(200).optional().default(''),
  author: z.string().trim().max(120).nullable().optional(),
  body: z.string().max(8_000_000).default(''),
  coverUrl: z.string().trim().max(2000).nullable().optional(),
  folderId: idSchema.nullable().optional(),
  captureStatus: captureStatusSchema.default('manual'),
  forceNew: z.boolean().default(false),
  downloadImages: z.boolean().default(true),
});
export type FavoriteSaveInput = z.infer<typeof favoriteSaveInput>;

export const favoriteSaveResultDto = z.object({
  note: noteDto,
  created: z.boolean(),
  mediaJobQueued: z.boolean(),
  warnings: z.array(z.string()),
});
export type FavoriteSaveResultDto = z.infer<typeof favoriteSaveResultDto>;

export const favoriteCategoryInput = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set'),
    folderId: idSchema,
    name: z.string().trim().min(1).max(120),
  }),
  z.object({ action: z.literal('dismiss') }),
]);
export type FavoriteCategoryInput = z.infer<typeof favoriteCategoryInput>;

export const favoriteCategoryPresets = FAVORITE_CATEGORY_PRESETS;

/* ------------------------------ folder AI query ---------------------------- */

export const FOLDER_QUERY_MODES = ['qa', 'search', 'trip'] as const;
export const folderQueryModeSchema = z.enum(FOLDER_QUERY_MODES);
export type FolderQueryMode = (typeof FOLDER_QUERY_MODES)[number];

export const FOLDER_QUERY_STATUSES = ['queued', 'running', 'done', 'error', 'cancelled'] as const;
export const folderQueryStatusSchema = z.enum(FOLDER_QUERY_STATUSES);
export type FolderQueryStatus = (typeof FOLDER_QUERY_STATUSES)[number];

export const folderQueryInput = z.object({
  mode: folderQueryModeSchema,
  question: z.string().trim().min(1, '问题不能为空').max(4000),
  allowWebSearch: z.boolean().default(false),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(4000),
      }),
    )
    .max(12)
    .default([]),
});
export type FolderQueryInput = z.infer<typeof folderQueryInput>;

export const folderWebSourceDto = z.object({
  title: z.string(),
  url: z.string(),
});
export type FolderWebSourceDto = z.infer<typeof folderWebSourceDto>;

export const folderQueryDto = z.object({
  id: idSchema,
  folderId: idSchema,
  mode: folderQueryModeSchema,
  status: folderQueryStatusSchema,
  question: z.string(),
  answer: z.string(),
  citations: z.array(noteSummaryDto),
  webSources: z.array(folderWebSourceDto),
  webSearchUsed: z.boolean(),
  truncated: z.boolean(),
  error: z.string().nullable(),
  createdAt: isoDateTime,
  finishedAt: isoDateTime.nullable(),
});
export type FolderQueryDto = z.infer<typeof folderQueryDto>;

export const folderQueryEnvelopeDto = z.object({ query: folderQueryDto });
export type FolderQueryEnvelopeDto = z.infer<typeof folderQueryEnvelopeDto>;

/* ------------------------------- quick capture ---------------------------- */

/**
 * Payload the Electron main process forwards to the quick-capture window renderer,
 * and the payload the renderer submits back.
 */
export const quickCaptureSubmitInput = z.object({
  text: z.string().min(1).max(20_000),
  stampFormat: z.enum(STAMP_FORMATS).optional(),
});
export type QuickCaptureSubmitInput = z.infer<typeof quickCaptureSubmitInput>;

export const quickCaptureResultDto = z.object({
  ok: z.boolean(),
  noteId: idSchema.nullable(),
  appendedChars: z.number().int().nonnegative(),
  message: z.string().nullish(),
});
export type QuickCaptureResultDto = z.infer<typeof quickCaptureResultDto>;
