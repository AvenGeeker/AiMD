import { AI_MAX_TAGS } from '@aimarkdown/shared';

const TAG_COLORS = ['#2563eb', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed', '#db2777', '#4b5563'];

/** Normalize model-proposed tag names: trim, drop #, de-duplicate case-insensitively, cap at 3. */
export function normalizeAiTags(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const name = value
      .replace(/^#+/, '')
      .replace(/[\s,，、;；]+/g, ' ')
      .trim()
      .slice(0, 20);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= AI_MAX_TAGS) break;
  }
  return out;
}

export function tagColorForName(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return TAG_COLORS[hash % TAG_COLORS.length]!;
}
