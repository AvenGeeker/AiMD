import type { MarkdownIt, StateBlock, StateInline } from 'markdown-it';
import katex from 'katex';

/**
 * LaTeX math via KaTeX.
 *
 * `$...$`   inline   — must not span lines, must not be padded with spaces, and the
 *                      character before the opening `$` must not be a digit (so prices
 *                      like `5$ and 6$` stay literal).
 * `$$...$$` block    — may span lines; must start at the beginning of a line.
 *
 * KaTeX is synchronous and runs in both Node and the browser, so math is rendered during
 * the pipeline rather than post-processed. Invalid formulas degrade to the original source
 * inside a `.math-error` span instead of aborting the whole document.
 */

function renderMath(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      errorColor: '#cc0000',
      output: 'htmlAndMathml',
      strict: 'ignore',
    });
  } catch (error) {
    // Keep the title single-line: DOMPurify strips attribute values containing newlines.
    const message = (error instanceof Error ? error.message : String(error))
      .replace(/\s+/g, ' ')
      .slice(0, 300);
    const safe = latex
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    return `<span class="math-error" title="${message.replace(/"/g, '&quot;')}">${safe}</span>`;
  }
}

function inlineMathRule(md: MarkdownIt): void {
  md.inline.ruler.after('escape', 'amd_math_inline', (state: StateInline, silent: boolean) => {
    const src = state.src;
    const start = state.pos;
    if (src.charCodeAt(start) !== 0x24 /* $ */) return false;
    if (src.charCodeAt(start + 1) === 0x24) return false; // block math, handled separately

    const prevChar = start === 0 ? '' : (src[start - 1] ?? '');
    if (prevChar && /[0-9]/.test(prevChar)) return false;

    let pos = start + 1;
    let found = -1;
    while (pos < state.posMax) {
      const code = src.charCodeAt(pos);
      if (code === 0x0a) break; // inline math never spans lines
      if (code === 0x5c /* \ */) {
        pos += 2;
        continue;
      }
      if (code === 0x24) {
        found = pos;
        break;
      }
      pos++;
    }
    if (found < 0) return false;

    const latex = src.slice(start + 1, found);
    if (latex.trim().length === 0) return false;
    if (latex.startsWith(' ') || latex.endsWith(' ')) return false;

    if (!silent) {
      const token = state.push('math_inline', '', 0);
      token.markup = '$';
      token.content = latex;
    }
    state.pos = found + 1;
    return true;
  });

  md.renderer.rules.math_inline = (tokens, idx) => renderMath(tokens[idx]?.content ?? '', false);
}

function blockMathRule(md: MarkdownIt): void {
  md.block.ruler.after(
    'blockquote',
    'amd_math_block',
    (state: StateBlock, startLine: number, endLine: number, silent: boolean) => {
      const startPos = state.bMarks[startLine]! + state.tShift[startLine]!;
      const lineMax = state.eMarks[startLine]!;
      if (startPos + 2 > lineMax) return false;
      if (state.src.slice(startPos, startPos + 2) !== '$$') return false;
      if (silent) return true;

      let nextLine = startLine;
      let content = '';
      let closed = false;

      // Same-line close: `$$ e=mc^2 $$`
      const firstLineText = state.src.slice(startPos + 2, lineMax).trim();
      if (firstLineText.endsWith('$$') && firstLineText.length >= 2) {
        content = firstLineText.slice(0, -2).trim();
        closed = true;
        nextLine = startLine + 1;
      } else {
        const collected: string[] = [];
        if (firstLineText.length > 0) collected.push(firstLineText);
        for (nextLine = startLine + 1; nextLine < endLine; nextLine++) {
          const from = state.bMarks[nextLine]! + state.tShift[nextLine]!;
          const to = state.eMarks[nextLine]!;
          const text = state.src.slice(from, to);
          const trimmed = text.trim();
          if (trimmed === '$$' || trimmed.endsWith('$$')) {
            if (trimmed !== '$$') collected.push(trimmed.slice(0, -2));
            nextLine++;
            closed = true;
            break;
          }
          collected.push(text);
        }
        content = collected.join('\n').trim();
      }

      if (!closed) return false;

      const token = state.push('math_block', 'div', 0);
      token.block = true;
      token.markup = '$$';
      token.content = content;
      token.map = [startLine, nextLine];
      state.line = nextLine;
      return true;
    },
  );

  md.renderer.rules.math_block = (tokens, idx) =>
    `<div class="math-block">${renderMath(tokens[idx]?.content ?? '', true)}</div>\n`;
}

export function katexPlugin(md: MarkdownIt): void {
  inlineMathRule(md);
  blockMathRule(md);
}
