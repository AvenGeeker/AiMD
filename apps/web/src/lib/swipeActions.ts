/**
 * Row swipe + long-press recognisers.
 *
 * Pure geometry/threshold logic so it can be unit-tested without a touch device, mirroring how
 * `iosSwipeBack.ts` keeps the system back gesture testable. The React glue lives in
 * `hooks/useSwipeRow.ts`.
 *
 * The most important constraint: on iOS a drag that starts inside the left 26px band belongs to
 * the system back gesture (`useIOSEdgeSwipeBack`). Row swipes refuse to start there, otherwise a
 * user swiping back from the editor would also tear open a row's delete button.
 */

export interface SwipePoint {
  x: number;
  y: number;
  /** `TouchEvent.timeStamp`, in milliseconds. */
  time: number;
}

export type SwipeAxis = 'undecided' | 'horizontal' | 'vertical';
export type SwipeOutcome = 'none' | 'reveal' | 'commit-delete' | 'toggle-pin';

/** Must match `EDGE_WIDTH` in `iosSwipeBack.ts`. */
export const SWIPE_EDGE_BAND_IOS = 26;
/** Horizontal movement needed before the gesture claims the touch. */
export const SWIPE_ACTIVATE_DX = 10;
/** `|dx|` must beat `|dy|` by this factor to lock horizontal; otherwise the list keeps scrolling. */
export const SWIPE_DIRECTION_LOCK_RATIO = 1.4;
/** Width of one revealed action button. */
export const SWIPE_ACTION_WIDTH = 74;
/** Fully revealed trailing action area (置顶 + 删除). */
export const SWIPE_REVEAL_WIDTH = SWIPE_ACTION_WIDTH * 2;
/** Dragging this far left commits the delete on release. */
export const SWIPE_COMMIT_DX = 260;
/** A shorter drag still commits when it is fast enough. */
export const SWIPE_FLICK_DX = 160;
/** CSS pixels per millisecond. */
export const SWIPE_FLICK_VELOCITY = 0.9;
/** Right-swipe distance that toggles the pin. */
export const SWIPE_PIN_DX = 72;
/** Hard stop so a very long drag cannot push the row off-screen. */
export const SWIPE_MAX_DRAG = 460;
/** Rubber-band factor past the natural stops. */
export const SWIPE_OVERSCROLL = 0.35;

/** Long-press enters multi-select. */
export const LONG_PRESS_MS = 500;
export const LONG_PRESS_MAX_MOVE = 10;

/** True when the touch began in the iOS system back-gesture band. */
export function isSwipeBlockedByEdge(startX: number, platform: string): boolean {
  return platform === 'ios' && startX >= 0 && startX <= SWIPE_EDGE_BAND_IOS;
}

export function resolveSwipeAxis(start: SwipePoint, current: SwipePoint): SwipeAxis {
  const dx = Math.abs(current.x - start.x);
  const dy = Math.abs(current.y - start.y);
  if (dx < SWIPE_ACTIVATE_DX && dy < SWIPE_ACTIVATE_DX) return 'undecided';
  if (dx > dy * SWIPE_DIRECTION_LOCK_RATIO) return 'horizontal';
  if (dy > dx) return 'vertical';
  return 'undecided';
}

/**
 * Live `translateX` for a drag, with rubber-banding past both natural stops.
 *
 * Negative is the trailing (left) swipe that reveals actions; positive is the leading swipe that
 * pins. Damping keeps the row attached to the finger without ever leaving the viewport.
 */
export function swipeDragOffset(dx: number): number {
  if (dx === 0) return 0;
  if (dx < 0) {
    const travel = Math.min(-dx, SWIPE_REVEAL_WIDTH);
    const over = Math.max(0, -dx - SWIPE_REVEAL_WIDTH) * SWIPE_OVERSCROLL;
    return -Math.min(travel + over, SWIPE_MAX_DRAG);
  }
  const travel = Math.min(dx, SWIPE_PIN_DX);
  const over = Math.max(0, dx - SWIPE_PIN_DX) * SWIPE_OVERSCROLL;
  return Math.min(travel + over, SWIPE_PIN_DX * 2);
}

/** Where a released drag should settle. */
export function resolveSwipeOutcome(start: SwipePoint, end: SwipePoint): SwipeOutcome {
  if (resolveSwipeAxis(start, end) !== 'horizontal') return 'none';
  const dx = end.x - start.x;
  const elapsed = Math.max(end.time - start.time, 1);
  const velocity = dx / elapsed;

  if (dx <= -SWIPE_COMMIT_DX) return 'commit-delete';
  if (dx <= -SWIPE_FLICK_DX && velocity <= -SWIPE_FLICK_VELOCITY) return 'commit-delete';
  if (dx <= -SWIPE_REVEAL_WIDTH / 2) return 'reveal';
  if (dx >= SWIPE_PIN_DX) return 'toggle-pin';
  return 'none';
}

/** Resting offset after the release animation: open, or snapped shut. */
export function resolveSnapOffset(outcome: SwipeOutcome): number {
  return outcome === 'reveal' ? -SWIPE_REVEAL_WIDTH : 0;
}

export function isLongPress(start: SwipePoint, current: SwipePoint, elapsedMs: number): boolean {
  if (elapsedMs < LONG_PRESS_MS) return false;
  const moved = Math.hypot(current.x - start.x, current.y - start.y);
  return moved <= LONG_PRESS_MAX_MOVE;
}
