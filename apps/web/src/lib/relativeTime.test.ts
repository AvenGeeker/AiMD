import { describe, expect, it } from 'vitest';
import { formatNoteDate, groupNotesByDay, noteDateGroup } from './relativeTime.js';

/** 2026-03-11 is a Wednesday; every case below is anchored to 14:05 that day. */
const NOW = new Date(2026, 2, 11, 14, 5, 0);
const iso = (year: number, month: number, day: number, hour = 9, minute = 30) =>
  new Date(year, month - 1, day, hour, minute).toISOString();

describe('formatNoteDate', () => {
  it('shows the time for today', () => {
    expect(formatNoteDate(iso(2026, 3, 11, 8, 7), NOW)).toBe('08:07');
    expect(formatNoteDate(iso(2026, 3, 11, 23, 59), NOW)).toBe('23:59');
  });

  it('says 昨天 for yesterday', () => {
    expect(formatNoteDate(iso(2026, 3, 10, 22, 0), NOW)).toBe('昨天');
  });

  it('uses the weekday inside the last seven days', () => {
    // 2026-03-08 is a Sunday, 2026-03-05 a Thursday.
    expect(formatNoteDate(iso(2026, 3, 8), NOW)).toBe('周日');
    expect(formatNoteDate(iso(2026, 3, 5), NOW)).toBe('周四');
  });

  it('falls back to month/day inside the year and to a full date across years', () => {
    expect(formatNoteDate(iso(2026, 1, 2), NOW)).toBe('1月2日');
    expect(formatNoteDate(iso(2025, 12, 31), NOW)).toBe('2025/12/31');
  });

  it('tolerates an unparseable timestamp', () => {
    expect(formatNoteDate('not-a-date', NOW)).toBe('');
    expect(noteDateGroup('not-a-date', NOW)).toBe('earlier');
  });
});

describe('groupNotesByDay', () => {
  const notes = [
    { id: 'pin-old', pinned: true, at: iso(2026, 1, 1) },
    { id: 'today', pinned: false, at: iso(2026, 3, 11, 11, 0) },
    { id: 'yesterday', pinned: false, at: iso(2026, 3, 10) },
    { id: 'older', pinned: false, at: iso(2026, 2, 1) },
  ];

  it('keeps pinned notes in their own leading group', () => {
    const groups = groupNotesByDay(notes, {
      at: (note) => note.at,
      pinned: (note) => note.pinned,
      now: NOW,
    });
    expect(groups.map((group) => group.key)).toEqual(['pinned', 'today', 'yesterday', 'earlier']);
    expect(groups.map((group) => group.label)).toEqual(['置顶', '今天', '昨天', '更早']);
    expect(groups[0]?.items.map((note) => note.id)).toEqual(['pin-old']);
  });

  it('can group purely by day when the sort is not 最近更新', () => {
    const groups = groupNotesByDay(notes, {
      at: (note) => note.at,
      pinned: (note) => note.pinned,
      usePinnedGroup: false,
      now: NOW,
    });
    expect(groups.map((group) => group.key)).toEqual(['today', 'yesterday', 'earlier']);
    expect(groups[2]?.items.map((note) => note.id)).toEqual(['pin-old', 'older']);
  });

  it('preserves the incoming order inside every group and drops empty groups', () => {
    const groups = groupNotesByDay(
      [
        { id: 'b', pinned: false, at: iso(2026, 2, 2) },
        { id: 'a', pinned: false, at: iso(2026, 2, 1) },
      ],
      { at: (note) => note.at, now: NOW },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((note) => note.id)).toEqual(['b', 'a']);
  });

  it('returns no groups for an empty list', () => {
    expect(groupNotesByDay([], { at: () => '', now: NOW })).toEqual([]);
  });
});
