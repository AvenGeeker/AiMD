import type { Sql } from 'postgres';
import {
  ApiError,
  ERROR_CODES,
  type FavoritePreviewDto,
  type FavoriteSaveInput,
  type FavoriteSaveResultDto,
  type NoteSourceState,
  type SourcePlatform,
} from '@aimarkdown/shared';
import type { ServerConfig } from '../config.js';
import type { Logger } from '../utils/logger.js';
import { newId } from '../utils/ids.js';
import { PAGE_ACCEPT, safeFetch } from './safeFetch.js';
import { detectPlatform, extractPage } from './extract.js';
import type { AttachmentStorage } from '../services/storage.js';
import { createNote, getNote, loadStoredDoc, patchNoteMeta, toSummary, type NotesDeps } from '../services/notes.js';
import { createFolder, getSettings, type WorkspaceDeps } from '../services/workspace.js';
import type { AiService } from '../ai/service.js';
import { noteDocName } from '@aimarkdown/shared';
import { writeAiState, writeNoteMeta } from '../collab/docFactory.js';
import { docFromSnapshot, mutateDocument } from '../collab/direct.js';
import { mirrorNote } from '../collab/persistence.js';
import { pickDefaultFavoriteCategory } from './defaultCategory.js';
import * as Y from 'yjs';

export interface FavoriteDeps {
  sql: Sql;
  config: ServerConfig;
  log: Logger;
  storage: AttachmentStorage;
  notes: NotesDeps;
  workspace: WorkspaceDeps;
  ai: AiService | null;
}

interface PendingAttachment {
  id: string;
  filename: string;
  mime: string;
  size: number;
  storageKey: string;
}

function attachmentUrl(publicUrl: string, id: string): string {
  const base = publicUrl.replace(/\/+$/, '');
  return `${base}/api/attachments/${id}`;
}

function extensionFor(mime: string): string {
  const values: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/avif': 'avif',
  };
  return values[mime.split(';', 1)[0]!.trim().toLowerCase()] ?? 'bin';
}

/** Keep a specific platform detected from the original short link when a redirect lands on a generic page. */
function preferPlatform(primary: SourcePlatform, secondary: SourcePlatform): SourcePlatform {
  if (primary !== 'web') return primary;
  return secondary !== 'web' ? secondary : primary;
}

interface InitialCategory {
  folderId: string;
  name: string;
}

/**
 * Pick a real category before the note is inserted. This prevents every new favourite from
 * flashing through the system 待分类 folder while AI/media jobs are still running.
 */
async function resolveDefaultCategory(
  deps: FavoriteDeps,
  ownerId: string,
  input: { platform: SourcePlatform; title: string; body: string },
): Promise<InitialCategory | null> {
  const settings = await getSettings(deps.workspace, ownerId);
  const rootId = settings.favoritesFolderId;
  if (!rootId) return null;
  const rows = await deps.sql`
    select id, name from folders
    where owner_id = ${ownerId} and parent_id = ${rootId}
  `;
  const choice = pickDefaultFavoriteCategory({
    platform: input.platform,
    title: input.title,
    body: input.body,
    folders: rows.map((row) => ({ id: String(row.id), name: String(row.name) })),
    inboxFolderId: settings.favoritesInboxFolderId,
  });
  if (choice.folderId) return { folderId: choice.folderId, name: choice.name };
  const created = await createFolder(deps.workspace, ownerId, {
    name: choice.name,
    parentId: rootId,
  });
  return { folderId: created.id, name: created.name };
}

function initialCategoryAiState(category: InitialCategory) {
  return {
    categoryFolderId: category.folderId,
    categoryName: category.name,
    categoryStatus: 'done' as const,
    categorySuggestion: null,
    categoryAt: new Date().toISOString(),
    categoryError: null,
  };
}

function sourceBlock(platform: SourcePlatform, url: string | null, author: string | null): string {
  const label = platform === 'xiaohongshu'
    ? '小红书'
    : platform === 'douyin'
      ? '抖音'
      : platform === 'wechat'
        ? '微信公众号'
        : platform === 'manual'
          ? '手动收藏'
          : '网页';
  const lines = [`> 来源：${label}${author ? ` · ${author}` : ''}`];
  if (url) lines.push(`> 原文：${url}`);
  return lines.join('\n');
}

function imageUrlsInMarkdown(body: string): string[] {
  const urls = new Set<string>();
  const pattern = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of body.matchAll(pattern)) {
    if (match[1]) urls.add(match[1]);
  }
  return [...urls];
}

