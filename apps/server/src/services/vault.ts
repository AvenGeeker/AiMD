import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Sql } from 'postgres';
import {
  ApiError,
  ERROR_CODES,
  firstKey,
  keyAfter,
  type ImportResultDto,
} from '@aimarkdown/shared';
import { newId } from '../utils/ids.js';
import type { Logger } from '../utils/logger.js';
import { createNote, loadStoredDoc } from './notes.js';
import type { NotesDeps } from './notes.js';
import { readBody } from '../collab/docFactory.js';
import type { WorkspaceDeps } from './workspace.js';
import { createFolder } from './workspace.js';

/**
 * Markdown import and export.
 *
 * Export writes a faithful `.md` tree — folder hierarchy preserved, attachment URLs rewritten to
 * relative `assets/` paths — so a user can always leave with plain files that other editors
 * (including Obsidian) understand. Import accepts that same ZIP, or individual `.md` files, and
 * round-trips them back into notes.
 */

export interface FolderRow {
  id: string;
  name: string;
  parentId: string | null;
}

export interface NoteExportInput {
  title: string;
  body: string;
  attachments: { id: string; filename: string }[];
}

export interface VaultDeps {
  sql: Sql;
  log: Logger;
  notes: NotesDeps;
  workspace: WorkspaceDeps;
}

/** Rewrite `/api/attachments/<id>` references to relative asset paths for export. */
export function rewriteAttachmentUrls(
  body: string,
  attachments: { id: string; filename: string }[],
): string {
  let out = body;
  for (const attachment of attachments) {
    out = out.split(`/api/attachments/${attachment.id}`).join(`assets/${attachment.filename}`);
  }
  return out;
}

/** Rewrite relative `assets/…` paths back to server attachment URLs on import. */
export function restoreAttachmentUrls(body: string, assets: { filename: string; url: string }[]): string {
  let out = body;
  for (const asset of assets) {
    out = out.split(`assets/${asset.filename}`).join(asset.url);
  }
  return out;
}

/**
 * Serialise one note to its exported markdown.
 *
 * The title is deliberately *not* written into the body as an `# Title` heading: it is carried by
 * the filename, and duplicating it would make the body grow a heading on every round-trip.
 */
export function exportNoteMarkdown(input: NoteExportInput): string {
  const body = rewriteAttachmentUrls(input.body, input.attachments);
  if (body.length === 0) return '';
  return body.endsWith('\n') ? body : `${body}\n`;
}

/**
 * Sanitise a single path segment coming out of an untrusted archive or upload.
 *
 * Guarantee: the result contains no path separator and is never `.` or `..`, so it cannot
 * contribute a traversal step to an exported entry name or an imported folder name. Embedded
 * dots are deliberately *neutralised* rather than deleted — silently rewriting `..` to nothing
 * would turn `a..b` and `a/b` into the same name and make exports collide.
 */
