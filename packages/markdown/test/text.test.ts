import { describe, expect, it } from 'vitest';
import { countWords, makeExcerpt, stripMarkdown } from '../src/text.js';

describe('stripMarkdown', () => {
  it('removes emphasis, code spans and strikethrough', () => {
    expect(stripMarkdown('**bold** _it_ `code` ~~struck~~')).toBe('bold it code struck');
  });

  it('keeps link labels and drops URLs', () => {
    expect(stripMarkdown('see [the docs](https://example.com/x) now')).toBe('see the docs now');
  });

  it('drops images entirely', () => {
    expect(stripMarkdown('before ![alt text](img.png) after')).toBe('before after');
  });

  it('resolves wikilinks and their aliases', () => {
    expect(stripMarkdown('a [[Note]] b [[Note|Alias]] c')).toBe('a Note b Alias c');
  });

  it('removes heading markers, blockquotes and list markers', () => {
    expect(stripMarkdown('# Title\n> quote\n- item\n1. ordered')).toBe('Title quote item ordered');
  });

  it('removes task-list markers', () => {
    expect(stripMarkdown('- [ ] todo\n- [x] done')).toBe('todo done');
  });

  it('drops fenced code and block math', () => {
    expect(stripMarkdown('text\n```js\nconst a = 1;\n```\nmore\n$$x^2$$\nend')).toBe('text more end');
  });

  it('drops HTML comments', () => {
    expect(stripMarkdown('a <!-- secret --> b')).toBe('a b');
  });

  it('collapses table pipes to spaces', () => {
    expect(stripMarkdown('| a | b |')).toBe('a b');
  });
});

describe('countWords', () => {
  it('counts CJK characters individually', () => {
    expect(countWords('你好世界')).toBe(4);
  });

  it('counts latin runs as one word', () => {
    expect(countWords('hello world')).toBe(2);
  });

  it('handles mixed Chinese/English', () => {
    // 4 CJK characters counted individually + 1 latin word ("Yjs") = 5
    expect(countWords('使用 Yjs 同步')).toBe(5);
  });

  it('ignores markdown syntax', () => {
    expect(countWords('# **标题**')).toBe(2);
  });

  it('returns 0 for empty input', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n  ')).toBe(0);
  });
});

describe('makeExcerpt', () => {
  it('returns the full text when short enough', () => {
    expect(makeExcerpt('short text')).toBe('short text');
  });

  it('truncates with an ellipsis', () => {
    const src = 'a'.repeat(500);
    const excerpt = makeExcerpt(src, 200);
    expect(excerpt).toHaveLength(201);
    expect(excerpt.endsWith('…')).toBe(true);
  });

  it('strips markdown before truncating', () => {
    expect(makeExcerpt('# **Title** with [link](http://x)')).toBe('Title with link');
  });
});
