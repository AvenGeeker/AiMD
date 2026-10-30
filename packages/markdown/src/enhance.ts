/**
 * Browser-only post-processing for rendered preview HTML.
 *
 * The core pipeline is synchronous and DOM-free (so it can run in Node for exports and in
 * unit tests). Two things need a real browser: syntax highlighting (shiki) and diagram
 * rendering (mermaid). Both are applied here, lazily, and both are idempotent so the
 * preview can be re-enhanced after every keystroke without duplicated work.
 */

type Highlighter = {
  codeToHtml(code: string, options: { lang: string; themes: Record<string, string> }): string;
};

const SUPPORTED_LANGS = [
  'javascript', 'typescript', 'tsx', 'jsx', 'json', 'jsonc', 'python', 'bash', 'shell',
  'css', 'scss', 'html', 'xml', 'yaml', 'toml', 'sql', 'rust', 'go', 'java', 'c', 'cpp',
  'csharp', 'php', 'ruby', 'swift', 'kotlin', 'diff', 'markdown', 'dockerfile', 'lua',
  'ini', 'graphql', 'text', 'plaintext',
] as const;

const LANG_ALIASES: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  py: 'python',
  sh: 'bash',
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
        const shiki = await import('shiki/bundle/web');
        return (await shiki.createHighlighter({
          themes: ['github-light', 'github-dark'],
          langs: [...SUPPORTED_LANGS],
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
  return SUPPORTED_LANGS.includes(lower as (typeof SUPPORTED_LANGS)[number]) ? lower : 'text';
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
