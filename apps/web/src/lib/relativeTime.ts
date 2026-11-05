/**
 * Note list dates and day grouping.
 *
 * Both list surfaces used to carry their own `formatDate`, which disagreed about what "today"
 * looks like. One implementation keeps the phone list, the desktop rail and the favourites grid
 * on the same wording.
 */

export type NoteDateGroup = 'pinned' | 'today' | 'yesterday' | 'earlier';

export const NOTE_GROUP_LABELS: Record<NoteDateGroup, string> = {
  pinned: '置顶',
  today: '今天',
  yesterday: '昨天',
  earlier: '更早',
};

const GROUP_ORDER: NoteDateGroup[] = ['pinned', 'today', 'yesterday', 'earlier'];
const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function toDayStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((toDayStart(to).getTime() - toDayStart(from).getTime()) / 86_400_000);
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Compact, Chinese-first list date: 14:05 → 昨天 → 周三 → 3月8日 → 2025/3/8. */
export function formatNoteDate(value: string | Date, now: Date = new Date()): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const delta = daysBetween(date, now);
  if (delta === 0) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (delta === 1) return '昨天';
  if (delta > 1 && delta < 7) return WEEKDAY_LABELS[date.getDay()] ?? '';
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

/** Which day section a note belongs to. Pinned notes are grouped by the caller, not here. */
export function noteDateGroup(value: string | Date, now: Date = new Date()): Exclude<NoteDateGroup, 'pinned'> {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'earlier';
  const delta = daysBetween(date, now);
  if (delta <= 0) return 'today';
  if (delta === 1) return 'yesterday';
  return 'earlier';
}

export interface NoteGroup<T> {
  key: NoteDateGroup;
  label: string;
  items: T[];
}

/**
 * Split a note list into 置顶 / 今天 / 昨天 / 更早 sections.
 *
 * Input order is preserved inside every group, so a server-sorted list stays sorted. `pinned`
 * only becomes its own section when `usePinnedGroup` is set — the server already sorts pinned
 * notes first, so a manual sort order should not be re-grouped by day.
 */
export function groupNotesByDay<T>(
  items: readonly T[],
  options: {
    at(item: T): string | Date;
    pinned?(item: T): boolean;
    usePinnedGroup?: boolean;
    now?: Date;
  },
): NoteGroup<T>[] {
  const now = options.now ?? new Date();
  const usePinnedGroup = options.usePinnedGroup ?? true;
  const buckets = new Map<NoteDateGroup, T[]>();
  for (const item of items) {
    const pinned = usePinnedGroup && (options.pinned?.(item) ?? false);
    const key: NoteDateGroup = pinned ? 'pinned' : noteDateGroup(options.at(item), now);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }
  return GROUP_ORDER.filter((key) => buckets.has(key)).map((key) => ({
    key,
    label: NOTE_GROUP_LABELS[key],
    items: buckets.get(key) ?? [],
  }));
}
