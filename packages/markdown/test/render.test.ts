import { describe, expect, it } from 'vitest';
import { renderMarkdown, renderInlineMarkdown, extractOutline } from '../src/index.js';

const render = (src: string) => renderMarkdown(src).html;

describe('GFM surface', () => {
  it('renders tables', () => {
    const html = render('| a | b |\n| - | - |\n| 1 | 2 |\n');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>a</th>');
    expect(html).toContain('<td>2</td>');
  });

  it('renders strikethrough', () => {
    expect(render('~~gone~~')).toContain('<s>gone</s>');
  });

  it('renders task lists with disabled checkboxes', () => {
    const html = render('- [ ] todo\n- [x] done\n');
    expect(html).toMatch(/<input class="task-list-item-checkbox" type="checkbox" disabled>/);
    expect(html).toMatch(/type="checkbox" disabled checked>/);
    expect(html).toContain('task-list-item');
    expect(html).toContain('contains-task-list');
    // The marker itself must not leak into the visible label.
    expect(html).not.toContain('[ ]');
    expect(html).not.toContain('[x]');
  });

  it('does not treat a plain list as a task list', () => {
    const html = render('- normal item\n');
    expect(html).not.toContain('task-list-item-checkbox');
    expect(html).toContain('normal item');
  });

  it('handles nested task lists', () => {
    const html = render('- [ ] outer\n  - [x] inner\n');
    expect(html.match(/task-list-item-checkbox/g)?.length).toBe(2);
  });
});

describe('code blocks', () => {
  it('emits a language class the browser enhancer can pick up', () => {
    const html = render('```ts\nconst a: number = 1;\n```\n');
    expect(html).toContain('<pre>');
    expect(html).toContain('class="language-ts"');
    expect(html).toContain('const a: number = 1;');
  });

  it('escapes HTML inside code fences', () => {
    const html = render('```html\n<script>alert(1)</script>\n```\n');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('katex math', () => {
  it('renders inline math', () => {
    const html = render('Energy is $E = mc^2$ here.');
    expect(html).toContain('katex');
    expect(html).not.toContain('$E = mc^2$');
  });

  it('renders block math', () => {
    const html = render('$$\n\\int_0^1 x\\,dx\n$$\n');
    expect(html).toContain('math-block');
    expect(html).toContain('katex');
  });

  it('renders single-line block math', () => {
    expect(render('$$ e = mc^2 $$')).toContain('math-block');
  });

  it('degrades an invalid formula instead of throwing', () => {
    const html = render('$\\frac{$');
    expect(typeof html).toBe('string');
    // KaTeX with throwOnError:false still produces markup; the document must render.
    expect(html.length).toBeGreaterThan(0);
  });

  it('leaves currency-like text alone', () => {
    const html = render('I paid 5$ and you paid 6$ today.');
    expect(html).toContain('5$');
    expect(html).not.toContain('katex');
  });

  it('does not treat a lone $ as math', () => {
    expect(render('Price: $ 5')).not.toContain('katex');
  });
});

describe('mermaid', () => {
  it('emits a placeholder carrying the escaped source', () => {
    const html = render('```mermaid\ngraph TD;\nA-->B;\n```\n');
    expect(html).toContain('class="mermaid-block"');
    expect(html).toContain('class="mermaid-source"');
    expect(html).toContain('graph TD;');
    // Source is carried in text content, not an attribute (DOMPurify strips multiline
    // data-* values), so the raw `-->` must be escaped as text.
    expect(html).toContain('A--&gt;B;');
  });

  it('escapes markup-hostile characters in the mermaid source', () => {
    const html = render('```mermaid\ngraph TD;\nA["<b>x</b>"] --> B;\n```\n');
    expect(html).toContain('&quot;');
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toMatch(/<b>x<\/b>/);
  });

  it('leaves non-mermaid fences as ordinary code', () => {
    const html = render('```js\nconst x = 1;\n```\n');
    expect(html).not.toContain('mermaid-block');
  });
});

describe('wikilinks', () => {
  it('renders [[Target]] with the target in a data attribute', () => {
    const html = render('see [[My Note]] now');
    expect(html).toContain('class="wikilink"');
    expect(html).toContain('data-wikilink="My Note"');
    expect(html).toContain('>My Note</a>');
  });

  it('supports an alias', () => {
    const html = render('[[My Note|click here]]');
    expect(html).toContain('data-wikilink="My Note"');
    expect(html).toContain('>click here</a>');
  });

  it('still renders ordinary markdown links', () => {
    const html = render('[label](https://example.com)');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).not.toContain('wikilink');
  });

  it('leaves an unclosed [[ alone', () => {
    expect(render('a [[ b')).toContain('[[ b');
  });
});

describe('heading anchors', () => {
  it('adds ids that match extractOutline', () => {
    const src = '# Hello World\n\n## 中文标题\n\n## Hello World\n';
    const html = render(src);
    const outline = extractOutline(src);
    expect(outline.map((e) => e.id)).toEqual(['hello-world', '中文标题', 'hello-world-1']);
    for (const entry of outline) {
      expect(html).toContain(`id="${entry.id}"`);
    }
  });
});

describe('extractOutline', () => {
  it('records level, text and source line', () => {
    const outline = extractOutline('# Title\n\ntext\n\n### Deep\n');
    expect(outline).toHaveLength(2);
    expect(outline[0]).toMatchObject({ text: 'Title', level: 1, line: 0 });
    expect(outline[1]).toMatchObject({ text: 'Deep', level: 3, line: 4 });
  });

  it('ignores headings inside fenced code blocks', () => {
    const outline = extractOutline('# Real\n\n```\n# Not a heading\n```\n\n## Also Real\n');
    expect(outline.map((e) => e.text)).toEqual(['Real', 'Also Real']);
  });

  it('ignores a fence opened with ~~~ closing a ``` fence', () => {
    const outline = extractOutline('```\n~~~\n```\n# After\n');
    expect(outline.map((e) => e.text)).toEqual(['After']);
  });

  it('strips trailing closing hashes', () => {
    expect(extractOutline('## Title ##\n')[0]?.text).toBe('Title');
  });
});

describe('renderInlineMarkdown', () => {
  it('does not wrap in a paragraph', () => {
    const html = renderInlineMarkdown('**bold**');
    expect(html).toBe('<strong>bold</strong>');
  });
});

describe('empty and edge input', () => {
  it('handles empty source', () => {
    expect(render('')).toBe('');
    expect(extractOutline('')).toEqual([]);
  });

  it('handles nullish source defensively', () => {
    // @ts-expect-error runtime guard for JS callers
    expect(renderMarkdown(undefined).html).toBe('');
  });
});
