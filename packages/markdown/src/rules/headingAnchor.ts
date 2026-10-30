import type { MarkdownIt, StateCore } from 'markdown-it';
import { createSlugger } from '../slug.js';

const HEADING_LEVELS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/**
 * Add stable `id` attributes to headings so the sidebar outline can scroll to them.
 * Implemented inline instead of pulling `markdown-it-anchor`, guaranteeing the ids match
 * `extractOutline()` exactly.
 */
export function headingAnchorPlugin(md: MarkdownIt): void {
  md.core.ruler.push('amd_heading_anchor', (state: StateCore) => {
    const slug = createSlugger();
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const open = tokens[i];
      if (!open || open.type !== 'heading_open' || !HEADING_LEVELS.has(open.tag)) continue;
      const inline = tokens[i + 1];
      if (!inline || inline.type !== 'inline') continue;
      // `inline.content` is the raw markdown of the heading; strip simple emphasis
      // markers so the slug matches the visible text.
      const text = inline.content.replace(/[*_`~]/g, '').trim();
      open.attrSet('id', slug(text || `heading-${i}`));
    }
  });
}
