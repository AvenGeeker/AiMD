import { describe, expect, it } from 'vitest';
import { conflictBaseTitle, conflictCopyKey } from '../src/main/apple-notes/conflicts.js';

describe('apple notes conflict copies', () => {
  it('strips only the generated timestamp suffix from the base title', () => {
    expect(conflictBaseTitle('登录 - rednote（Apple 版本）（冲突 2026/11/4 01:11:45）'))
      .toBe('登录 - rednote（Apple 版本）');
    expect(conflictBaseTitle('普通标题')).toBe('普通标题');
  });

  it('treats copies of the same folder, title and content as duplicates', () => {
    const first = conflictCopyKey('folder-1', '标题（Apple 版本）（冲突 2026/11/4 01:11:45）', '> 来源：网页\n\n正文');
    const second = conflictCopyKey('folder-1', '标题（Apple 版本）（冲突 2026/11/4 06:25:21）', '> 来源：网页\n\n正文');
    expect(second).toBe(first);
  });

  it('keeps different content, title or folder apart', () => {
    const base = conflictCopyKey('folder-1', '标题', '正文 A');
    expect(conflictCopyKey('folder-1', '标题', '正文 B')).not.toBe(base);
    expect(conflictCopyKey('folder-1', '另一个标题', '正文 A')).not.toBe(base);
    expect(conflictCopyKey('folder-2', '标题', '正文 A')).not.toBe(base);
  });
});

describe('empty note detection', () => {
  it('treats whitespace-only bodies and bodies that repeat the title as empty', async () => {
    const { effectivelyEmptyBody } = await import('../src/main/apple-notes/conflicts.js');
    expect(effectivelyEmptyBody('6d ago 江苏', '')).toBe(true);
    expect(effectivelyEmptyBody('6d ago 江苏', '\n')).toBe(true);
    expect(effectivelyEmptyBody('6d ago 江苏', '6d ago 江苏\n')).toBe(true);
    expect(effectivelyEmptyBody('6d ago 江苏', '真正的正文')).toBe(false);
  });
});