async function downloadImage(
  deps: FavoriteDeps,
  ownerId: string,
  url: string,
  referer: string | null,
): Promise<PendingAttachment | null> {
  try {
    const fetched = await safeFetch(url, {
      maxBytes: deps.config.LINK_FETCH_MAX_IMAGE_BYTES,
      timeoutMs: deps.config.LINK_FETCH_TIMEOUT_MS,
      referer: referer ?? undefined,
      accept: 'image/*,*/*;q=0.5',
      allowPrivate: deps.config.LINK_FETCH_ALLOW_PRIVATE,
    });
    const mime = fetched.contentType.split(';', 1)[0]!.trim().toLowerCase();
    if (!mime.startsWith('image/')) return null;
    const id = newId();
    const ext = extensionFor(mime);
    const storageKey = `${ownerId}/${id}.${ext}`;
    await deps.storage.save(storageKey, new Uint8Array(fetched.buffer));
    return {
      id,
      filename: `favorite-${id}.${ext}`,
      mime,
      size: fetched.buffer.byteLength,
      storageKey,
    };
  } catch (error) {
    deps.log.debug({ err: error, url }, 'favorite image download skipped');
    return null;
  }
}

async function localizeImages(
  deps: FavoriteDeps,
  ownerId: string,
  body: string,
  referer: string | null,
  coverUrl: string | null,
): Promise<{
  body: string;
  attachments: PendingAttachment[];
  coverAttachmentId: string | null;
  warnings: string[];
}> {
  const attachments: PendingAttachment[] = [];
  const warnings: string[] = [];
  const byUrl = new Map<string, PendingAttachment | null>();
  const urls = imageUrlsInMarkdown(body).slice(0, deps.config.LINK_FETCH_MAX_IMAGES);
  let total = 0;
  let nextBody = body;
  for (const url of urls) {
    if (total >= deps.config.LINK_FETCH_MAX_TOTAL_MEDIA_BYTES) {
      warnings.push('正文图片超过总大小限制，后续图片保留远程链接。');
      break;
    }
    const item = await downloadImage(deps, ownerId, url, referer);
    byUrl.set(url, item);
    if (!item) {
      warnings.push('部分图片下载失败，已保留远程链接。');
      continue;
    }
    total += item.size;
    attachments.push(item);
    nextBody = nextBody.split(url).join(attachmentUrl(deps.config.PUBLIC_URL, item.id));
  }
  let coverAttachmentId: string | null = null;
  if (coverUrl) {
    const existing = byUrl.get(coverUrl);
    const cover = existing === undefined ? await downloadImage(deps, ownerId, coverUrl, referer) : existing;
    if (cover) {
      coverAttachmentId = cover.id;
      if (!attachments.some((item) => item.id === cover.id)) attachments.push(cover);
    }
  }
  return { body: nextBody, attachments, coverAttachmentId, warnings };
}

async function insertAttachments(
  sql: Sql,
  ownerId: string,
  noteId: string,
  attachments: PendingAttachment[],
): Promise<void> {
  for (const item of attachments) {
    await sql`
      insert into attachments (id, owner_id, note_id, filename, mime, size, storage_key, created_at)
      values (${item.id}, ${ownerId}, ${noteId}, ${item.filename}, ${item.mime}, ${item.size}, ${item.storageKey}, now())
      on conflict (id) do nothing
    `;
  }
}

async function enqueueMediaJob(deps: FavoriteDeps, ownerId: string, noteId: string, imageIds: string[]): Promise<boolean> {
  if (imageIds.length === 0) return false;
  await deps.sql`
    insert into media_jobs (id, owner_id, note_id, status, image_ids)
    values (${newId()}, ${ownerId}, ${noteId}, 'queued', ${imageIds}::text[])
    on conflict do nothing
  `;
  return true;
}

async function enqueueClassification(deps: FavoriteDeps, ownerId: string, noteId: string): Promise<void> {
  if (!deps.ai) return;
  try {
    await deps.ai.enqueueFavorite(ownerId, noteId);
  } catch (error) {
    if (error instanceof ApiError && (error.code === ERROR_CODES.AI_NOT_CONFIGURED || error.code === ERROR_CODES.AI_DISABLED)) {
      return;
    }
    deps.log.warn({ err: error, noteId }, 'favorite classification enqueue failed');
  }
}

