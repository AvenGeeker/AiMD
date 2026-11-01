import type { FastifyInstance } from 'fastify';
import { ApiError, ERROR_CODES, importResultDto } from '@aimarkdown/shared';
import { requireAuth, currentUser } from '../plugins/auth.js';
import {
  buildVaultZip,
  importMarkdownFiles,
  isUnsafeArchivePath,
  readMarkdownFromZip,
  type ParsedImportFile,
  type VaultDeps,
} from '../services/vault.js';

/** Whole-vault export and import. */

const MAX_IMPORT_BYTES = 200 * 1024 * 1024;

export function registerVaultRoutes(app: FastifyInstance, deps: VaultDeps): void {
  const opts = { preHandler: [requireAuth] };

  app.get('/api/export/vault', opts, async (request, reply) => {
    const ownerId = currentUser(request).id;
    const archive = await buildVaultZip(deps, ownerId);
    const stamp = new Date().toISOString().slice(0, 10);
    return reply
      .header('content-type', 'application/zip')
      .header('content-length', String(archive.byteLength))
      .header('content-disposition', `attachment; filename="aimd-${stamp}.zip"`)
      .send(Buffer.from(archive));
  });

  /**
   * Import markdown. Accepts either a single ZIP (which may contain a folder tree) or one or
   * more `.md` files. Per-file failures are reported in the response instead of aborting.
   */
  app.post('/api/import', opts, async (request, reply) => {
    const ownerId = currentUser(request).id;
    const parts = request.parts();
    const files: ParsedImportFile[] = [];
    let totalBytes = 0;

    for await (const part of parts) {
      if (part.type !== 'file') continue;
      const filename = part.filename ?? '';
      const buffer = await part.toBuffer();
      totalBytes += buffer.byteLength;
      if (totalBytes > MAX_IMPORT_BYTES) {
        throw new ApiError(ERROR_CODES.PAYLOAD_TOO_LARGE, '导入内容超过 200MB 限制');
      }

      if (/\.zip$/i.test(filename)) {
        files.push(...readMarkdownFromZip(new Uint8Array(buffer)));
        continue;
      }
      if (!/\.(md|markdown|txt)$/i.test(filename)) {
        continue; // silently ignore non-markdown uploads
      }
      const safeName = filename.replace(/\\/g, '/');
      if (isUnsafeArchivePath(safeName)) {
        throw new ApiError(ERROR_CODES.BAD_REQUEST, `不安全的文件名：${filename}`);
      }
      files.push({ path: safeName, content: buffer.toString('utf8') });
    }

    if (files.length === 0) {
      throw new ApiError(ERROR_CODES.BAD_REQUEST, '没有可导入的 Markdown 文件');
    }

    const result = await importMarkdownFiles(deps, ownerId, files);
    return reply.code(201).send(importResultDto.parse(result));
  });
}
