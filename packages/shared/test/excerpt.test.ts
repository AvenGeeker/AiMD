import { describe, expect, it } from 'vitest';
import { cleanMarkdownExcerpt } from '../src/excerpt.js';

describe('cleanMarkdownExcerpt', () => {
  it('drops favourite provenance quotes, urls and ocr markers', () => {
    const body = [
      '> 来源：网页 · AI超元域',
      '> 原文：https://example.com/a',
      '<!-- aimd-ocr:img1 -->',
      '识别出的文字内容',
      '<!-- end -->',
      'https://example.com/bare',
      '## 文章目录',
      '1. [一节](#一节)',
      '正文 **加粗** 与 `code` 与 [链接](https://x.dev)。',
    ].join('\n');
    expect(cleanMarkdownExcerpt(body)).toBe('识别出的文字内容 一节 正文 加粗 与 code 与 链接。');
  });

  it('skips code fences entirely', () => {
    const body = ['intro', '```ts', 'const a = 1;', '```', 'outro'].join('\n');
    expect(cleanMarkdownExcerpt(body)).toBe('intro outro');
  });

  it('collapses whitespace and truncates with an ellipsis', () => {
    const body = 'a'.repeat(300);
    const out = cleanMarkdownExcerpt(body, 50);
    expect(out).toHaveLength(51);
    expect(out.endsWith('…')).toBe(true);
  });

  it('returns empty string for scaffolding-only bodies', () => {
    expect(cleanMarkdownExcerpt('> 来源：x\n> 原文：https://a.b\n<!-- c -->')).toBe('');
    expect(cleanMarkdownExcerpt('')).toBe('');
  });
});