export async function previewFavorite(
  deps: FavoriteDeps,
  ownerId: string,
  rawUrl: string,
): Promise<FavoritePreviewDto> {
  let url: string;
  try {
    url = new URL(rawUrl).toString();
  } catch {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '链接格式不正确');
  }
  const fetched = await safeFetch(url, {
    maxBytes: deps.config.LINK_FETCH_MAX_BYTES,
    timeoutMs: deps.config.LINK_FETCH_TIMEOUT_MS,
    accept: PAGE_ACCEPT,
    allowPrivate: deps.config.LINK_FETCH_ALLOW_PRIVATE,
  });
  if (!fetched.contentType.includes('html')) {
    throw new ApiError(ERROR_CODES.FETCH_FAILED, '链接不是可解析的网页');
  }
  const extracted = extractPage(fetched.finalUrl, fetched.buffer.toString('utf8'));
  const existing = await deps.sql`
    select id from notes
    where owner_id = ${ownerId} and source_url = ${fetched.finalUrl} and deleted_at is null
    limit 1
  `;
  return {
    url: fetched.finalUrl,
    platform: extracted.platform,
    title: extracted.title,
    author: extracted.author,
    coverUrl: extracted.coverUrl,
    body: extracted.body,
    excerpt: extracted.body.replace(/\s+/g, ' ').slice(0, 200),
    imageCount: extracted.imageUrls.length,
    videoDetected: Boolean(extracted.videoUrl),
    blocked: extracted.blocked,
    blockReason: extracted.blockReason,
    warnings: extracted.warnings,
    existingNoteId: existing[0] ? String(existing[0].id) : null,
  };
}

export async function saveFavorite(
  deps: FavoriteDeps,
  ownerId: string,
  input: FavoriteSaveInput,
): Promise<FavoriteSaveResultDto> {
  const settings = await getSettings(deps.workspace, ownerId);
  let platform = input.platform ?? (input.url ? detectPlatform(input.url) : 'manual');
  let title = input.title.trim();
  let body = input.body.trim();
  let author = input.author?.trim() || null;
  let coverUrl = input.coverUrl?.trim() || null;
  let captureStatus = input.captureStatus;
  const warnings: string[] = [];

  if (input.url && body.length < 20) {
    try {
      const fetched = await safeFetch(input.url, {
        maxBytes: deps.config.LINK_FETCH_MAX_BYTES,
        timeoutMs: deps.config.LINK_FETCH_TIMEOUT_MS,
        accept: PAGE_ACCEPT,
        allowPrivate: deps.config.LINK_FETCH_ALLOW_PRIVATE,
      });
      if (fetched.contentType.includes('html')) {
        const extracted = extractPage(fetched.finalUrl, fetched.buffer.toString('utf8'));
        if (!input.platform) platform = preferPlatform(platform, extracted.platform);
        if (extracted.title && extracted.title !== '无标题') title = extracted.title;
        body = extracted.body.trim().length >= 20 ? extracted.body : '';
        author = author ?? extracted.author;
        coverUrl = coverUrl ?? extracted.coverUrl;
        warnings.push(...extracted.warnings);
        if (extracted.blocked) {
          warnings.push(extracted.blockReason ?? '目标平台限制了自动抓取，已只保存网址。');
        }
      } else {
        warnings.push('链接不是可解析的网页，已只保存网址。');
      }
    } catch (error) {
      warnings.push(
        error instanceof Error
          ? `未能解析网页内容，已只保存网址：${error.message.slice(0, 120)}`
          : '未能解析网页内容，已只保存网址。',
      );
    }
    if (body.length === 0) captureStatus = 'partial';
  }

  if (!title) {
    title = body.split('\n').find((line) => line.trim())?.replace(/^#+\s*/, '').slice(0, 80) ?? '';
  }
  if (!title && input.url) {
    try {
      const parsed = new URL(input.url);
      const segment = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() ?? '')
        .replace(/\.[A-Za-z0-9]{1,8}$/, '')
        .replace(/[-_]+/g, ' ')
        .trim();
      title = (segment || parsed.hostname).slice(0, 120);
    } catch {
      title = input.url.slice(0, 120);
    }
  }
  if (!title) title = '收藏';
  if (body.length > 8_000_000) throw new ApiError(ERROR_CODES.FETCH_TOO_LARGE, '正文超过 8MB 限制');

  const localized = input.downloadImages
    ? await localizeImages(deps, ownerId, body, input.url ?? null, coverUrl)
    : { body, attachments: [] as PendingAttachment[], coverAttachmentId: null, warnings: [] };
  warnings.push(...localized.warnings);

  const composed = `${sourceBlock(platform, input.url ?? null, author)}\n\n${localized.body}`.trim();
  const source: Partial<NoteSourceState> = {
    url: input.url ?? null,
    platform,
    author,
    coverAttachmentId: localized.coverAttachmentId,
    originalTitle: title,
    collectedAt: new Date().toISOString(),
    captureStatus,
  };

  const existing = input.url
    ? await deps.sql`
        select id from notes
        where owner_id = ${ownerId} and source_url = ${input.url} and deleted_at is null
        limit 1
      `
    : [];

  let noteId: string;
  let created = false;
  if (existing[0] && !input.forceNew) {
    noteId = String(existing[0].id);
    const updated = await patchNoteMeta(deps.notes, ownerId, noteId, { title, body: composed, source });
    await insertAttachments(deps.sql, ownerId, noteId, localized.attachments);
    // Repair older duplicates that still sit in the system inbox without a category.
    if (input.folderId === undefined && (!updated.category?.folderId
      || updated.category.folderId === settings.favoritesInboxFolderId)) {
      const category = await resolveDefaultCategory(deps, ownerId, { platform, title, body: composed });
      if (category) {
        await setFavoriteCategory(deps, ownerId, noteId, {
          action: 'set',
          folderId: category.folderId,
          name: category.name,
        });
      }
    }
  } else {
    const category = input.folderId === undefined
      ? await resolveDefaultCategory(deps, ownerId, { platform, title, body: composed })
      : null;
    const folderId = input.folderId === undefined
      ? category?.folderId ?? settings.favoritesInboxFolderId
      : input.folderId;
    const record = await createNote(deps.notes, ownerId, {
      title,
      folderId,
      body: composed,
      source,
      media: { status: localized.attachments.length > 0 ? 'queued' : 'idle' },
      ai: category ? initialCategoryAiState(category) : undefined,
    });
    noteId = record.id;
    created = true;
    await insertAttachments(deps.sql, ownerId, noteId, localized.attachments);
  }

  const imageIds = localized.attachments
    .filter((item) => item.mime.startsWith('image/'))
    .map((item) => item.id);
  const mediaJobQueued = await enqueueMediaJob(deps, ownerId, noteId, imageIds);
  if (!mediaJobQueued) await enqueueClassification(deps, ownerId, noteId);

  const note = await getNote(deps.notes, ownerId, noteId);
  if (!note) throw new ApiError(ERROR_CODES.INTERNAL, '收藏保存后无法读取');
  return {
    note: { ...toSummary(note), body: note.bodyText },
    created,
    mediaJobQueued,
    warnings,
  };
}

