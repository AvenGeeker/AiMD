/**
 * Heading slugification.
 *
 * Both the rendered HTML anchors and the sidebar outline must produce identical ids, so
 * this is the single implementation used by both. CJK characters are preserved (they are
 * valid in HTML ids and in URL fragments) — only whitespace and markup-hostile characters
 * are stripped.
 */
export function slugify(input: string): string {
  const base = input
    .trim()
    .toLowerCase()
    // Drop characters that would break an attribute or a URL fragment.
    .replace(/[\s]+/g, '-')
    .replace(/[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return base || 'section';
}

/**
 * Stateful de-duplicator: `## Foo` twice becomes `foo` and `foo-1`.
 * Create one instance per rendered document.
 */
export function createSlugger() {
  const seen = new Map<string, number>();
  return (input: string): string => {
    const base = slugify(input);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}
