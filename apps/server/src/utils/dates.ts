/**
 * Timestamp coercion for values read out of Postgres.
 *
 * postgres.js returns `timestamptz` as a real `Date`. Round-tripping it through `String()`
 * (which is what `new Date(String(row.x))` does) silently drops sub-second precision — every
 * timestamp would collapse to a whole second, making "recently edited" ordering unstable and
 * making two writes inside the same second indistinguishable. Accept the `Date` directly and
 * only fall back to parsing for the text/numeric shapes other drivers produce.
 */
export function toDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const fromNumber = new Date(value);
    return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/** Like `toDate`, but returns `fallback` instead of null for missing/invalid values. */
export function toDateOr(value: unknown, fallback: Date): Date {
  return toDate(value) ?? fallback;
}

/** ISO string for an API response, or null when the column is empty. */
export function toIso(value: unknown): string | null {
  const date = toDate(value);
  return date ? date.toISOString() : null;
}

/** ISO string for an API response, falling back to `fallback` when the column is empty. */
export function toIsoOr(value: unknown, fallback: Date): string {
  return toDateOr(value, fallback).toISOString();
}
