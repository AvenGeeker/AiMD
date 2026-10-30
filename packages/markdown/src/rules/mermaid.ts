import type { MarkdownIt, RendererRule } from 'markdown-it';

/**
 * Mermaid diagrams.
 *
 * The pipeline is synchronous and must stay usable in Node (export, tests), while mermaid
 * itself is a heavy browser-only renderer. So a ` ```mermaid ` fence becomes a placeholder
 * whose raw source sits in a `<pre><code>` child; `enhancePreview()` in the browser entry
 * reads that text back and swaps the block for an SVG. Until then the source stays visible,
 * so nothing is silently lost.
 *
 * The source deliberately lives in text content rather than a `data-mermaid` attribute:
 * DOMPurify drops data-* attributes whose value contains a newline, and diagram source is
 * multiline by definition.
 */
export function mermaidPlugin(md: MarkdownIt): void {
  const defaultFence: RendererRule | undefined = md.renderer.rules.fence;

  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    if (!token) return self.renderToken(tokens, idx, options);
    const info = token.info ? md.utils.unescapeAll(token.info).trim() : '';
    const langName = info.split(/[\s,]+/)[0] ?? '';
    if (langName.toLowerCase() === 'mermaid') {
      const escaped = md.utils.escapeHtml(token.content);
      return `<div class="mermaid-block"><pre><code class="mermaid-source">${escaped}</code></pre></div>\n`;
    }
    if (defaultFence) return defaultFence(tokens, idx, options, env, self);
    return self.renderToken(tokens, idx, options);
  };
}
