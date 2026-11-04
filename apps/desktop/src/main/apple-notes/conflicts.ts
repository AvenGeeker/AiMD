import { canonicalMarkdown } from './convert.js';
import { sha256Hex } from './hash.js';

/** Normalise markdown enough to recognise the same content after an Apple Notes round-trip. */
export function normalizeForMatch(body: string): string {
  return canonicalMarkdown(body)
    .replace(/\/api\/attachments\/[A-Za-z0-9_-]+/g, '__attachment__')
    .replace(/__AIMD_ATT_[a-f0-9]+__/g, '__attachment__')
    .replace(/__attachment__/g, '__attachment__');
}

export function normalizeTitle(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Conflict copies are titled `<base>（冲突 <timestamp>）`; recover the stable base title. */
export function conflictBaseTitle(title: string): string {
  return title.replace(/（冲突 [^（）]*）$/, '').trim();
}

/**
 * True when a note has no real body: whitespace only, or a body that merely repeats the title.
 * Apple Notes turns such notes into "新备忘录" and then keeps renaming them, so treating them as
 * normal conflicts preserves nothing and creates an endless stream of conflict copies.
 */
export function effectivelyEmptyBody(title: string, body: string): boolean {
  const normalized = normalizeForMatch(body).trim();
  if (normalized.length === 0) return true;
  return normalized === normalizeTitle(title);
}

/**
 * Identity of a preserved conflict version. Folder, base title and canonical body must all
 * match; only then is a second copy redundant.
 */
export function conflictCopyKey(folderId: string | null, title: string, body: string): string {
  return `${folderId ?? ''}\u0000${normalizeTitle(conflictBaseTitle(title))}\u0000${sha256Hex(normalizeForMatch(body))}`;
}
