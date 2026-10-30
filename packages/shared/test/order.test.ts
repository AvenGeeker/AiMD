import { describe, expect, it } from 'vitest';
import {
  compareKeys,
  firstKey,
  keyAfter,
  keyBefore,
  keyBetween,
  keyForIndex,
  keysBetween,
} from '../src/order.js';

describe('fractional ordering', () => {
  it('produces a key for an empty list', () => {
    expect(firstKey()).toBe('a0');
  });

  it('appends strictly increasing keys', () => {
    const keys: string[] = [];
    let last: string | null = null;
    for (let i = 0; i < 20; i++) {
      last = keyAfter(last);
      keys.push(last);
    }
    const sorted = [...keys].sort(compareKeys);
    expect(sorted).toEqual(keys);
    expect(new Set(keys).size).toBe(20);
  });

  it('prepends strictly decreasing keys', () => {
    const keys: string[] = [];
    let first: string | null = null;
    for (let i = 0; i < 20; i++) {
      first = keyBefore(first);
      keys.unshift(first);
    }
    const sorted = [...keys].sort(compareKeys);
    expect(sorted).toEqual(keys);
  });

  it('inserts between two neighbours without touching them', () => {
    const a = 'a0';
    const b = 'a2';
    const mid = keyBetween(a, b);
    expect(compareKeys(a, mid)).toBe(-1);
    expect(compareKeys(mid, b)).toBe(-1);
  });

  it('keeps prepending before an ever-smaller key without running out of room', () => {
    // Open lower bound: `a` stays null, so each iteration must produce a strictly smaller key.
    let b = keyAfter(null);
    for (let i = 0; i < 60; i++) {
      const mid = keyBetween(null, b);
      expect(compareKeys(mid, b), `iteration ${i}: ${mid} should precede ${b}`).toBe(-1);
      b = mid;
    }
  });

  it('keeps inserting between a fixed lower bound and an ever-closer upper bound', () => {
    const lower = 'a0';
    let upper = 'a1';
    for (let i = 0; i < 60; i++) {
      const mid = keyBetween(lower, upper);
      expect(compareKeys(lower, mid), `iteration ${i}`).toBe(-1);
      expect(compareKeys(mid, upper), `iteration ${i}`).toBe(-1);
      upper = mid;
    }
  });

  it('never produces duplicate keys under repeated insertion', () => {
    const keys = new Set<string>();
    let b = keyAfter(null);
    keys.add(b);
    for (let i = 0; i < 200; i++) {
      b = keyBetween(null, b);
      expect(keys.has(b), `duplicate key ${b} at iteration ${i}`).toBe(false);
      keys.add(b);
    }
    expect(keys.size).toBe(201);
  });

  it('generates N ordered keys for a multi-item drop', () => {
    const a = 'a0';
    const b = 'a5';
    const generated = keysBetween(a, b, 3);
    expect(generated).toHaveLength(3);
    expect([...generated].sort(compareKeys)).toEqual(generated);
    expect(compareKeys(a, generated[0]!)).toBe(-1);
    expect(compareKeys(generated[2]!, b)).toBe(-1);
  });

  it('returns an empty array for a non-positive count', () => {
    expect(keysBetween('a0', 'a5', 0)).toEqual([]);
    expect(keysBetween('a0', 'a5', -2)).toEqual([]);
  });
});

describe('keyForIndex', () => {
  const base = ['a0', 'a1', 'a2', 'a3'];

  it('places at the front', () => {
    const key = keyForIndex(base, 0);
    expect(compareKeys(key, 'a0')).toBe(-1);
  });

  it('places at the end', () => {
    const key = keyForIndex(base, base.length);
    expect(compareKeys('a3', key)).toBe(-1);
  });

  it('places between two existing keys', () => {
    const key = keyForIndex(base, 2);
    expect(compareKeys('a1', key)).toBe(-1);
    expect(compareKeys(key, 'a2')).toBe(-1);
  });

  it('clamps out-of-range indices', () => {
    expect(keyForIndex(base, -5)).toBe(keyForIndex(base, 0));
    expect(keyForIndex(base, 99)).toBe(keyForIndex(base, base.length));
  });

  it('works on an empty list', () => {
    expect(keyForIndex([], 0)).toBe(firstKey());
  });

  it('produces a full stable order after repeated moves', () => {
    let keys = ['a0', 'a1', 'a2'];
    // Move the last item to the front.
    const moved = keys.pop()!;
    const rest = [...keys];
    const newKey = keyForIndex(rest, 0);
    keys = [newKey, ...rest];
    expect([...keys].sort(compareKeys)).toEqual(keys);
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(3);
    expect(moved).toBeTruthy();
  });
});

describe('compareKeys', () => {
  it('is consistent for equal keys', () => {
    expect(compareKeys('a0', 'a0')).toBe(0);
  });

  it('orders lexicographically', () => {
    expect(compareKeys('a0', 'a1')).toBe(-1);
    expect(compareKeys('a1', 'a0')).toBe(1);
    expect(compareKeys('Zz', 'a0')).toBe(-1);
  });
});