export async function importMediaFavorite(
  deps: FavoriteDeps,
  ownerId: string,
  input: {
    title: string;
    body: string;
    sourceUrl: string | null;
    platform?: SourcePlatform;
    folderId?: string | null;
    forceNew?: boolean;
    files: Array<{ filename: string; mime: string; data: Uint8Array }>;
  },
): Promise<FavoriteSaveResultDto> {
  const settings = await getSettings(deps.workspace, ownerId);
  const platform = input.platform ?? (input.sourceUrl ? detectPlatform(input.sourceUrl) : 'manual');
  const attachments: PendingAttachment[] = [];
  const markdown: string[] = [];
  let videoId: string | null = null;
  for (const file of input.files.slice(0, 13)) {
    const isImage = file.mime.startsWith('image/');
    const isVideo = file.mime.startsWith('video/');
    if (!isImage && !isVideo) continue;
    const id = newId();
    const ext = file.filename.match(/\.([A-Za-z0-9]{1,12})$/)?.[1] ?? extensionFor(file.mime);
    const storageKey = `${ownerId}/${id}.${ext}`;
    await deps.storage.save(storageKey, file.data);
    const item: PendingAttachment = {
      id,
      filename: file.filename.slice(0, 120),
      mime: file.mime,
      size: file.data.byteLength,
      storageKey,
    };
    attachments.push(item);
    if (isImage) markdown.push(`![${item.filename}](${attachmentUrl(deps.config.PUBLIC_URL, id)})`);
    else if (!videoId) {
      videoId = id;
      markdown.push(`[${item.filename}](${attachmentUrl(deps.config.PUBLIC_URL, id)})`);
    }
  }
  const composed = `${sourceBlock(platform, input.sourceUrl, null)}\n\n${input.body}\n\n${markdown.join('\n\n')}`.trim();
  const source: Partial<NoteSourceState> = {
    url: input.sourceUrl,
    platform,
    author: null,
    coverAttachmentId: attachments.find((item) => item.mime.startsWith('image/'))?.id ?? null,
    originalTitle: input.title,
    collectedAt: new Date().toISOString(),
    captureStatus: 'media',
  };
  const category = input.folderId === undefined
    ? await resolveDefaultCategory(deps, ownerId, { platform, title: input.title, body: composed })
    : null;
  const folderId = input.folderId === undefined
    ? category?.folderId ?? settings.favoritesInboxFolderId
    : input.folderId;
  const record = await createNote(deps.notes, ownerId, {
    title: input.title,
    folderId,
    body: composed,
    source,
    media: { status: attachments.length > 0 ? 'queued' : 'idle' },
    ai: category ? initialCategoryAiState(category) : undefined,
  });
  await insertAttachments(deps.sql, ownerId, record.id, attachments);
  const imageIds = attachments.filter((item) => item.mime.startsWith('image/')).map((item) => item.id);
  if (imageIds.length > 0 || videoId) {
    await deps.sql`
      insert into media_jobs (id, owner_id, note_id, status, image_ids, video_id)
      values (${newId()}, ${ownerId}, ${record.id}, 'queued', ${imageIds}::text[], ${videoId})
      on conflict do nothing
    `;
  } else {
    await enqueueClassification(deps, ownerId, record.id);
  }
  const note = await getNote(deps.notes, ownerId, record.id);
  if (!note) throw new ApiError(ERROR_CODES.INTERNAL, '收藏保存后无法读取');
  return {
    note: { ...toSummary(note), body: note.bodyText },
    created: true,
    mediaJobQueued: imageIds.length > 0 || Boolean(videoId),
    warnings: [],
  };
}

