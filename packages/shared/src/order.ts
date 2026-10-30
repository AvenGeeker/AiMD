import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

/**
 * Fractional-index helpers for drag-and-drop ordering of folders and notes.
 *
 * Using fractional keys means moving one item never rewrites its siblings, which keeps
 * CRDT merges cheap and avoids write amplification in Postgres.
 */

export type { };

/** Key for the very first item in an empty list. */
export function firstKey(): string {
  return generateKeyBetween(null, null);
}

/** Key that sorts after `prev` (append). */
export function keyAfter(prev: string | null | undefined): string {
  return generateKeyBetween(prev ?? null, null);
}

/** Key that sorts before `next` (prepend). */
export function keyBefore(next: string | null | undefined): string {
  return generateKeyBetween(null, next ?? null);
}

/** Key that sorts strictly between `a` and `b`. Either may be null for open ends. */
export function keyBetween(a: string | null | undefined, b: string | null | undefined): string {
  return generateKeyBetween(a ?? null, b ?? null);
}

/**
 * `count` keys that sort strictly between `a` and `b`, used when dropping several
 * selected items into a gap at once.
 */
export function keysBetween(
  a: string | null | undefined,
  b: string | null | undefined,
  count: number,
): string[] {
  if (count <= 0) return [];
  return generateNKeysBetween(a ?? null, b ?? null, count);
}

/**
 * Compute the key for moving an item so that it lands at `index` within `orderedKeys`
 * (the item's own current key already removed from that list).
 */
export function keyForIndex(orderedKeys: string[], index: number): string {
  const clamped = Math.max(0, Math.min(index, orderedKeys.length));
  const before = clamped === 0 ? null : (orderedKeys[clamped - 1] ?? null);
  const after = clamped >= orderedKeys.length ? null : (orderedKeys[clamped] ?? null);
  return generateKeyBetween(before, after);
}

/** Sort ascending by fractional key. Stable for equal keys via the tiebreaker. */
export function compareKeys(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
