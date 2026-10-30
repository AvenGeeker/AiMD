/**
 * jsonb column helper.
 *
 * postgres.js returns a `jsonb` value as an already-parsed object on the prepared-statement
 * path but as raw JSON **text** on the simple-query path this service uses (`prepare: false`).
 * Reading `.settings` as an object therefore silently yields `undefined`, and callers fall back
 * to defaults without any error. Normalising here makes both shapes behave identically.
 */
export function parseJsonb<T>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value === 'object') return value as T;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}
