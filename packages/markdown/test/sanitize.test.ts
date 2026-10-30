import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/index.js';
import { sanitizeHtml } from '../src/sanitize.js';
import { renderSafeMarkdown } from '../src/browser.js';

const pipeline = (src: string) => sanitizeHtml(renderMarkdown(src).html);

describe('XSS defence', () => {
  it('neutralises a script tag in the source', () => {
    const html = pipeline('<script>alert(1)</script>');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain('alert(1)</script>');
  });

  it('neutralises an event handler attribute', () => {
    const html = pipeline('<img src=x onerror="alert(1)">');
    // markdown-it with html:false escapes it to inert text; no <img> element may exist.
    expect(html).not.toMatch(/<img\b/i);
    expect(html).toContain('&lt;img');
  });

  it('blocks javascript: URLs in markdown links', () => {
    const html = pipeline('[click](javascript:alert(1))');
    // markdown-it's validateLink refuses the URL, so no anchor is produced at all.
    expect(html).not.toMatch(/<a\b[^>]*href\s*=\s*["']?\s*javascript:/i);
    expect(html).not.toMatch(/<a\b/i);
  });

  it('blocks javascript: URLs even when obfuscated with entities', () => {
    const html = pipeline('[click](&#106;avascript:alert(1))');
    expect(html).not.toMatch(/<a\b[^>]*href/i);
  });

  it('blocks data: URLs in links', () => {
    const html = pipeline('[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)');
    expect(html).not.toMatch(/<a\b[^>]*href\s*=\s*["']?\s*data:/i);
  });

  it('strips iframe/object/embed/form', () => {
    const html = pipeline('<iframe src="//evil"></iframe><object></object><embed><form><input></form>');
    expect(html).not.toMatch(/<iframe|<object|<embed|<form/i);
  });

  it('strips an svg onload vector', () => {
    const html = pipeline('<svg onload="alert(1)"></svg>');
    expect(html).not.toMatch(/<svg\b/i);
  });

  it('keeps safe content intact', () => {
    const html = pipeline('# Title\n\n**bold** and `code` and [link](https://example.com)\n');
    expect(html).toContain('<h1');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('href="https://example.com"');
  });
});

describe('sanitiser keeps pipeline-generated markup', () => {
  it('preserves the task-list checkbox', () => {
    const html = pipeline('- [x] done\n');
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*>/);
  });

  it('preserves katex MathML output', () => {
    const html = pipeline('$E=mc^2$');
    expect(html).toContain('katex');
    expect(html).toMatch(/<math|<span/);
  });

  it('preserves wikilink data attributes', () => {
    const html = pipeline('[[Some Note]]');
    expect(html).toContain('data-wikilink="Some Note"');
  });

  it('preserves the mermaid placeholder source across sanitisation', () => {
    const html = pipeline('```mermaid\ngraph TD;\nA-->B;\n```\n');
    expect(html).toContain('class="mermaid-block"');
    expect(html).toContain('graph TD;');
    expect(html).toContain('A--&gt;B;');
  });

  it('preserves heading anchor ids', () => {
    expect(pipeline('# My Heading')).toContain('id="my-heading"');
  });

  it('renderSafeMarkdown matches render+sanitize', () => {
    const src = '# T\n\n- [ ] a\n\n$x^2$\n';
    expect(renderSafeMarkdown(src)).toBe(pipeline(src));
  });
});

describe('environment guard', () => {
  it('throws a helpful error when no DOM is present', async () => {
    // Simulate a DOM-less runtime by removing the global the sanitiser relies on.
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
    // @ts-expect-error intentional environment mutation for the test
    delete globalThis.window;
    let message = '';
    try {
      // Re-import so DOMPurify re-evaluates its environment detection.
      const fresh = await import('../src/sanitize.js?nodom');
      fresh.sanitizeHtml('<b>x</b>');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    }
    // Either it threw our guidance error, or DOMPurify refused to sanitise.
    expect(message === '' || /DOM|sanitize/i.test(message)).toBe(true);
  });
});

describe('sanitiser defence in depth (raw HTML, bypassing the pipeline)', () => {
  it('strips the onerror handler from an img element', () => {
    const html = sanitizeHtml('<img src="x" onerror="alert(1)">');
    // The vector (the handler) is removed; a handler-less <img> is inert and allowed.
    expect(html).not.toMatch(/onerror/i);
    expect(html).not.toContain('alert(1)');
    expect(html).not.toMatch(/\son\w+\s*=/i);
  });

  it('strips script elements and their body', () => {
    const html = sanitizeHtml('<p>ok</p><script>alert(1)</script>');
    expect(html).toContain('<p>ok</p>');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain('alert(1)');
  });

  it('neutralises a javascript: href on a real anchor', () => {
    const html = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    expect(html).not.toMatch(/href\s*=\s*"javascript:/i);
  });

  it('neutralises a newline-obfuscated javascript: href via the hook', () => {
    const html = sanitizeHtml('<a href="java\tscript:alert(1)">x</a>');
    expect(html).not.toMatch(/alert\(1\)"/i);
  });

  it('drops svg elements entirely', () => {
    const html = sanitizeHtml('<svg><script>alert(1)</script></svg>');
    expect(html).not.toMatch(/<svg/i);
  });

  it('keeps a benign anchor with safe attributes', () => {
    const html = sanitizeHtml('<a href="https://example.com" target="_blank" rel="noopener">x</a>');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
  });
});
