import { describe, expect, it } from 'vitest';
import {
  appAttachmentIds,
  canonicalMarkdown,
  hasLossyMarkdown,
  htmlToMarkdown,
  markdownToHtml,
  splitAppleTitle,
} from '../src/main/apple-notes/convert.js';
import { noteStateHash } from '../src/main/apple-notes/hash.js';

describe('Apple Notes conversion', () => {
  it('normalises line endings, trailing spaces and blank runs', () => {
    expect(canonicalMarkdown('a  \r\n\r\n\r\nb')).toBe('a  \n\nb\n');
    expect(canonicalMarkdown('a   \n\nb')).toBe('a  \n\nb\n');
  });

  it('splits the Apple title from the converted body without duplicating it', () => {
    const result = splitAppleTitle('周会', htmlToMarkdown('<h1>周会</h1><p>讨论事项</p>'));
    expect(result.title).toBe('周会');
    expect(result.body).toContain('讨论事项');
    expect(result.body).not.toContain('周会');
  });

  it('keeps a body heading that differs from the Apple title', () => {
    const markdown = htmlToMarkdown('<h1>正文标题</h1><p>内容</p>');
    const result = splitAppleTitle('备忘录名字', markdown);
    expect(result.title).toBe('备忘录名字');
    expect(result.body).toContain('正文标题');
  });

  it('maps attachment placeholders into Markdown links and images', () => {
    const html = '<p><img src="cid:asset-1" alt="图"></p><p><a href="cid:file-1">文件</a></p>';
    const md = htmlToMarkdown(html, [
      { source: 'cid:asset-1', replacement: '/api/attachments/img1', image: true },
      { source: 'cid:file-1', replacement: '/api/attachments/pdf1', image: false },
    ]);
    expect(md).toContain('![图](/api/attachments/img1)');
    expect(md).toContain('[文件](/api/attachments/pdf1)');
  });

  it('renders task lists and detects lossy constructs', () => {
    const html = markdownToHtml('- [x] done\n- [ ] todo');
    expect(html).toContain('type="checkbox"');
    expect(hasLossyMarkdown('```mermaid\ngraph TD; A-->B\n```')).toBe(true);
    expect(hasLossyMarkdown('普通文本')).toBe(false);
    expect(hasLossyMarkdown('NDK=$NDK; TOOLCHAIN=$TOOLCHAIN')).toBe(false);
  });

  it('collects unique app attachment ids from links and images', () => {
    expect(appAttachmentIds('![](/api/attachments/a1) [x](/api/attachments/a1) [y](/api/attachments/a2)'))
      .toEqual(['a1', 'a2']);
  });

  it('hashes the title, folder and body deterministically', () => {
    expect(noteStateHash('T', null, 'B')).toHaveLength(64);
    expect(noteStateHash('T', null, 'B')).toBe(noteStateHash('T', null, 'B'));
    expect(noteStateHash('T', null, 'B')).not.toBe(noteStateHash('T', 'f', 'B'));
  });

  it('preserves Markdown pasted as literal Apple Notes text and recovers line structure', () => {
    const html = '<div>2026-03-04</div>\n<div># AI 新闻速递 ## 头条 - **集成四大模型**：Gemini --- *来源：example.com*</div>';
    const md = htmlToMarkdown(html);
    expect(md).toContain('# AI 新闻速递');
    expect(md).toContain('## 头条');
    expect(md).toContain('\n- **集成四大模型**');
    expect(md).toContain('\n---');
    expect(md).not.toContain('\\#');
    expect(md).not.toContain('\\*');
  });

  it('does not leave standalone bold markers around nested headings', () => {
    const md = htmlToMarkdown('<div><b><h1>标题</h1></b></div><div>第一段</div><div><br></div><div>第二段</div>');
    expect(md).toContain('# 标题');
    expect(md).not.toMatch(/^\*\*/m);
    expect(md).toContain('第一段');
    expect(md).toContain('第二段');
  });
});
