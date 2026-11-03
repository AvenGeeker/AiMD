import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Apple Notes JXA bridge.
 *
 * The script is a constant. User content only travels through a 0600 JSON file, never through
 * argv or shell interpolation. Results (including attachment file paths) are written to a second
 * file so large bodies cannot overflow osascript's stdout buffer.
 */

const JXA_SCRIPT = String.raw`
function run(argv) {
  ObjC.import('Foundation');
  const inputPath = argv[0];
  const outputPath = argv[1];
  const readText = (path) => {
    const ns = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null);
    return ns && !ns.isNil() ? ObjC.unwrap(ns) : null;
  };
  const writeText = (path, text) => {
    const ns = $.NSString.alloc.initWithUTF8String(text);
    const ok = ns.writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null);
    if (!ok) throw new Error('无法写入结果文件');
  };
  let payload = {};
  let result = { ok: false, error: 'unknown failure' };
  try {
    payload = JSON.parse(readText(inputPath));
    const notes = Application('Notes');
    const wasRunning = notes.running();
    const writeResult = (value) => writeText(outputPath, JSON.stringify(value));
    const account = () => notes.defaultAccount();
    let folderIndex = null;
    let noteIndex = null;
    const invalidateNoteIndex = () => { noteIndex = null; };
    const invalidateIndexes = () => { folderIndex = null; noteIndex = null; };
    const folderChildren = (folder) => {
      try { return folder.folders; } catch (_) { return null; }
    };
    const indexFolders = (folder, out) => {
      const children = folderChildren(folder);
      if (!children) return;
      let count = 0;
      try { count = children.length; } catch (_) { count = 0; }
      for (let index = 0; index < count; index++) {
        let child;
        try { child = children[index]; } catch (_) { continue; }
        const id = (() => { try { return child.id(); } catch (_) { return ''; } })();
        if (!id || out.has(id)) continue;
        out.set(id, child);
        indexFolders(child, out);
      }
    };
    const buildFolderIndex = () => {
      const out = new Map();
      let topFolders = null;
      try { topFolders = account().folders; } catch (_) { topFolders = null; }
      let count = 0;
      try { count = topFolders ? topFolders.length : 0; } catch (_) { count = 0; }
      for (let index = 0; index < count; index++) {
        let folder;
        try { folder = topFolders[index]; } catch (_) { continue; }
        const id = (() => { try { return folder.id(); } catch (_) { return ''; } })();
        if (!id || out.has(id)) continue;
        out.set(id, folder);
        indexFolders(folder, out);
      }
      folderIndex = out;
      return out;
    };
    // Notes.folders.byId() only resolves top-level folders; nested folders are not reachable
    // from the application-level collection, so keep a per-call recursive index.
    const folderById = (id) => {
      if (!id) return null;
      const index = folderIndex ?? buildFolderIndex();
      return index.get(id) ?? null;
    };
    const indexNotes = (folder, out) => {
      const specs = (() => { try { return folder.notes; } catch (_) { return null; } })();
      if (specs) {
        let ids = [];
        try { const value = specs.id(); if (Array.isArray(value)) ids = value; } catch (_) { ids = []; }
        const folderId = (() => { try { return folder.id(); } catch (_) { return null; } })();
        for (let index = 0; index < ids.length; index++) {
          const id = String(ids[index] || '');
          if (id && !out.has(id)) out.set(id, { note: specs[index], folderId });
        }
      }
      const children = folderChildren(folder);
      if (!children) return;
      let count = 0;
      try { count = children.length; } catch (_) { count = 0; }
      for (let index = 0; index < count; index++) {
        let child;
        try { child = children[index]; } catch (_) { continue; }
        indexNotes(child, out);
      }
    };
    const buildNoteIndex = () => {
      const out = new Map();
      let topFolders = null;
      try { topFolders = account().folders; } catch (_) { topFolders = null; }
      let count = 0;
      try { count = topFolders ? topFolders.length : 0; } catch (_) { count = 0; }
      for (let index = 0; index < count; index++) {
        let folder;
        try { folder = topFolders[index]; } catch (_) { continue; }
        indexNotes(folder, out);
      }
      noteIndex = out;
      return out;
    };
    const noteEntryById = (id) => {
      // Fast path for top-level notes. A nested note makes byId() throw, and its container()
      // is not scriptable either, so fall back to the recursive index built above.
      try {
        const top = notes.notes.byId(id);
        if (top && top.id() === id) {
          const container = (() => { try { return top.container(); } catch (_) { return null; } })();
          const folderId = (() => { try { return container ? container.id() : null; } catch (_) { return null; } })();
          return { note: top, folderId };
        }
      } catch (_) { /* nested note */ }
      const index = noteIndex ?? buildNoteIndex();
      return index.get(id) ?? null;
    };
    const noteById = (id) => {
      const entry = noteEntryById(id);
      return entry ? entry.note : null;
    };
    const createFolderIn = (parentId, name) => {
      // folder.make() ignores its receiver on current macOS and always creates at the account
      // root. Create there, then move it into the requested parent when one is given.
      const created = account().make({ new: 'folder', withProperties: { name } });
      const createdId = created.id();
      invalidateIndexes();
      if (parentId) {
        const parent = folderById(parentId);
        if (!parent) {
          try { notes.delete(created); } catch (_) { /* best effort */ }
          throw new Error('找不到父目录：' + parentId);
        }
        try {
          notes.move(created, { to: parent });
        } catch (error) {
          try { notes.delete(created); } catch (_) { /* best effort */ }
          throw error;
        }
        invalidateIndexes();
      }
      return createdId;
    };
    const createNoteIn = (folderId, properties) => {
      const folder = folderById(folderId);
      if (!folder) throw new Error('找不到目标目录：' + folderId);
      // folder.make() puts a new note in the account's default folder, not the receiver.
      // Create it at the application level and move it to the target folder explicitly.
      const created = notes.make({ new: 'note', withProperties: properties });
      const createdId = created.id();
      invalidateNoteIndex();
      const defaultId = (() => {
        try {
          const defaultFolder = account().defaultFolder();
          return defaultFolder ? defaultFolder.id() : null;
        } catch (_) { return null; }
      })();
      if (!defaultId || folderId !== defaultId) {
        const target = folderById(folderId);
        if (!target) {
          try { notes.delete(noteById(createdId)); } catch (_) { /* best effort */ }
          throw new Error('找不到目标目录：' + folderId);
        }
        try {
          notes.move(noteById(createdId), { to: target });
        } catch (error) {
          try { notes.delete(noteById(createdId)); } catch (_) { /* best effort */ }
          throw error;
        }
        invalidateNoteIndex();
      }
      return createdId;
    };
    const iso = (value) => {
      try { return value ? new Date(value).toISOString() : null; } catch (_) { return null; }
    };
    const safeName = (value) => String(value || 'attachment').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120);
    const ensureDir = (path) => {
      $.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(
        path, true, $(), null,
      );
    };
    const saveAttachment = (attachment, target) => {
      try {
        notes.save(attachment, { in: Path(target) });
        return true;
      } catch (_) {
        try {
          const contents = attachment.contents();
          if (contents) {
            const source = String(contents);
            return $.NSFileManager.defaultManager.copyItemAtPathToPathError(source, target, null);
          }
        } catch (_) {
          /* fall through */
        }
      }
      return false;
    };
    const attachmentMeta = (note, attachmentDir) => {
      const out = [];
      let attachments = [];
      try { attachments = note.attachments(); } catch (_) { attachments = []; }
      for (let index = 0; index < attachments.length; index++) {
        const attachment = attachments[index];
        const id = (() => { try { return attachment.id(); } catch (_) { return ''; } })();
        const name = (() => { try { return attachment.name(); } catch (_) { return 'attachment'; } })();
        const cid = (() => { try { return attachment.contentIdentifier(); } catch (_) { return null; } })();
        const url = (() => { try { return attachment.url(); } catch (_) { return null; } })();
        const modified = (() => { try { return iso(attachment.modificationDate()); } catch (_) { return null; } })();
        const entry = { id, name, contentIdentifier: cid, url, modifiedAt: modified, path: null };
        if (attachmentDir) {
          const target = attachmentDir + '/' + safeName(id || ('att-' + index)) + '-' + safeName(name);
          if (saveAttachment(attachment, target)) {
            entry.path = target;
            try {
              const data = $.NSData.dataWithContentsOfFile(target);
              if (data) entry.base64 = ObjC.unwrap(data.base64EncodedStringWithOptions(0));
            } catch (_) { /* path fallback */ }
          }
        }
        out.push(entry);
      }
      return out;
    };
    const makeAttachments = (note, op) => {
      const ids = [];
      for (const attachment of (op.attachments || [])) {
        try {
          const filename = safeName(attachment.filename || 'attachment');
          const target = (payload.attachmentDir || '/tmp') + '/upload-' + Date.now() + '-' + filename;
          const data = $.NSData.alloc().initWithBase64EncodedStringOptions(attachment.base64 || '', 0);
          data.writeToFileAtomically(target, true);
          const att = note.make({ new: 'attachment', withData: Path(target) });
          ids.push((() => { try { return att.id(); } catch (_) { return null; } })());
        } catch (error) {
          ids.push({ error: String(error) });
        }
      }
      return ids;
    };
    const bulkGet = (spec, property) => {
      try {
        const value = spec[property]();
        return Array.isArray(value) ? value : [];
      } catch (_) {
        return [];
      }
    };
    const walk = (folder, parentId, folders, notesOut, attachmentDir, includeBodies) => {
      const id = folder.id();
      const name = folder.name();
      const shared = (() => { try { return folder.shared(); } catch (_) { return false; } })();
      folders.push({ id, name, parentId, shared });
      // folder.folders is a live specifier, not a JS array: iterating it with for...of throws
      // on macOS. Indexed access is the only reliable way to walk nested folders. Do not swallow
      // failures here: an incomplete folder scan must abort the sync before any destructive pass.
      const children = folder.folders;
      const childCount = children.length;
      for (let index = 0; index < childCount; index++) {
        walk(children[index], id, folders, notesOut, attachmentDir, includeBodies);
      }

      // Bulk property retrieval: one Apple Event per property for the whole folder instead of
      // five events per note. This is the difference between a few seconds and minutes on a
      // library with hundreds of notes.
      const noteSpecs = (() => { try { return folder.notes; } catch (_) { return null; } })();
      if (!noteSpecs) return;
      const bulk = (fn) => {
        try {
          const value = fn();
          return Array.isArray(value) ? value : [];
        } catch (_) {
          return [];
        }
      };
      const ids = bulk(() => noteSpecs.id());
      const names = bulk(() => noteSpecs.name());
      const created = bulk(() => noteSpecs.creationDate());
      const modified = bulk(() => noteSpecs.modificationDate());
      const protecteds = bulk(() => noteSpecs.passwordProtected());
      const shareds = bulk(() => noteSpecs.shared());
      for (let index = 0; index < ids.length; index++) {
        const noteId = String(ids[index] || '');
        if (!noteId) continue;
        const entry = {
          id: noteId,
          name: String(names[index] ?? ''),
          folderId: id,
          createdAt: iso(created[index]),
          modifiedAt: iso(modified[index]),
          passwordProtected: Boolean(protecteds[index]),
          shared: Boolean(shareds[index]),
          attachments: [],
        };
        if (includeBodies || attachmentDir) {
          try {
            const note = noteSpecs[index];
            if (attachmentDir) entry.attachments = attachmentMeta(note, attachmentDir);
            if (includeBodies) {
              try { entry.body = note.body(); } catch (error) { entry.bodyError = String(error); }
              try { entry.plaintext = note.plaintext(); } catch (_) { /* optional */ }
            }
          } catch (error) {
            entry.error = String(error);
          }
        }
        notesOut.push(entry);
      }
    };

    if (payload.op === 'probe') {
      const acct = account();
      const defaultFolder = (() => { try { return acct.defaultFolder(); } catch (_) { return null; } })();
      result = {
        ok: true,
        running: wasRunning,
        accountId: acct.id(),
        accountName: acct.name(),
        defaultFolderId: defaultFolder ? defaultFolder.id() : null,
        defaultFolderName: defaultFolder ? defaultFolder.name() : null,
        version: (() => { try { return Application('Notes').version(); } catch (_) { return null; } })(),
      };
    } else if (payload.op === 'listTree') {
      const acct = account();
      const folders = [];
      const notesOut = [];
      let topFolders = [];
      try { topFolders = acct.folders(); } catch (_) { topFolders = []; }
      for (const folder of topFolders) {
        walk(folder, null, folders, notesOut, payload.withAttachments ? payload.attachmentDir : null, !!payload.includeBodies);
      }
      result = {
        ok: true,
        running: wasRunning,
        accountId: acct.id(),
        accountName: acct.name(),
        folders,
        notes: notesOut,
      };
    } else if (payload.op === 'readFolderBodies') {
      const entries = [];
      for (const folderId of (payload.folderIds || [])) {
        try {
          const folder = folderById(folderId);
          const specs = folder.notes;
          const ids = bulkGet(specs, 'id');
          const names = bulkGet(specs, 'name');
          const created = bulkGet(specs, 'creationDate');
          const modified = bulkGet(specs, 'modificationDate');
          const protecteds = bulkGet(specs, 'passwordProtected');
          const shareds = bulkGet(specs, 'shared');
          const bodies = bulkGet(specs, 'body');
          for (let index = 0; index < ids.length; index++) {
            entries.push({
              id: String(ids[index] || ''),
              name: String(names[index] ?? ''),
              folderId,
              createdAt: iso(created[index]),
              modifiedAt: iso(modified[index]),
              passwordProtected: Boolean(protecteds[index]),
              shared: Boolean(shareds[index]),
              body: String(bodies[index] ?? ''),
              bodyError: null,
              attachments: [],
            });
          }
        } catch (error) {
          entries.push({ folderId, error: String(error) });
        }
      }
      result = { ok: true, notes: entries };
    } else if (payload.op === 'readNotes') {
      const entries = [];
      for (const id of (payload.ids || [])) {
        try {
          const entry = noteEntryById(id);
          if (!entry) throw new Error('找不到备忘录：' + id);
          const note = entry.note;
          let body = '';
          let bodyError = null;
          try { body = note.body(); } catch (error) { bodyError = String(error); }
          entries.push({
            id,
            name: note.name(),
            folderId: entry.folderId,
            createdAt: iso(note.creationDate()),
            modifiedAt: iso(note.modificationDate()),
            passwordProtected: (() => { try { return note.passwordProtected(); } catch (_) { return false; } })(),
            shared: (() => { try { return note.shared(); } catch (_) { return false; } })(),
            body,
            bodyError,
            attachments: attachmentMeta(note, payload.withAttachments ? payload.attachmentDir : null),
          });
        } catch (error) {
          entries.push({ id, error: String(error) });
        }
      }
      result = { ok: true, notes: entries };
    } else if (payload.op === 'apply') {
      ensureDir(payload.attachmentDir || '/tmp');
      const outcomes = [];
      for (const op of (payload.ops || [])) {
        try {
          if (op.type === 'createFolder') {
            const createdId = createFolderIn(op.parentId || null, op.name);
            outcomes.push({ key: op.key, ok: true, id: createdId });
          } else if (op.type === 'updateFolder') {
            const folder = folderById(op.id);
            if (!folder) throw new Error('找不到目录：' + op.id);
            if (op.name) folder.name = op.name;
            if (op.parentId !== undefined) {
              const parent = op.parentId ? folderById(op.parentId) : account();
              if (!parent) throw new Error('找不到父目录：' + op.parentId);
              notes.move(folder, { to: parent });
              invalidateIndexes();
            }
            outcomes.push({ key: op.key, ok: true, id: op.id });
          } else if (op.type === 'deleteFolder') {
            const folder = folderById(op.id);
            if (!folder) throw new Error('找不到目录：' + op.id);
            notes.delete(folder);
            invalidateIndexes();
            outcomes.push({ key: op.key, ok: true, id: op.id });
          } else if (op.type === 'moveNote') {
            const note = noteById(op.id);
            const folder = folderById(op.folderId);
            if (!note) throw new Error('找不到备忘录：' + op.id);
            if (!folder) throw new Error('找不到目标目录：' + op.folderId);
            notes.move(note, { to: folder });
            invalidateNoteIndex();
            outcomes.push({ key: op.key, ok: true, id: op.id });
          } else if (op.type === 'createNote') {
            const createdId = createNoteIn(op.folderId, {
              name: op.title || '无标题',
              body: op.html || '',
            });
            const created = noteById(createdId);
            const attachmentIds = makeAttachments(created, op);
            outcomes.push({ key: op.key, ok: true, id: createdId, attachmentIds });
          } else if (op.type === 'updateNote') {
            const note = noteById(op.id);
            if (!note) throw new Error('找不到备忘录：' + op.id);
            if (op.html !== undefined) note.body = op.html;
            if (op.title) note.name = op.title;
            if (op.folderId) {
              const folder = folderById(op.folderId);
              if (!folder) throw new Error('找不到目标目录：' + op.folderId);
              notes.move(note, { to: folder });
              invalidateNoteIndex();
            }
            const updated = noteById(op.id);
            const attachmentIds = makeAttachments(updated, op);
            outcomes.push({ key: op.key, ok: true, id: op.id, attachmentIds });
          } else if (op.type === 'deleteNote') {
            const note = noteById(op.id);
            if (!note) throw new Error('找不到备忘录：' + op.id);
            notes.delete(note);
            invalidateNoteIndex();
            outcomes.push({ key: op.key, ok: true, id: op.id });
          } else if (op.type === 'quit') {
            notes.quit();
            outcomes.push({ key: op.key, ok: true });
          } else {
            outcomes.push({ key: op.key, ok: false, error: 'unknown op: ' + op.type });
          }
        } catch (error) {
          outcomes.push({ key: op.key, ok: false, error: String(error) });
        }
      }
      result = { ok: true, outcomes };
    } else {
      result = { ok: false, error: 'unknown operation: ' + payload.op };
    }
    writeResult(result);
  } catch (error) {
    try {
      writeText(outputPath, JSON.stringify({ ok: false, error: String(error) }));
    } catch (_) { /* nothing else we can do */ }
  }
}
`;

