/**
 * Inline-safe excerpt cleanup for the touch list cards.
 *
 * The server's `excerpt` is already whitespace-collapsed into one line, so the line-based
 * `cleanMarkdownExcerpt()` would throw away everything after a leading `#` or fence. This
 * lighter pass strips the markers in place instead, keeping the preview readable without
 * touching the desktop rail's raw excerpt.
 */

export function plainExcerpt(excerpt: string, title = ''): string {
  const cleaned = excerpt
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```/g, ' ')
    .replace(/(^|\s)#{1,6}\s+/g, '$1')
    .replace(/(^|\s)>\s?/g, '$1')
    .replace(/(^|\s)[-*+]\s+(?=\S)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)([^*_]+)\1/g, '$2')
    .replace(/([*_])([^*_]+)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  // The collapsed excerpt usually repeats the title; the card already shows it as the heading.
  if (title && cleaned.startsWith(title)) return cleaned.slice(title.length).trim();
  return cleaned;
}
