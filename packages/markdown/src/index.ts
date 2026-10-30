import MarkdownItCtor from 'markdown-it';
import type { MarkdownIt, MarkdownItOptions, RendererRule } from 'markdown-it';
import { headingAnchorPlugin } from './rules/headingAnchor.js';
import { taskListPlugin } from './rules/taskList.js';
import { katexPlugin } from './rules/katex.js';
import { wikilinkPlugin } from './rules/wikilink.js';
import { mermaidPlugin } from './rules/mermaid.js';

export { slugify, createSlugger } from './slug.js';
export { extractOutline, type OutlineEntry } from './outline.js';
export { countWords, makeExcerpt, stripMarkdown, deriveTitle, cleanTitleText } from './text.js';

/**
 * The markdown pipeline is deliberately **synchronous and DOM-free** so the exact same
 * output is produced in the browser preview, in Node for exports, and in tests.
 *
 * Security model: `html: false` makes markdown-it escape every raw HTML tag in the source,
 * so user-authored `<script>` / `<img onerror>` never reaches the output as markup. The
 * browser entry additionally runs DOMPurify over the result as defence in depth.
 */

export interface RenderOptions {
  /** Turn newline characters in paragraphs into `<br>`. Off by default (CommonMark). */
  breaks?: boolean;
}

export interface RenderResult {
  html: string;
}

export function createRenderer(options: RenderOptions = {}): MarkdownIt {
  const md: MarkdownIt = new MarkdownItCtor({
    html: false, // never emit raw HTML from the source
    linkify: true,
    typographer: false,
    breaks: options.breaks ?? false,
    xhtmlOut: false,
  } satisfies Partial<MarkdownItOptions>);

  // markdown-it ships GFM tables and `~~strikethrough~~` built in; enable explicitly.
  md.enable(['table', 'strikethrough'], true);

  md.use(katexPlugin);
  md.use(wikilinkPlugin);
  md.use(taskListPlugin);
  md.use(mermaidPlugin);
  md.use(headingAnchorPlugin);

  // Open external links in a new tab without leaking referrer or window access.
  const defaultLinkOpen: RendererRule =
    md.renderer.rules.link_open ?? ((tokens, idx, opts) => self0(tokens, idx, opts));
  function self0(tokens: Parameters<RendererRule>[0], idx: number, opts: Parameters<RendererRule>[2]) {
    return md.renderer.renderToken(tokens, idx, opts);
  }

  md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
    const token = tokens[idx];
    if (token) {
      const href = String(token.attrGet('href') ?? '');
      if (/^https?:\/\//i.test(href)) {
        token.attrSet('target', '_blank');
        token.attrSet('rel', 'noopener noreferrer nofollow');
      }
    }
    return defaultLinkOpen(tokens, idx, opts, env, self);
  };

  return md;
}

const cache = new Map<string, MarkdownIt>();

function getRenderer(options: RenderOptions): MarkdownIt {
  const key = `breaks:${options.breaks ? '1' : '0'}`;
  let md = cache.get(key);
  if (!md) {
    md = createRenderer(options);
    cache.set(key, md);
  }
  return md;
}

/** Render a markdown document to sanitisation-ready HTML. */
export function renderMarkdown(source: string, options: RenderOptions = {}): RenderResult {
  return { html: getRenderer(options).render(source ?? '') };
}

/** Render a single line of markdown without wrapping `<p>` (titles, inline previews). */
export function renderInlineMarkdown(source: string): string {
  return getRenderer({}).renderInline(source ?? '');
}