export class AppleNotesPermissionError extends Error {
  constructor(message = '未获得控制 macOS 备忘录的权限') {
    super(message);
    this.name = 'AppleNotesPermissionError';
  }
}

export class AppleNotesUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppleNotesUnavailableError';
  }
}

export interface JxaRunOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

async function runJxa<T>(payload: Record<string, unknown>, options: JxaRunOptions = {}): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'aimarkdown-notes-'));
  const input = join(dir, 'input.json');
  const output = join(dir, 'output.json');
  const attachmentDir = join(dir, 'attachments');
  const fullPayload = { ...payload, attachmentDir };
  try {
    await writeFile(input, JSON.stringify(fullPayload), { encoding: 'utf8', mode: 0o600 });
    await new Promise<void>((resolve, reject) => {
      const child = execFile(
        '/usr/bin/osascript',
        ['-l', 'JavaScript', '-e', JXA_SCRIPT, input, output],
        {
          timeout: options.timeoutMs ?? 120_000,
          maxBuffer: 8 * 1024 * 1024,
          signal: options.signal,
          encoding: 'utf8',
        },
        (error, _stdout, stderr) => {
          if (!error) {
            resolve();
            return;
          }
          const message = `${stderr || ''}\n${error.message || ''}`.trim();
          if (/-1743|not authorized|Not authorized|自动化|user canceled|user cancelled|取消/i.test(message)) {
            reject(new AppleNotesPermissionError());
            return;
          }
          if (/-1728|Can.t get|找不到/i.test(message)) {
            reject(new AppleNotesUnavailableError(message || '备忘录对象不存在'));
            return;
          }
          reject(new AppleNotesUnavailableError(message || String(error)));
        },
      );
      child.on('error', (error) => reject(error));
    });
    let text: string;
    try {
      text = await readFile(output, 'utf8');
    } catch {
      throw new AppleNotesUnavailableError(
        'osascript 没有生成结果文件；通常是 macOS 自动化权限未授权，或系统弹窗被取消',
      );
    }
    const parsed = JSON.parse(text) as T & { ok?: boolean; error?: string };
    if (parsed && parsed.ok === false) {
      const message = parsed.error ?? '备忘录操作失败';
      if (/not authorized|Not authorized|-1743|自动化|user canceled|user cancelled|取消/i.test(message)) {
        throw new AppleNotesPermissionError();
      }
      throw new AppleNotesUnavailableError(message);
    }
    return parsed;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export interface AppleAttachmentMeta {
  id: string;
  name: string;
  contentIdentifier: string | null;
  url: string | null;
  modifiedAt: string | null;
  path: string | null;
  base64?: string;
}

export interface AppleFolderMeta {
  id: string;
  name: string;
  parentId: string | null;
  shared: boolean;
}

export interface AppleNoteMeta {
  id: string;
  name: string;
  folderId: string | null;
  createdAt: string | null;
  modifiedAt: string | null;
  passwordProtected: boolean;
  shared: boolean;
  attachments: AppleAttachmentMeta[];
  body?: string;
  bodyError?: string | null;
  plaintext?: string;
  error?: string;
}

export interface AppleTree {
  ok: true;
  running: boolean;
  accountId: string;
  accountName: string;
  folders: AppleFolderMeta[];
  notes: AppleNoteMeta[];
}

export async function probeAppleNotes(options?: JxaRunOptions): Promise<{
  ok: true;
  running: boolean;
  accountId: string;
  accountName: string;
  defaultFolderId: string | null;
  defaultFolderName: string | null;
  version: string | null;
}> {
  return runJxa({ op: 'probe' }, options);
}

export async function listAppleTree(
  includeBodies: boolean,
  options?: JxaRunOptions,
): Promise<AppleTree> {
  return runJxa({ op: 'listTree', includeBodies, withAttachments: false }, options);
}

export async function readAppleFolderBodies(
  folderIds: string[],
  options?: JxaRunOptions,
): Promise<{ ok: true; notes: AppleNoteMeta[] }> {
  return runJxa({ op: 'readFolderBodies', folderIds }, { timeoutMs: 180_000, ...options });
}

export async function readAppleNotes(
  ids: string[],
  options?: JxaRunOptions,
): Promise<{ ok: true; notes: AppleNoteMeta[] }> {
  return runJxa({ op: 'readNotes', ids, withAttachments: true }, { timeoutMs: 180_000, ...options });
}

export interface AppleApplyOp {
  key: string;
  type:
    | 'createFolder'
    | 'updateFolder'
    | 'deleteFolder'
    | 'moveNote'
    | 'createNote'
    | 'updateNote'
    | 'deleteNote'
    | 'quit';
  [key: string]: unknown;
}

export interface AppleApplyOutcome {
  key: string;
  ok: boolean;
  id?: string;
  attachmentIds?: (string | null | { error: string })[];
  error?: string;
}

export async function applyAppleOps(
  ops: AppleApplyOp[],
  options?: JxaRunOptions,
): Promise<{ ok: true; outcomes: AppleApplyOutcome[] }> {
  return runJxa({ op: 'apply', ops }, { timeoutMs: 240_000, ...options });
}
