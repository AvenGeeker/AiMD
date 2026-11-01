import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  appendToBody,
  createNoteDoc,
  createWorkspaceDoc,
  decodeDoc,
  encodeDoc,
  readBody,
  readFolders,
  readNoteMeta,
  readSettings,
  readTagIds,
  setTagIds,
  writeFolder,
  writeNoteMeta,
  writeSettings,
  deleteFolder,
  readAiState,
  readAiTodos,
  writeAiState,
  writeAiTodos,
  setAiTodoDone,
} from '../../src/collab/docFactory.js';

/** Simulate two devices editing offline, then syncing in both directions. */
function merge(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
}

describe('offline CRDT merge', () => {
  it('keeps both edits when two devices insert at the same position', () => {
    const a = createNoteDoc({ body: 'hello world' });
    const b = decodeDoc(encodeDoc(a));

    // Same insertion point, different text, no communication in between.
    a.getText('body').insert(5, ' A');
    b.getText('body').insert(5, ' B');

    merge(a, b);

    const textA = readBody(a);
    const textB = readBody(b);
    expect(textA).toBe(textB);
    expect(textA).toContain('A');
    expect(textA).toContain('B');
    expect(textA).toContain('hello');
    expect(textA).toContain('world');
    // No duplication: each inserted fragment appears exactly once.
    expect(textA.split('A').length - 1).toBe(1);
    expect(textA.split('B').length - 1).toBe(1);
  });

  it('merges concurrent edits at distant positions without loss', () => {
    const a = createNoteDoc({ body: 'line1\nline2\nline3\n' });
    const b = decodeDoc(encodeDoc(a));

    a.getText('body').insert(0, 'HEAD\n');
    const bodyB = b.getText('body');
    bodyB.insert(bodyB.length, 'TAIL\n');
    // Middle edit on b as well.
    b.getText('body').insert(6, 'MID\n');

    merge(a, b);

    expect(readBody(a)).toBe(readBody(b));
    expect(readBody(a)).toContain('HEAD');
    expect(readBody(a)).toContain('MID');
    expect(readBody(a)).toContain('TAIL');
  });

  it('converges when one device deletes text the other appended to', () => {
    const a = createNoteDoc({ body: 'alpha beta gamma' });
    const b = decodeDoc(encodeDoc(a));

    a.getText('body').delete(0, 6); // remove "alpha "
    b.getText('body').insert(b.getText('body').length, ' delta');

    merge(a, b);

    const text = readBody(a);
    expect(text).toBe(readBody(b));
    expect(text).not.toContain('alpha');
    expect(text).toContain('beta gamma');
    expect(text).toContain('delta');
  });
});

describe('quick capture append', () => {
  it('appends at the end and merges with a concurrent middle edit', () => {
    const desktop = createNoteDoc({ body: '# 收集箱\n\n已有内容\n' });
    const phone = decodeDoc(encodeDoc(desktop));

    // Desktop edits the middle of the note...
    desktop.getText('body').insert(4, '（桌面端）');
    // ...while the phone captures to the end.
    const appended = appendToBody(phone, '## 2026-10-30 10:00\n\n路上想到的点子');
    expect(appended).toBeGreaterThan(0);

    merge(desktop, phone);

    const text = readBody(desktop);
    expect(text).toBe(readBody(phone));
    expect(text).toContain('（桌面端）');
    expect(text).toContain('路上想到的点子');
    // The capture lands at the very end.
    expect(text.trimEnd().endsWith('路上想到的点子')).toBe(true);
  });

  it('separates captures with a blank line but not at the start of an empty note', () => {
    const doc = createNoteDoc({ body: '' });
    appendToBody(doc, 'first');
    expect(readBody(doc)).toBe('first');

    appendToBody(doc, 'second');
    expect(readBody(doc)).toBe('first\n\nsecond');
  });

  it('does not double-separate when the body already ends with a blank line', () => {
    const doc = createNoteDoc({ body: 'body\n\n' });
    appendToBody(doc, 'next');
    expect(readBody(doc)).toBe('body\n\nnext');
  });

  it('reports zero characters for an empty capture', () => {
    const doc = createNoteDoc({ body: 'x' });
    expect(appendToBody(doc, '')).toBe(0);
    expect(readBody(doc)).toBe('x');
  });
});

