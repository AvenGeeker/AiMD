import DOMPurify from 'dompurify';

/**
 * Defence in depth for preview HTML.
 *
 * The pipeline already runs with `html: false`, so user-authored raw HTML is escaped before
 * it ever becomes markup. This second pass guarantees that even a future markdown-it plugin
 * or a mis-escaped attribute cannot inject a script, and it is what makes multi-user note
 * sharing safe.
 *
 * Only imported from the browser entry: DOMPurify needs a `window`, so Node consumers
 * (exports, tests without jsdom) must not load this module.
 */

const KATEX_TAGS = [
  'math', 'semantics', 'mrow', 'mi', 'mo', 'mn', 'ms', 'mtext', 'mspace',
  'msup', 'msub', 'msubsup', 'mfrac', 'msqrt', 'mroot', 'mstyle', 'merror',
  'mpadded', 'mphantom', 'mtable', 'mtr', 'mtd', 'annotation', 'annotation-xml',
];

/**
 * Attributes the pipeline emits that are not in DOMPurify's HTML profile.
 *
 * Note: DOMPurify drops `data-*` attributes whose *value contains a newline*. Anything we
 * need to survive must therefore either be single-line (wikilink targets) or carried in
 * text content instead (mermaid diagram source — see `rules/mermaid.ts`).
 */
const EXTRA_ATTR = [
  'data-wikilink',
  'class', 'style', 'id', 'href', 'title', 'target', 'rel',
  'type', 'checked', 'disabled', 'align', 'colspan', 'rowspan',
  'aria-hidden', 'encoding', 'mathvariant', 'displaystyle',
];

let configured = false;

function ensureConfigured(): void {
  if (configured) return;
  if (typeof DOMPurify.addHook === 'function') {
    // Never allow a `javascript:`/`data:` navigation target to survive.
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      const el = node as Element;
      if (el.tagName === 'A') {
        const href = el.getAttribute('href') ?? '';
        if (/^\s*(javascript|data|vbscript):/i.test(href)) {
          el.setAttribute('href', '#');
        }
      }
    });
  }
  configured = true;
}

export interface SanitizeOptions {
  /** Allow the interactive task-list checkbox markup emitted by `taskListPlugin`. */
  allowTaskCheckboxes?: boolean;
}

/** Sanitise rendered markdown HTML. Throws a clear error when no DOM is available. */
export function sanitizeHtml(html: string, options: SanitizeOptions = {}): string {
  if (typeof DOMPurify.sanitize !== 'function') {
    throw new Error(
      'sanitizeHtml() requires a DOM. Import "@aimarkdown/markdown" (not "/browser") in Node, ' +
        'or run tests with `environment: "jsdom"`.',
    );
  }
  ensureConfigured();

  const allowedTags = [...KATEX_TAGS];
  if (options.allowTaskCheckboxes !== false) allowedTags.push('input');

  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, mathMl: true },
    ADD_TAGS: allowedTags,
    ADD_ATTR: EXTRA_ATTR,
    FORBID_TAGS: ['style', 'form', 'iframe', 'object', 'embed', 'script'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'formaction', 'srcdoc'],
    ALLOW_DATA_ATTR: true,
  }) as unknown as string;
}

/** Render + sanitise in one call. This is what the preview pane should use. */
export function sanitizeRendered(html: string): string {
  return sanitizeHtml(html, { allowTaskCheckboxes: true });
}
