import { z } from 'zod';
import {
  ALLOWED_ATTACHMENT_MIME,
  DEFAULT_PAGE_SIZE,
  EDITOR_MODES,
  MAX_PAGE_SIZE,
  NOTE_SORTS,
  STAMP_FORMATS,
  THEMES,
} from './constants.js';

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
  theme: z.enum(THEMES),
  editorMode: z.enum(EDITOR_MODES),
  fontSize: z.number().int().min(10).max(24),
  stampFormat: z.enum(STAMP_FORMATS),
  hideOnBlur: z.boolean(),
  minimizeToTray: z.boolean(),
  launchAtLogin: z.boolean(),
});
export type SettingsDto = z.infer<typeof settingsDto>;

export const settingsPatchInput = settingsDto.partial();
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
