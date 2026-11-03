/**
 * Extract a usable URL from a pasted value.
 *
 * Supports plain URLs and Markdown links such as `[标题](https://example.com/a#b)`. Chat apps
 * often copy a whole Markdown link, so treating every non-space character as part of the URL
 * would produce a validation error even though the user pasted something sensible.
 */
export function firstFavoriteUrl(text: string): string {
  const trimmed = text.trim();
  const markdown = trimmed.match(/\[[^\]]*\]\(\s*(https?:\/\/[^\s)]+)\s*(?:"[^"]*")?\s*\)/i)?.[1];
  if (markdown) return cleanUrl(markdown);
  const bare = trimmed.match(/https?:\/\/[^\s<>"']+/i)?.[0];
  return bare ? cleanUrl(bare) : '';
}

function cleanUrl(value: string): string {
  return value
    .trim()
    .replace(/^</, '')
    .replace(/[)\]}>.,;，。！？、）】」』"'”’]+$/g, '');
}

/** Derive a non-empty title from a URL so older servers that require a title still accept it. */
export function favoriteTitleFromUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const segment = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '')
      .replace(/\.[A-Za-z0-9]{1,8}$/, '')
      .replace(/[-_]+/g, ' ')
      .trim();
    return (segment || url.hostname).slice(0, 120);
  } catch {
    return raw.replace(/^https?:\/\//i, '').slice(0, 120) || '收藏';
  }
}
