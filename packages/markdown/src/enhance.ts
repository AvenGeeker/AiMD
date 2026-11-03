/**
 * Browser-only post-processing for rendered preview HTML.
 *
 * The core pipeline is synchronous and DOM-free (so it can run in Node for exports and in
 * unit tests). Two things need a real browser: syntax highlighting (shiki) and diagram
 * rendering (mermaid). Both are applied here, lazily, and both are idempotent so the
 * preview can be re-enhanced after every keystroke without duplicated work.
 */

import type { LanguageInput } from 'shiki/core';

type Highlighter = {
  codeToHtml(code: string, options: { lang: string; themes: Record<string, string> }): string;
};

/** Shiki's built-in no-op grammars, used for unknown/plain fences. */
const PLAIN_LANGS = ['text', 'plaintext'] as const;

const SHIKI_LANGS = {
  javascript: () => import('shiki/langs/javascript.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsonc: () => import('shiki/langs/jsonc.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  bash: () => import('shiki/langs/bash.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
  lua: () => import('shiki/langs/lua.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
  graphql: () => import('shiki/langs/graphql.mjs'),
} satisfies Record<string, () => Promise<unknown>>;

/** Languages accepted from a fence. Kept in sync with the grammars loaded above. */
const SUPPORTED_LANGS: readonly string[] = [...Object.keys(SHIKI_LANGS), ...PLAIN_LANGS];

const LANG_ALIASES: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  yml: 'yaml',
  md: 'markdown',
  'c++': 'cpp',
  rs: 'rust',
  '': 'text',
};

let highlighterPromise: Promise<Highlighter | null> | null = null;

function loadHighlighter(): Promise<Highlighter | null> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      try {
        const [{ createHighlighterCore }, { createOnigurumaEngine }] = await Promise.all([
          import('shiki/core'),
          import('shiki/engine/oniguruma'),
        ]);
        return (await createHighlighterCore({
          themes: [
            import('shiki/themes/github-light.mjs'),
            import('shiki/themes/github-dark.mjs'),
          ],
          // The dynamic import types resolve to `unknown` under the package's wildcard export map;
          // Shiki accepts the module namespaces ({ default: LanguageRegistration[] }) at runtime.
          langs: Object.values(SHIKI_LANGS).map((load) => load()) as unknown as LanguageInput[],
          engine: createOnigurumaEngine(import('shiki/wasm')),
        })) as unknown as Highlighter;
      } catch (error) {
        console.warn('[markdown] shiki unavailable, skipping highlight', error);
        return null;
      }
    })();
  }
  return highlighterPromise;
}

function normaliseLang(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower in LANG_ALIASES) return LANG_ALIASES[lower] as string;
  return SUPPORTED_LANGS.includes(lower) ? lower : 'text';
}

/** Replace `<pre><code class="language-x">` bodies with shiki-highlighted HTML. */
export async function highlightCodeBlocks(root: HTMLElement): Promise<void> {
  const blocks = Array.from(
    root.querySelectorAll<HTMLElement>('pre code[class*="language-"]:not([data-shiki-done])'),
  );
  if (blocks.length === 0) return;

  const highlighter = await loadHighlighter();
  if (!highlighter) return;

  for (const code of blocks) {
    const className = Array.from(code.classList).find((c) => c.startsWith('language-')) ?? '';
    const lang = normaliseLang(className.slice('language-'.length));
    const source = code.textContent ?? '';
    code.setAttribute('data-shiki-done', '1');
    try {
      const html = highlighter.codeToHtml(source, {
        lang,
        themes: { light: 'github-light', dark: 'github-dark' },
      });
      const wrapper = document.createElement('div');
      wrapper.innerHTML = html;
      const newPre = wrapper.firstElementChild;
      const parentPre = code.closest('pre');
      if (newPre && parentPre?.parentElement) {
        newPre.setAttribute('class', `${newPre.getAttribute('class') ?? ''} code-block`);
        parentPre.parentElement.replaceChild(newPre, parentPre);
      } else {
        code.innerHTML = wrapper.innerHTML;
      }
    } catch (error) {
      console.warn(`[markdown] highlight failed for "${lang}"`, error);
    }
  }
}

let mermaidReady: Promise<unknown> | null = null;
let mermaidSeq = 0;

/** Turn `data-mermaid` placeholders into SVG. Failures keep the raw source visible. */
export async function renderMermaidBlocks(
  root: HTMLElement,
  theme: 'light' | 'dark' = 'light',
): Promise<void> {
  const blocks = Array.from(
    root.querySelectorAll<HTMLElement>('.mermaid-block:not([data-mermaid-done])'),
  );
  if (blocks.length === 0) return;

  if (!mermaidReady) {
    mermaidReady = import('mermaid').then((mod) => {
      const mermaid = mod.default;
      // Mermaid's own theme enum has no 'light'; 'default' is its light theme.
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: theme === 'dark' ? 'dark' : 'default',
      });
      return mermaid;
    });
  }

  let mermaid: { render(id: string, text: string): Promise<{ svg: string }> };
  try {
    mermaid = (await mermaidReady) as unknown as {
      render(id: string, text: string): Promise<{ svg: string }>;
    };
  } catch (error) {
    console.warn('[markdown] mermaid unavailable', error);
    return;
  }

  for (const block of blocks) {
    // The pipeline stashes the raw diagram source in a `<pre><code>` child so it survives
    // sanitisation (DOMPurify drops multiline data-* attribute values).
    const source = block.querySelector('.mermaid-source')?.textContent ?? block.textContent ?? '';
    block.setAttribute('data-mermaid-done', '1');
    const id = `amd-mermaid-${++mermaidSeq}`;
    try {
      const { svg } = await mermaid.render(id, source);
      block.innerHTML = svg;
      block.classList.add('mermaid-rendered');
    } catch (error) {
      block.classList.add('mermaid-error');
      const pre = document.createElement('pre');
      pre.className = 'mermaid-error-message';
      pre.textContent = `Mermaid 渲染失败：${error instanceof Error ? error.message : String(error)}`;
      block.insertBefore(pre, block.firstChild);
    }
  }
}

export interface EnhanceOptions {
  theme?: 'light' | 'dark';
  /** Skip shiki (e.g. when the caller only wants diagrams refreshed). */
  skipHighlight?: boolean;
  skipMermaid?: boolean;
}

/** Run every browser-only enhancement over a freshly rendered preview root. */
export async function enhancePreview(root: HTMLElement, options: EnhanceOptions = {}): Promise<void> {
  const tasks: Promise<void>[] = [];
  if (!options.skipHighlight) tasks.push(highlightCodeBlocks(root));
  if (!options.skipMermaid) tasks.push(renderMermaidBlocks(root, options.theme ?? 'light'));
  await Promise.all(tasks);
}
