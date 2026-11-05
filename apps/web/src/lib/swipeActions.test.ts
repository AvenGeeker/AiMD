import { describe, expect, it } from 'vitest';
import {
  LONG_PRESS_MS,
  SWIPE_ACTION_WIDTH,
  SWIPE_COMMIT_DX,
  SWIPE_PIN_DX,
  SWIPE_REVEAL_WIDTH,
  isLongPress,
  isSwipeBlockedByEdge,
  resolveSnapOffset,
  resolveSwipeAxis,
  resolveSwipeOutcome,
  swipeDragOffset,
  type SwipePoint,
} from './swipeActions.js';

const at = (x: number, y: number, time: number): SwipePoint => ({ x, y, time });

describe('swipe recogniser', () => {
  it('locks horizontal only when the drag clearly beats the vertical drift', () => {
    expect(resolveSwipeAxis(at(100, 100, 0), at(104, 100, 16))).toBe('undecided');
    expect(resolveSwipeAxis(at(100, 100, 0), at(140, 104, 120))).toBe('horizontal');
    // A near-diagonal drag stays undecided instead of stealing the scroll.
    expect(resolveSwipeAxis(at(100, 100, 0), at(140, 130, 120))).toBe('undecided');
    expect(resolveSwipeAxis(at(100, 100, 0), at(104, 160, 120))).toBe('vertical');
  });

  it('never starts inside the iOS system back-gesture band', () => {
    expect(isSwipeBlockedByEdge(12, 'ios')).toBe(true);
    expect(isSwipeBlockedByEdge(26, 'ios')).toBe(true);
    expect(isSwipeBlockedByEdge(40, 'ios')).toBe(false);
    // Android and HarmonyOS have no left-edge system gesture.
    expect(isSwipeBlockedByEdge(12, 'android')).toBe(false);
    expect(isSwipeBlockedByEdge(12, 'web')).toBe(false);
  });

  it('reveals the actions on a medium left drag and snaps to the reveal width', () => {
    const outcome = resolveSwipeOutcome(at(300, 200, 0), at(300 - 110, 202, 260));
    expect(outcome).toBe('reveal');
    expect(resolveSnapOffset(outcome)).toBe(-SWIPE_REVEAL_WIDTH);
    expect(SWIPE_REVEAL_WIDTH).toBe(SWIPE_ACTION_WIDTH * 2);
  });

  it('commits the delete on a long drag', () => {
    expect(resolveSwipeOutcome(at(300, 200, 0), at(300 - SWIPE_COMMIT_DX, 200, 600))).toBe(
      'commit-delete',
    );
  });

  it('commits the delete on a fast flick that is shorter than the long drag', () => {
    // 180px in 120ms = 1.5 px/ms, well above the flick velocity.
    expect(resolveSwipeOutcome(at(300, 200, 0), at(120, 200, 120))).toBe('commit-delete');
    // The same distance at walking speed only reveals the actions.
    expect(resolveSwipeOutcome(at(300, 200, 0), at(120, 200, 1400))).toBe('reveal');
  });

  it('toggles the pin on a right swipe and ignores a short one', () => {
    expect(resolveSwipeOutcome(at(40, 200, 0), at(40 + SWIPE_PIN_DX, 200, 220))).toBe('toggle-pin');
    expect(resolveSnapOffset('toggle-pin')).toBe(0);
    expect(resolveSwipeOutcome(at(40, 200, 0), at(80, 200, 220))).toBe('none');
  });

  it('does nothing when the finger mostly scrolled', () => {
    expect(resolveSwipeOutcome(at(200, 100, 0), at(120, 420, 400))).toBe('none');
  });

  it('rubber-bands past the reveal width and past the pin stop', () => {
    expect(swipeDragOffset(0)).toBe(0);
    expect(swipeDragOffset(-SWIPE_REVEAL_WIDTH)).toBe(-SWIPE_REVEAL_WIDTH);
    const overswiped = swipeDragOffset(-600);
    expect(overswiped).toBeLessThan(-SWIPE_REVEAL_WIDTH);
    expect(overswiped).toBeGreaterThan(-600);
    expect(swipeDragOffset(SWIPE_PIN_DX)).toBe(SWIPE_PIN_DX);
    expect(swipeDragOffset(400)).toBeLessThan(400);
    expect(swipeDragOffset(400)).toBeGreaterThan(SWIPE_PIN_DX);
  });
});

describe('long press', () => {
  it('fires after the hold delay when the finger stayed put', () => {
    const start = at(120, 300, 0);
    expect(isLongPress(start, at(124, 303, 520), LONG_PRESS_MS + 20)).toBe(true);
  });

  it('does not fire before the delay or after a real move', () => {
    const start = at(120, 300, 0);
    expect(isLongPress(start, at(121, 300, 300), 300)).toBe(false);
    expect(isLongPress(start, at(120, 380, 600), 600)).toBe(false);
  });
});
