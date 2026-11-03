import { describe, expect, it } from 'vitest';
import { highlightCodeBlocks } from '../src/enhance.js';

describe('browser syntax highlighting', () => {
  it('highlights supported languages, aliases and plain-text fallbacks', async () => {
    const root = document.createElement('div');
    const blocks: Array<[string, string]> = [
      ['typescript', 'const answer: number = 42;'],
      ['shell', 'echo hello'],
      ['not-a-language', 'plain text'],
    ];

    for (const [lang, source] of blocks) {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.className = `language-${lang}`;
      code.textContent = source;
      pre.appendChild(code);
      root.appendChild(pre);
    }

    await highlightCodeBlocks(root);

    expect(root.querySelectorAll('pre.shiki')).toHaveLength(blocks.length);
    expect(root.textContent).toContain('const answer');
    expect(root.textContent).toContain('echo hello');
    expect(root.textContent).toContain('plain text');
  });
});