export function safeSegment(segment: string): string {
  const trimmed = (segment ?? '').trim();
  // `.`, `..`, `...` and the empty string are traversal components, not names.
  if (trimmed.length === 0 || /^\.+$/.test(trimmed)) return '_';
  const cleaned = trimmed
    .replace(/[\\/:*?"<>|\0]/g, '_')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .trim();
  return (cleaned.length > 0 ? cleaned : '_').slice(0, 120);
}

/** Reject absolute paths and `..` traversal in archive entries (zip-slip). */
export function isUnsafeArchivePath(entryPath: string): boolean {
  if (entryPath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(entryPath)) return true;
  return entryPath.split(/[\\/]/).some((part) => part === '..');
}

/** Build the relative path of a note inside the exported tree from its folder chain. */
export function noteExportPath(folders: FolderRow[], folderId: string | null, title: string): string {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const segments: string[] = [];
  const guard = new Set<string>();
  let cursor = folderId;
  while (cursor) {
    // A cycle in the mirror must not hang the export.
    if (guard.has(cursor)) break;
    guard.add(cursor);
    const folder = byId.get(cursor);
    if (!folder) break;
    segments.unshift(safeSegment(folder.name));
    cursor = folder.parentId;
  }
  segments.push(`${safeSegment(title)}.md`);
  return segments.join('/');
}

/** De-duplicate a path within the export, the way a filesystem would (`note (2).md`). */
export function uniquePath(taken: Set<string>, path: string): string {
  if (!taken.has(path)) {
    taken.add(path);
    return path;
  }
  const dot = path.lastIndexOf('.');
  const base = dot > 0 ? path.slice(0, dot) : path;
  const ext = dot > 0 ? path.slice(dot) : '';
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
  throw new ApiError(ERROR_CODES.CONFLICT, '导出路径冲突过多');
}

export interface ParsedImportFile {
  /** Relative path inside the upload, e.g. `工作/2026/笔记.md`. */
  path: string;
  content: string;
}

/** Split an uploaded path into its folder segments and note title. */
export function splitImportPath(path: string): { folderPath: string[]; title: string } {
  const parts = path.split(/[\\/]/).filter((part) => part.length > 0);
  const last = parts.pop() ?? 'note.md';
  const title = last.replace(/\.md$/i, '').trim() || '无标题';
  return { folderPath: parts.map(safeSegment), title };
}

/** Extract `.md` files from a ZIP buffer, skipping unsafe entries and non-markdown files. */
export function readMarkdownFromZip(buffer: Uint8Array): ParsedImportFile[] {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(buffer);
  } catch (error) {
    throw new ApiError(ERROR_CODES.BAD_REQUEST, `无法解析 ZIP 文件：${(error as Error).message}`);
  }

  const files: ParsedImportFile[] = [];
  for (const [rawPath, bytes] of Object.entries(entries)) {
    if (rawPath.endsWith('/')) continue; // directory entry
    if (isUnsafeArchivePath(rawPath)) continue;
    if (!/\.(md|markdown|txt)$/i.test(rawPath)) continue;
    // Ignore macOS resource-fork noise that `zip` happily includes.
    const base = rawPath.split('/').pop() ?? '';
    if (base.startsWith('._') || rawPath.includes('__MACOSX')) continue;
    files.push({ path: rawPath, content: strFromU8(bytes) });
  }
  return files;
}

/**
 * Hard cap on an in-memory export.
 *
 * `fflate.zipSync` buffers the archive, which keeps the export path free of stream
 * backpressure bugs at the cost of memory. 512 MiB of *markdown* is far beyond a personal
 * vault; if a deployment ever hits it, the right fix is switching to a streaming zip writer,
 * not raising the number.
 */
export const MAX_EXPORT_BYTES = 512 * 1024 * 1024;

export interface VaultFile {
  path: string;
  content: string;
}

/** Compress a set of files into a ZIP archive (pure JS, identical in Node and the browser). */
export function buildZip(files: VaultFile[]): Uint8Array {
  const data: Record<string, Uint8Array> = {};
  for (const file of files) data[file.path] = strToU8(file.content);
  return zipSync(data, { level: 6 });
}

/** Collect every note in the vault as an exportable file list. */
export async function collectVaultFiles(deps: VaultDeps, ownerId: string): Promise<VaultFile[]> {
  const [folderRows, noteRows, attachmentRows] = await Promise.all([
    deps.sql`select id, name, parent_id from folders where owner_id = ${ownerId} order by position`,
    deps.sql`
      select n.id, n.folder_id, n.title from notes n
      where n.owner_id = ${ownerId} and n.deleted_at is null
      order by n.position
    `,
    deps.sql`select id, filename from attachments where owner_id = ${ownerId}`,
  ]);

  const folders: FolderRow[] = folderRows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    parentId: row.parent_id == null ? null : String(row.parent_id),
  }));
  const attachments = attachmentRows.map((row) => ({ id: String(row.id), filename: String(row.filename) }));

  const files: VaultFile[] = [];
  const taken = new Set<string>();
  let totalBytes = 0;

  for (const note of noteRows) {
    const noteId = String(note.id);
    // The CRDT document is authoritative; fall back to the mirror if it is somehow missing.
    const doc = await loadStoredDoc(deps.sql, noteId);
    const body = doc.getText('body').length > 0 ? readBody(doc) : String(note.body_text ?? '');
    const folderId = note.folder_id == null ? null : String(note.folder_id);
    const path = uniquePath(taken, noteExportPath(folders, folderId, String(note.title)));
    const content = exportNoteMarkdown({ title: String(note.title), body, attachments });
    totalBytes += content.length;
    if (totalBytes > MAX_EXPORT_BYTES) {
      throw new ApiError(ERROR_CODES.PAYLOAD_TOO_LARGE, '笔记库过大，无法一次性导出');
    }
    files.push({ path, content });
  }

  files.push({
    path: 'README.md',
    content: [
      '# aiMarkdown 导出说明',
      '',
      `- 导出时间：${new Date().toISOString()}`,
      `- 笔记数量：${noteRows.length}`,
      '- 目录结构已按文件夹层级保留，附件引用被改写为 `assets/` 相对路径。',
      '- 本 ZIP 可直接通过「导入」重新导入，也可用任意 Markdown 编辑器打开。',
      '',
    ].join('\n'),
  });

  return files;
}

/** Build the whole vault as a ZIP archive ready to send. */
export async function buildVaultZip(deps: VaultDeps, ownerId: string): Promise<Uint8Array> {
  return buildZip(await collectVaultFiles(deps, ownerId));
}

/**
 * Import markdown files, recreating the folder hierarchy.
 *
 * Folders are created first (one per unique path segment chain), then notes. Failures on
 * individual files are collected rather than aborting the whole import, so a single malformed
 * entry cannot lose the rest of a vault.
 */
export async function importMarkdownFiles(
  deps: VaultDeps,
  ownerId: string,
  files: ParsedImportFile[],
): Promise<ImportResultDto> {
  const result: ImportResultDto = { createdNotes: 0, createdFolders: 0, skipped: 0, errors: [] };
  const folderIds = new Map<string, string>();
  let position = firstKey();

  for (const file of files) {
    if (isUnsafeArchivePath(file.path)) {
      result.skipped++;
      result.errors.push({ path: file.path, message: '不安全的归档路径' });
      continue;
    }
    const { folderPath, title } = splitImportPath(file.path);

    try {
      let parentId: string | null = null;
      const chain: string[] = [];
      for (const segment of folderPath) {
        chain.push(segment);
        const key = chain.join('/');
        let folderId = folderIds.get(key);
        if (!folderId) {
          const created = await createFolder(deps.workspace, ownerId, { name: segment, parentId });
          folderId = created.id;
          folderIds.set(key, folderId);
          result.createdFolders++;
        }
        parentId = folderId;
      }

      position = keyAfter(position);
      await createNote(deps.notes, ownerId, {
        title,
        folderId: parentId,
        body: file.content,
        position,
      });
      result.createdNotes++;
    } catch (error) {
      result.skipped++;
      result.errors.push({
        path: file.path,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}