export async function setFavoriteCategory(
  deps: FavoriteDeps,
  ownerId: string,
  noteId: string,
  input: { action: 'set'; folderId: string; name: string } | { action: 'dismiss' },
): Promise<void> {
  const rows = await deps.sql`
    select id, folder_id, source_platform from notes
    where id = ${noteId} and owner_id = ${ownerId} and deleted_at is null
  `;
  if (!rows[0]) throw new ApiError(ERROR_CODES.NOT_FOUND, '收藏不存在');
  if (!rows[0].source_platform) throw new ApiError(ERROR_CODES.BAD_REQUEST, '该笔记不是收藏');

  const settings = await getSettings(deps.workspace, ownerId);
  if (input.action === 'set') {
    const root = settings.favoritesFolderId;
    if (!root) throw new ApiError(ERROR_CODES.NOT_FOUND, '收藏目录未初始化');
    const allowed = await deps.sql`
      with recursive subtree as (
        select id from folders where owner_id = ${ownerId} and id = ${root}
        union
        select f.id from folders f join subtree s on f.parent_id = s.id
        where f.owner_id = ${ownerId}
      )
      select 1 from subtree where id = ${input.folderId} limit 1
    `;
    if (allowed.length === 0) throw new ApiError(ERROR_CODES.BAD_REQUEST, '目标目录不在收藏区内');
  }

  const hocuspocus = deps.notes.getHocuspocus();
  const mutate = (doc: import('yjs').Doc) => {
    if (input.action === 'set') {
      writeNoteMeta(doc, { folderId: input.folderId });
      writeAiState(doc, {
        categoryFolderId: input.folderId,
        categoryName: input.name,
        categoryStatus: 'done',
        categorySuggestion: null,
        categoryAt: new Date().toISOString(),
        categoryError: null,
      });
    } else {
      writeAiState(doc, {
        categoryStatus: 'done',
        categorySuggestion: null,
        categoryAt: new Date().toISOString(),
        categoryError: null,
      });
    }
  };

  if (hocuspocus) {
    const { snapshot } = await mutateDocument(hocuspocus, noteDocName(noteId), mutate);
    const projected = docFromSnapshot(snapshot);
    await deps.sql.begin((tx) => mirrorNote(tx, noteId, ownerId, projected));
  } else {
    const doc = await loadStoredDoc(deps.sql, noteId);
    mutate(doc);
    await deps.sql`
      update note_documents set ydoc = ${Buffer.from(Y.encodeStateAsUpdate(doc))}::bytea, updated_at = now()
      where note_id = ${noteId}
    `;
    await deps.sql.begin((tx) => mirrorNote(tx, noteId, ownerId, doc));
  }
}
