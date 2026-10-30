import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import type { ImportResultDto, NoteDto } from '@aimarkdown/shared';
import { api, databaseAvailable, register, startTestServer, type AuthedClient, type TestServer } from './helpers.js';
import {
  exportNoteMarkdown,
  isUnsafeArchivePath,
  noteExportPath,
  readMarkdownFromZip,
  restoreAttachmentUrls,
  rewriteAttachmentUrls,
  safeSegment,
  splitImportPath,
  uniquePath,
} from '../../src/services/vault.js';

const dbUp = await databaseAvailable();
const describeDb = dbUp ? describe : describe.skip;

/* --------------------------- pure helpers (no DB) -------------------------- */

describe('vault helpers', () => {
  it('rewrites attachment urls to relative asset paths', () => {
    const body = 'see ![](/api/attachments/abc123) and ![](/api/attachments/def456)';
    const out = rewriteAttachmentUrls(body, [
      { id: 'abc123', filename: 'one.png' },
      { id: 'def456', filename: 'two.png' },
    ]);
    expect(out).toBe('see ![](assets/one.png) and ![](assets/two.png)');
  });

  it('restores attachment urls on import', () => {
    const body = '![](assets/one.png)';
    expect(restoreAttachmentUrls(body, [{ filename: 'one.png', url: '/api/attachments/abc' }])).toBe(
      '![](/api/attachments/abc)',
    );
  });

  it('does not duplicate a title heading into the exported body', () => {
    const md = exportNoteMarkdown({ title: '标题', body: '正文', attachments: [] });
    expect(md).toBe('正文\n');
    expect(md).not.toContain('# 标题');
  });

  it('appends exactly one trailing newline', () => {
    expect(exportNoteMarkdown({ title: 't', body: 'x\n', attachments: [] })).toBe('x\n');
    expect(exportNoteMarkdown({ title: 't', body: 'x', attachments: [] })).toBe('x\n');
    expect(exportNoteMarkdown({ title: 't', body: '', attachments: [] })).toBe('');
  });

  it('sanitises path segments', () => {
    expect(safeSegment('正常工作')).toBe('正常工作');
    expect(safeSegment('a/b\\c')).toBe('a_b_c');
    expect(safeSegment('   ')).toBe('_');
    expect(safeSegment('')).toBe('_');
    // Traversal components become an inert placeholder rather than disappearing.
    expect(safeSegment('..')).toBe('_');
    expect(safeSegment('.')).toBe('_');
    expect(safeSegment('...')).toBe('_');
  });

  it('never lets a sanitised segment contain a separator or resolve to a traversal', () => {
    const hostile = ['../../etc', '..', '/', '\\\\', 'a/../b', './x', '....//y', 'x\\0y', '  ..  '];
    for (const input of hostile) {
      const out = safeSegment(input);
      expect(out, `output for ${JSON.stringify(input)}`).not.toMatch(/[\\/]/);
      expect(out).not.toBe('..');
      expect(out).not.toBe('.');
      expect(out.length).toBeGreaterThan(0);
    }
  });

  it('rejects a traversal path before it ever reaches safeSegment', () => {
    expect(isUnsafeArchivePath('../../etc/passwd')).toBe(true);
    // And if it did get through, splitImportPath neutralises each component.
    expect(splitImportPath('../../etc/evil.md').folderPath).toEqual(['_', '_', 'etc']);
  });

  it('rejects unsafe archive paths', () => {
    expect(isUnsafeArchivePath('../evil.md')).toBe(true);
    expect(isUnsafeArchivePath('a/../../evil.md')).toBe(true);
    expect(isUnsafeArchivePath('/etc/passwd')).toBe(true);
    expect(isUnsafeArchivePath('C:\\evil.md')).toBe(true);
    expect(isUnsafeArchivePath('notes/safe.md')).toBe(false);
  });

  it('builds a nested export path from the folder chain', () => {
    const folders = [
      { id: 'a', name: '工作', parentId: null },
      { id: 'b', name: '2026', parentId: 'a' },
    ];
    expect(noteExportPath(folders, 'b', '周报')).toBe('工作/2026/周报.md');
    expect(noteExportPath(folders, null, '根目录笔记')).toBe('根目录笔记.md');
  });

  it('does not hang on a cyclic folder chain', () => {
    const folders = [
      { id: 'a', name: 'A', parentId: 'b' },
      { id: 'b', name: 'B', parentId: 'a' },
    ];
    expect(noteExportPath(folders, 'a', 'note')).toContain('note.md');
  });

  it('de-duplicates export paths', () => {
    const taken = new Set<string>();
    expect(uniquePath(taken, 'a.md')).toBe('a.md');
    expect(uniquePath(taken, 'a.md')).toBe('a (2).md');
    expect(uniquePath(taken, 'a.md')).toBe('a (3).md');
  });

  it('splits an import path into folders and title', () => {
    expect(splitImportPath('工作/2026/周报.md')).toEqual({ folderPath: ['工作', '2026'], title: '周报' });
    expect(splitImportPath('flat.md')).toEqual({ folderPath: [], title: 'flat' });
    expect(splitImportPath('.md')).toEqual({ folderPath: [], title: '无标题' });
  });

  it('reads markdown out of a zip and skips noise', () => {
    const { zipSync, strToU8 } = require('fflate') as typeof import('fflate');
    const zipped = zipSync({
      'a.md': strToU8('# A'),
      'dir/b.markdown': strToU8('# B'),
      'dir/c.txt': strToU8('plain'),
      'skip.pdf': strToU8('nope'),
      '__MACOSX/._a.md': strToU8('junk'),
      'dir/': new Uint8Array(0),
    });
    const files = readMarkdownFromZip(zipped);
    const paths = files.map((file) => file.path).sort();
    expect(paths).toEqual(['a.md', 'dir/b.markdown', 'dir/c.txt']);
    expect(files.find((f) => f.path === 'a.md')?.content).toBe('# A');
  });
});

