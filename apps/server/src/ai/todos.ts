import { createHash } from 'node:crypto';
import type { AiTodoEntry } from '@aimarkdown/shared';

function normalizeTodoText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function todoIdFor(text: string): string {
  return `t_${createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12)}`;
}

/**
 * Merge a fresh AI todo list into the previous CRDT list.
 *
 * Text is the semantic identity. Unchanged items keep their id and `done` flag, so regenerating
 * a summary never unchecks work the user already completed.
 */
export function mergeTodoEntries(
  existing: readonly AiTodoEntry[],
  texts: readonly string[],
  _now: string,
): AiTodoEntry[] {
  const byText = new Map(existing.map((todo) => [normalizeTodoText(todo.text), todo]));
  const used = new Set<string>();
  const out: AiTodoEntry[] = [];
  for (const raw of texts) {
    const text = raw.trim().replace(/\s+/g, ' ');
    if (!text) continue;
    const key = normalizeTodoText(text);
    if (used.has(key)) continue;
    used.add(key);
    const previous = byText.get(key);
    out.push({
      id: previous?.id ?? todoIdFor(key),
      text,
      done: previous?.done ?? false,
      order: out.length,
    });
  }
  return out;
}
