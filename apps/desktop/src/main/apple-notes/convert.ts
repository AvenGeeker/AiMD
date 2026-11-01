import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

/** Deterministic Markdown normalisation used for change detection and stable hashes. */
export function canonicalMarkdown(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, (suffix) => (suffix.includes('  ') ? '  ' : '')))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '') + '\n';
}

export function firstMeaningfulLine(input: string): string {
  const canonical = canonicalMarkdown(input);
  for (const line of canonical.split('\n')) {
    const cleaned = line
      .replace(/^#{1,6}\s+/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+[.)]\s+/, '')
      .trim();
    if (cleaned.length > 0) return cleaned;
  }
  return '';
}

/**
 * Pull the Apple note's first line out of the converted body.
 *
 * Apple Notes has no separate title field: its name is derived from the first line. The app stores
 * the title in note metadata, so the first line must not be duplicated in the body when it is the
 * title. If the first line does not match the Apple name, it is left untouched.
 */
export function splitAppleTitle(name: string, markdown: string): { title: string; body: string } {
  const canonical = canonicalMarkdown(markdown);
  const lines = canonical.split('\n');
  const title = (name.trim() || firstMeaningfulLine(canonical) || '无标题').slice(0, 200);
  const firstIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstIndex === -1) return { title, body: '' };
  const first = firstMeaningfulLine(lines[firstIndex] ?? '');
  if (first !== title && first.replace(/\s+/g, ' ') !== title.replace(/\s+/g, ' ')) {
    return { title, body: canonical };
  }
  const rest = lines.slice(firstIndex + 1).join('\n');
  return { title, body: canonicalMarkdown(rest) };
}

export interface HtmlAttachmentTarget {
  /** Original src/href from Apple's HTML. */
  source: string;
  /** Replacement URL or text emitted into Markdown. */
  replacement: string;
  /** Markdown image when true, ordinary link otherwise. */
  image: boolean;
}

/**
 * Apple Notes often stores a whole Markdown-ish document as literal text inside one `<div>`.
 * Turndown would escape `#`, `*` and `-` to preserve them as literal characters; in a Markdown
 * notebook that turns the user's source into `\#` / `\*\*` noise. We keep the source syntax and
 * apply a conservative line-break recovery for the common AI-exported shape:
 * `# Title ## Section - **item** ---`.
 */
function normalizeAppleMarkdown(markdown: string): string {
  let out = markdown.replace(/\r\n?/g, '\n');
  // `<b><h1>Title</h1></b>` produces standalone ** markers around the heading.
  out = out.replace(/^\*\*\s*\n+/, '');
  out = out.replace(/\n+\*\*\s*(?=\n|$)/g, '\n\n');
  // Empty <div><br></div> paragraphs become whitespace-only lines; keep one paragraph break.
  out = out.split('\n').map((line) => (line.trim() === '' ? '' : line)).join('\n');
  // Recover structure when heading/list markers were pasted into a single line.
  out = out
    .replace(/ (?=#{2,6}\s)/g, '\n\n')
    .replace(/ (?=---(?:\s|$))/g, '\n\n')
    .replace(/(^|\n)---[ \t]+(?=\S)/g, '$1---\n\n')
    .replace(/ (?=- \*\*)/g, '\n')
    .replace(/ (?=\d+\.\s+\*\*)/g, '\n');
  return canonicalMarkdown(out);
}

/** Convert Apple Notes HTML into Markdown while mapping attachment references to app URLs. */
export function htmlToMarkdown(html: string, attachments: HtmlAttachmentTarget[] = []): string {
  const bySource = new Map(attachments.map((entry) => [entry.source, entry]));
  const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
  });
  // Preserve Markdown source typed/pasted into Apple Notes instead of escaping every marker.
  (turndown as unknown as { escape(value: string): string }).escape = (value: string) => value;
  turndown.use(gfm);
  turndown.addRule('appleImage', {
    filter: 'img',
    replacement: (_content, node) => {
      const el = node as unknown as HTMLImageElement;
      const src = el.getAttribute('src') ?? '';
      const alt = el.getAttribute('alt') ?? '';
      const mapped = bySource.get(src);
      if (mapped) return mapped.image ? `![${alt || mapped.replacement}](${mapped.replacement})` : `[${alt || mapped.replacement}](${mapped.replacement})`;
      if (/^__AIMD_ATT_[a-f0-9]+__$/.test(src)) return `![${alt || 'image'}](${src})`;
      if (/^data:/i.test(src)) return `![${alt || 'image'}](attachment-data-uri)`;
      return src ? `![${alt || 'image'}](${src})` : '';
    },
  });
  turndown.addRule('appleLink', {
    filter: 'a',
    replacement: (content, node) => {
      const el = node as unknown as HTMLAnchorElement;
      const href = el.getAttribute('href') ?? '';
      if (/^__AIMD_ATT_[a-f0-9]+__$/.test(href)) return `[${content || href}](${href})`;
      const mapped = bySource.get(href);
      if (mapped) return mapped.image ? `![${content || 'image'}](${mapped.replacement})` : `[${content || mapped.replacement}](${mapped.replacement})`;
      return href ? `[${content}](${href})` : content;
    },
  });
  return normalizeAppleMarkdown(turndown.turndown(html || ''));
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  xhtmlOut: false,
});
md.enable(['table', 'strikethrough'], true);
md.use(taskLists, { enabled: false, label: false });

/** Render Markdown into an HTML fragment suitable for Apple Notes' `body` property. */
export function markdownToHtml(markdown: string): string {
  return md.render(markdown || '');
}

/**
 * Detect constructs Apple Notes cannot faithfully round-trip.
 *
 * Deliberately avoid a bare `$...$` heuristic: shell scripts use `$VAR` heavily and would be
 * mistaken for inline math, causing an unnecessary conflict copy. Block math and explicit
 * LaTeX delimiters are unambiguous enough.
 */
export function hasLossyMarkdown(markdown: string): boolean {
  return /\$\$[\s\S]*?\$\$|\\\([^)]*\\\)|\\\[[\s\S]*?\\\]|```\s*mermaid\b|\[\[[^\]]+\]\]/.test(markdown);
}

/** Collect app attachment ids referenced by an app note body. */
export function appAttachmentIds(markdown: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const re = /\/api\/attachments\/([A-Za-z0-9_-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) {
    const id = match[1];
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/** Replace attachment URLs in rendered HTML with data URIs (images) or keep links. */
export function inlineImageDataUris(html: string, dataUris: Map<string, string>): string {
  let out = html;
  for (const [id, dataUri] of dataUris) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(src=["'])([^"']*\\/api\\/attachments\\/${escaped}[^"']*)(["'])`, 'gi'), `$1${dataUri}$3`);
  }
  return out;
}