/* ------------------------------- live round trip ---------------------------- */

describeDb('vault export and import', () => {
  let server: TestServer;
  let client: AuthedClient;

  beforeAll(async () => {
    server = await startTestServer();
    client = await register(server);
  });

  afterAll(async () => {
    await server?.stop();
  });

  it('exports a vault whose structure matches the folders and notes created', async () => {
    const root = await api<{ id: string }>(server, client, 'POST', '/api/folders', { name: '导出根' });
    const child = await api<{ id: string }>(server, client, 'POST', '/api/folders', {
      name: '子目录',
      parentId: root.body.id,
    });
    await api(server, client, 'POST', '/api/notes', {
      title: '深层笔记',
      folderId: child.body.id,
      body: '# 深层笔记\n\n内容 A\n',
    });
    await api(server, client, 'POST', '/api/notes', { title: '根笔记', body: '内容 B' });

    const response = await server.app.inject({
      method: 'GET',
      url: '/api/export/vault',
      headers: client.header,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/zip');
    expect(response.headers['content-disposition']).toContain('attachment');

    const entries = unzipSync(new Uint8Array(response.rawPayload));
    const paths = Object.keys(entries).sort();
    expect(paths).toContain('README.md');
    expect(paths).toContain('根笔记.md');
    expect(paths).toContain('导出根/子目录/深层笔记.md');
    expect(strFromU8(entries['导出根/子目录/深层笔记.md']!)).toContain('内容 A');
    expect(strFromU8(entries['根笔记.md']!)).toContain('内容 B');
  });

  it('round-trips: exporting then importing reproduces the notes and folders', async () => {
    const exporter = await register(server);
    const folder = await api<{ id: string }>(server, exporter, 'POST', '/api/folders', { name: '往返目录' });
    await api(server, exporter, 'POST', '/api/notes', {
      title: '往返笔记',
      folderId: folder.body.id,
      body: '# 往返笔记\n\n- [ ] 待办\n- 项目\n\n```ts\nconst x = 1;\n```\n',
    });

    const exported = await server.app.inject({
      method: 'GET',
      url: '/api/export/vault',
      headers: exporter.header,
    });
    const zipBytes = new Uint8Array(exported.rawPayload);

    const importer = await register(server);
    const boundary = '----aimarkdowntestboundary';
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="vault"; filename="vault.zip"\r\n` +
          `Content-Type: application/zip\r\n\r\n`,
        'utf8',
      ),
      Buffer.from(zipBytes),
      Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
    ]);

    const imported = await server.app.inject({
      method: 'POST',
      url: '/api/import',
      headers: { ...importer.header, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(imported.statusCode).toBe(201);
    const result = imported.json() as ImportResultDto;
    expect(result.errors).toEqual([]);
    // The exporter's vault also contains its inbox note and the README.
    expect(result.createdNotes).toBeGreaterThanOrEqual(2);
    expect(result.createdFolders).toBeGreaterThanOrEqual(1);

    const tree = await api<{ folders: { name: string; parentId: string | null }[] }>(
      server,
      importer,
      'GET',
      '/api/tree',
    );
    expect(tree.body.folders.map((f) => f.name)).toContain('往返目录');

    const found = await api<{ items: NoteDto[] }>(
      server,
      importer,
      'GET',
      `/api/notes?q=${encodeURIComponent('往返笔记')}`,
    );
    expect(found.body.items.length).toBeGreaterThanOrEqual(1);

    const detail = await api<NoteDto>(server, importer, 'GET', `/api/notes/${found.body.items[0]!.id}`);
    expect(detail.body.body).toContain('- [ ] 待办');
    expect(detail.body.body).toContain('const x = 1;');
  });

  it('imports plain markdown files without a zip', async () => {
    const importer = await register(server);
    const boundary = '----plainmdboundary';
    const content = '# 直接导入\n\n正文内容\n';
    const body = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="直接导入.md"\r\n` +
        `Content-Type: text/markdown\r\n\r\n${content}\r\n--${boundary}--\r\n`,
      'utf8',
    );

    const response = await server.app.inject({
      method: 'POST',
      url: '/api/import',
      headers: { ...importer.header, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ createdNotes: 1, createdFolders: 0 });
  });

  it('rejects an import with no markdown files', async () => {
    const importer = await register(server);
    const boundary = '----emptyboundary';
    const body = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.pdf"\r\n` +
        `Content-Type: application/pdf\r\n\r\nnotmarkdown\r\n--${boundary}--\r\n`,
      'utf8',
    );
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/import',
      headers: { ...importer.header, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('requires authentication to export', async () => {
    const response = await server.app.inject({ method: 'GET', url: '/api/export/vault' });
    expect(response.statusCode).toBe(401);
  });

  it('exports a single note as markdown with a UTF-8 safe filename', async () => {
    const created = await api<NoteDto>(server, client, 'POST', '/api/notes', {
      title: '单篇导出',
      body: '单篇内容',
    });
    const response = await server.app.inject({
      method: 'GET',
      url: `/api/notes/${created.body.id}/export`,
      headers: client.header,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/markdown');
    const disposition = String(response.headers['content-disposition']);
    expect(disposition).toContain("filename*=UTF-8''");
    expect(decodeURIComponent(disposition.split("filename*=UTF-8''")[1] ?? '')).toContain('单篇导出.md');
    expect(response.body).toContain('单篇内容');
  });
});
