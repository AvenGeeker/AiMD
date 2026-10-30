import type { MarkdownIt, StateInline } from 'markdown-it';

/**
 * Obsidian-style wikilinks: `[[Note Title]]` and `[[Note Title|Display Text]]`.
 *
 * Rendered as an anchor carrying the raw target in `data-wikilink`; the client resolves
 * the target to a note id (by title lookup) on click, so no resolver needs to be injected
 * into the render pipeline. Registered *before* the standard `link` rule so `[[...]]` is
 * not mistaken for a shortcut reference link.
 */
export function wikilinkPlugin(md: MarkdownIt): void {
  md.inline.ruler.before('link', 'amd_wikilink', (state: StateInline, silent: boolean) => {
    const src = state.src;
    const start = state.pos;
    if (src.charCodeAt(start) !== 0x5b /* [ */) return false;
    if (src.charCodeAt(start + 1) !== 0x5b) return false;

    let pos = start + 2;
    let found = -1;
    while (pos < state.posMax - 1) {
      const code = src.charCodeAt(pos);
      if (code === 0x0a) return false; // wikilinks never span lines
      if (code === 0x5d /* ] */ && src.charCodeAt(pos + 1) === 0x5d) {
        found = pos;
        break;
      }
      pos++;
    }
    if (found < 0) return false;

    const inner = src.slice(start + 2, found);
    if (inner.trim().length === 0) return false;

    const bar = inner.indexOf('|');
    const target = (bar === -1 ? inner : inner.slice(0, bar)).trim();
    const alias = bar === -1 ? null : inner.slice(bar + 1).trim();
    if (target.length === 0) return false;

    if (!silent) {
      const token = state.push('wikilink', '', 0);
      token.content = target;
      token.meta = { alias };
    }
    state.pos = found + 2;
    return true;
  });

  md.renderer.rules.wikilink = (tokens, idx) => {
    const token = tokens[idx];
    if (!token) return '';
    const target = token.content;
    const alias = (token.meta as { alias?: string | null } | null)?.alias;
    const label = alias && alias.length > 0 ? alias : target;
    const esc = md.utils.escapeHtml;
    return `<a class="wikilink" href="#" data-wikilink="${esc(target)}">${esc(label)}</a>`;
  };
}
