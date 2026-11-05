import { describe, expect, it } from 'vitest';
import {
  PTR_ARMED_OFFSET,
  PTR_MAX_OFFSET,
  PTR_THRESHOLD,
  isPtrArmed,
  ptrOffsetFromDrag,
  ptrProgress,
  shouldArmPtr,
} from './pullToRefresh.js';

describe('pull to refresh geometry', () => {
  it('resists the drag and stops growing', () => {
    expect(ptrOffsetFromDrag(0)).toBe(0);
    expect(ptrOffsetFromDrag(-40)).toBe(0);
    expect(ptrOffsetFromDrag(20)).toBe(10);
    expect(ptrOffsetFromDrag(PTR_THRESHOLD)).toBe(PTR_ARMED_OFFSET);
    expect(ptrOffsetFromDrag(10_000)).toBe(PTR_MAX_OFFSET);
  });

  it('is armed exactly at the threshold drag distance', () => {
    expect(isPtrArmed(ptrOffsetFromDrag(PTR_THRESHOLD - 1))).toBe(false);
    expect(isPtrArmed(ptrOffsetFromDrag(PTR_THRESHOLD))).toBe(true);
    expect(ptrProgress(ptrOffsetFromDrag(PTR_THRESHOLD))).toBe(1);
    expect(ptrProgress(ptrOffsetFromDrag(PTR_THRESHOLD / 2))).toBeCloseTo(0.5, 5);
  });

  it('only arms at the top of the scroller and only when enabled', () => {
    expect(shouldArmPtr({ scrollTop: 0, enabled: true })).toBe(true);
    expect(shouldArmPtr({ scrollTop: 0, enabled: true, dy: 12 })).toBe(true);
    expect(shouldArmPtr({ scrollTop: 0, enabled: true, dy: -12 })).toBe(false);
    expect(shouldArmPtr({ scrollTop: 4, enabled: true })).toBe(false);
    expect(shouldArmPtr({ scrollTop: 0, enabled: false })).toBe(false);
  });
});
