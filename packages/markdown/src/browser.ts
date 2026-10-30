/**
 * Browser entry point.
 *
 * `@aimarkdown/markdown`      — synchronous, DOM-free pipeline (Node + browser)
 * `@aimarkdown/markdown/browser` — adds sanitisation and async shiki/mermaid enhancement
 */
export * from './index.js';
export { sanitizeHtml, sanitizeRendered, type SanitizeOptions } from './sanitize.js';
export {
  enhancePreview,
  highlightCodeBlocks,
  renderMermaidBlocks,
  type EnhanceOptions,
} from './enhance.js';

import { renderMarkdown, type RenderOptions } from './index.js';
import { sanitizeHtml } from './sanitize.js';

/** Render **and** sanitise. This is the function the web preview must use. */
export function renderSafeMarkdown(source: string, options: RenderOptions = {}): string {
  return sanitizeHtml(renderMarkdown(source, options).html, { allowTaskCheckboxes: true });
}
