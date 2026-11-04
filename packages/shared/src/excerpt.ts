/**
 * Plain-text excerpt helper shared by the server (list projections) and the clients
 * (favourite cards), so a link capture never previews its raw markdown scaffolding.
 */

const URL_ONLY_LINE = /^https?:\/\/\S+$/i;

/** Strip one line of the markdown tokens that read as noise in a list preview. */
function cleanLine(line: string): string {
  return line
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/(\*|_)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .trim();
}

/**
 * Reduce markdown to a single line of readable text.
 *
 * Dropped outright: HTML comments (the media worker's OCR markers), blockquotes (favourite
 * provenance lines such as `> 来源：…`), bare URL lines, headings (the title already shows) and
 * code fences. Everything else is de-markdowned and collapsed onto one line.
 */
export function cleanMarkdownExcerpt(markdown: string, max = 200): string {
  const withoutComments = markdown.replace(/<!--[\s\S]*?-->/g, ' ');
  const kept: string[] = [];
  let inFence = false;
  for (const raw of withoutComments.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence || line === '' || line.startsWith('>') || line.startsWith('#')) continue;
    if (URL_ONLY_LINE.test(line)) continue;
    const cleaned = cleanLine(line);
    if (cleaned) kept.push(cleaned);
  }
  const text = kept.join(' ').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}