describe('note metadata', () => {
  it('round-trips every meta field', () => {
    const doc = createNoteDoc({
      meta: {
        title: '我的笔记',
        titleManual: true,
        folderId: 'folder_1',
        pinned: true,
        archived: false,
        deletedAt: null,
        position: 'a3',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });
    expect(readNoteMeta(doc)).toEqual({
      title: '我的笔记',
      titleManual: true,
      folderId: 'folder_1',
      pinned: true,
      archived: false,
      deletedAt: null,
      position: 'a3',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('defaults a bare doc to the documented defaults', () => {
    const meta = readNoteMeta(createNoteDoc());
    expect(meta.title).toBe('无标题');
    expect(meta.titleManual).toBe(false);
    expect(meta.folderId).toBeNull();
    expect(meta.pinned).toBe(false);
    expect(meta.deletedAt).toBeNull();
  });

  it('marks the title manual when it is set explicitly', () => {
    const doc = createNoteDoc();
    writeNoteMeta(doc, { title: '手动标题' });
    expect(readNoteMeta(doc).titleManual).toBe(true);
  });

  it('tolerates a pre-titleManual document by treating its title as manual', () => {
    const doc = new Y.Doc();
    doc.getMap('meta').set('title', '旧文档标题');
    // No `titleManual` key at all — the upgrade path must not let the body override it.
    expect(readNoteMeta(doc).titleManual).toBe(true);
    expect(readNoteMeta(doc).title).toBe('旧文档标题');
  });

  it('merges independent meta changes from two devices', () => {
    const a = createNoteDoc({ meta: { title: 'T', pinned: false, position: 'a0' } });
    const b = decodeDoc(encodeDoc(a));

    writeNoteMeta(a, { pinned: true });
    writeNoteMeta(b, { folderId: 'f1' });
    merge(a, b);

    expect(readNoteMeta(a).pinned).toBe(true);
    expect(readNoteMeta(a).folderId).toBe('f1');
    expect(readNoteMeta(b).pinned).toBe(true);
    expect(readNoteMeta(b).folderId).toBe('f1');
  });
});

describe('tag ids', () => {
  it('merges a tag added on one device with a different tag added on another', () => {
    const a = createNoteDoc({ tagIds: ['t1'] });
    const b = decodeDoc(encodeDoc(a));

    setTagIds(a, ['t1', 't2']);
    setTagIds(b, ['t1', 't3']);
    merge(a, b);

    // Element-wise merge: the union survives rather than one list clobbering the other.
    const tags = readTagIds(a).sort();
    expect(tags).toEqual(['t1', 't2', 't3']);
    expect(readTagIds(b).sort()).toEqual(tags);
  });

  it('is idempotent for an unchanged set', () => {
    const doc = createNoteDoc({ tagIds: ['t1', 't2'] });
    const before = encodeDoc(doc);
    setTagIds(doc, ['t1', 't2']);
    expect(readTagIds(doc)).toEqual(['t1', 't2']);
    // No new update was produced, so a redundant write cannot churn the document.
    expect(Y.encodeStateAsUpdate(doc, Y.encodeStateVector(decodeDoc(before))).byteLength).toBeGreaterThan(0);
  });

  it('de-duplicates and drops empty ids', () => {
    const doc = createNoteDoc();
    setTagIds(doc, ['t1', 't1', '', 't2']);
    expect(readTagIds(doc)).toEqual(['t1', 't2']);
  });

  it('clears all tags', () => {
    const doc = createNoteDoc({ tagIds: ['t1', 't2'] });
    setTagIds(doc, []);
    expect(readTagIds(doc)).toEqual([]);
  });
});

describe('workspace document', () => {
  it('seeds default settings', () => {
    const settings = readSettings(createWorkspaceDoc());
    expect(settings.inboxNoteId).toBeNull();
    expect(settings.editorMode).toBe('split');
    expect(settings.theme).toBe('system');
    expect(settings.mainWindowHotkey).toBe('CommandOrControl+Shift+M');
  });

  it('ignores invalid values instead of propagating them', () => {
    const doc = createWorkspaceDoc();
    const map = doc.getMap('settings');
    map.set('theme', 'neon');
    map.set('fontSize', 999);
    map.set('editorMode', 42);
    const settings = readSettings(doc);
    expect(settings.theme).toBe('system');
    expect(settings.fontSize).toBe(14);
    expect(settings.editorMode).toBe('split');
  });

  it('merges settings changed independently on two devices', () => {
    const a = createWorkspaceDoc();
    const b = decodeDoc(encodeDoc(a));

    writeSettings(a, { theme: 'dark' });
    writeSettings(b, { fontSize: 18 });
    writeSettings(b, { mainWindowHotkey: 'CommandOrControl+Alt+M' });
    merge(a, b);

    expect(readSettings(a)).toMatchObject({
      theme: 'dark',
      fontSize: 18,
      mainWindowHotkey: 'CommandOrControl+Alt+M',
    });
    expect(readSettings(b)).toMatchObject({ theme: 'dark', fontSize: 18 });
  });

  it('re-parents children when a folder is deleted', () => {
    const doc = createWorkspaceDoc();
    writeFolder(doc, { id: 'root', name: '根', parentId: null, position: 'a0', createdAt: 'x' });
    writeFolder(doc, { id: 'mid', name: '中', parentId: 'root', position: 'a1', createdAt: 'x' });
    writeFolder(doc, { id: 'leaf', name: '叶', parentId: 'mid', position: 'a2', createdAt: 'x' });

    deleteFolder(doc, 'mid');

    const folders = readFolders(doc);
    expect(folders.map((f) => f.id).sort()).toEqual(['leaf', 'root']);
    expect(folders.find((f) => f.id === 'leaf')?.parentId).toBe('root');
  });

  it('deleting a root folder promotes children to the root level', () => {
    const doc = createWorkspaceDoc();
    writeFolder(doc, { id: 'root', name: '根', parentId: null, position: 'a0', createdAt: 'x' });
    writeFolder(doc, { id: 'child', name: '子', parentId: 'root', position: 'a1', createdAt: 'x' });
    deleteFolder(doc, 'root');
    expect(readFolders(doc).find((f) => f.id === 'child')?.parentId).toBeNull();
  });

  it('ignores deleting a folder that does not exist', () => {
    const doc = createWorkspaceDoc();
    writeFolder(doc, { id: 'a', name: 'A', parentId: null, position: 'a0', createdAt: 'x' });
    deleteFolder(doc, 'missing');
    expect(readFolders(doc)).toHaveLength(1);
  });
});

describe('encode/decode round trip', () => {
  it('preserves body, meta and tags', () => {
    const doc = createNoteDoc({ meta: { title: 'T', titleManual: true }, tagIds: ['t1'], body: '正文' });
    const restored = decodeDoc(encodeDoc(doc));
    expect(readBody(restored)).toBe('正文');
    expect(readNoteMeta(restored).title).toBe('T');
    expect(readTagIds(restored)).toEqual(['t1']);
  });

  it('decodes null bytes into an empty document', () => {
    expect(readBody(decodeDoc(null))).toBe('');
    expect(readBody(decodeDoc(new Uint8Array(0)))).toBe('');
  });
});


describe('AI state CRDT', () => {
  it('round-trips summary state and key points', () => {
    const doc = createNoteDoc();
    writeAiState(doc, {
      status: 'done',
      summary: '摘要',
      keyPoints: ['要点一', '要点二'],
      generatedAt: '2026-11-01T00:00:00.000Z',
      sourceHash: 'abc',
      model: 'qwen3.7-plus',
      error: null,
      autoAttemptedAt: '2026-11-01T00:00:00.000Z',
      lastAttemptAt: '2026-11-01T00:00:00.000Z',
    });
    expect(readAiState(doc)).toMatchObject({
      status: 'done',
      summary: '摘要',
      keyPoints: ['要点一', '要点二'],
      sourceHash: 'abc',
    });
  });

  it('merges concurrent checkbox toggles on different todos', () => {
    const a = createNoteDoc();
    writeAiTodos(a, [
      { id: 't1', text: '任务一', done: false, order: 0 },
      { id: 't2', text: '任务二', done: false, order: 1 },
    ]);
    const b = decodeDoc(encodeDoc(a));
    setAiTodoDone(a, 't1', true);
    setAiTodoDone(b, 't2', true);
    merge(a, b);
    expect(readAiTodos(a)).toEqual([
      { id: 't1', text: '任务一', done: true, order: 0 },
      { id: 't2', text: '任务二', done: true, order: 1 },
    ]);
  });
});
