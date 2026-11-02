import { useEffect, useRef } from 'react';
import {
  resolveAndroidBackAction as resolveBackAction,
  type AndroidBackState as MobileBackState,
  type BackLayerAction,
} from './androidBack.js';
import { mobilePlatform } from './platform.js';

/**
 * iOS edge-swipe navigation.
 *
 * Capacitor's WKWebView is a single SPA document, so there is no native navigation stack to pop.
 * This hook reproduces the system gesture: a horizontal drag that starts at the left edge and
 * moves right peels one mobile layer, using the same ordering as the Android hardware back key.
 */

/** Touches must begin in this left-edge band, in CSS pixels. */
const EDGE_WIDTH = 26;
/** A deliberate drag this long always counts as a back gesture. */
const MIN_DISTANCE = 56;
/** A quick flick can complete with a shorter distance... */
const FLICK_MIN_DISTANCE = 24;
/** ...when it moves at least this fast (CSS px per millisecond). */
const FLICK_MIN_VELOCITY = 0.45;
/** Diagonal movements beyond this are treated as vertical scrolling. */
const MAX_VERTICAL_DRIFT = 48;
/** A drag that takes longer than this is a scroll/selection gesture, not a back swipe. */
const MAX_DURATION_MS = 900;
/** Once the finger has clearly moved right, stop the WebView from selecting/scroll panning. */
const HORIZONTAL_INTENT = 10;

export interface TouchPoint {
  x: number;
  y: number;
  /** `TouchEvent.timeStamp`, in milliseconds. */
  time: number;
}

/** Pure recognizer so the gesture thresholds can be unit-tested without a real touch device. */
export function isIOSEdgeSwipeBack(start: TouchPoint, end: TouchPoint): boolean {
  if (start.x < 0 || start.x > EDGE_WIDTH) return false;

  const dx = end.x - start.x;
  if (dx <= 0) return false;
  if (Math.abs(end.y - start.y) > MAX_VERTICAL_DRIFT) return false;

  const elapsed = Math.max(end.time - start.time, 1);
  if (elapsed > MAX_DURATION_MS) return false;

  return (
    dx >= MIN_DISTANCE ||
    (dx >= FLICK_MIN_DISTANCE && dx / elapsed >= FLICK_MIN_VELOCITY)
  );
}

/**
 * Listen for the iOS left-edge back swipe and apply one layer of navigation.
 *
 * The listener is intentionally installed on `document` in the capture phase: CodeMirror and
 * controls in the note header otherwise consume touch events before they can reach the shell.
 */
export function useIOSEdgeSwipeBack(
  state: MobileBackState,
  apply: (action: BackLayerAction) => void,
): void {
  const stateRef = useRef(state);
  stateRef.current = state;
  const applyRef = useRef(apply);
  applyRef.current = apply;

  useEffect(() => {
    if (mobilePlatform() !== 'ios') return;

    let start: TouchPoint | null = null;

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        start = null;
        return;
      }
      const touch = event.touches[0];
      if (!touch || touch.clientX > EDGE_WIDTH) {
        start = null;
        return;
      }
      start = { x: touch.clientX, y: touch.clientY, time: event.timeStamp };
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!start || event.touches.length !== 1) return;
      const touch = event.touches[0];
      if (!touch) return;

      const dx = touch.clientX - start.x;
      const dy = Math.abs(touch.clientY - start.y);
      if (dx >= HORIZONTAL_INTENT && dx > dy * 1.25 && event.cancelable) {
        event.preventDefault();
      }
    };

    const onTouchEnd = (event: TouchEvent) => {
      const gesture = start;
      start = null;
      if (!gesture || event.changedTouches.length !== 1) return;

      const touch = event.changedTouches[0];
      if (!touch) return;

      const end = { x: touch.clientX, y: touch.clientY, time: event.timeStamp };
      if (!isIOSEdgeSwipeBack(gesture, end)) return;

      const action = resolveBackAction(stateRef.current);
      if (action !== 'exit') applyRef.current(action);
    };

    const onTouchCancel = () => {
      start = null;
    };

    document.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    document.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    document.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });
    document.addEventListener('touchcancel', onTouchCancel, { capture: true, passive: true });

    return () => {
      document.removeEventListener('touchstart', onTouchStart, { capture: true });
      document.removeEventListener('touchmove', onTouchMove, { capture: true });
      document.removeEventListener('touchend', onTouchEnd, { capture: true });
      document.removeEventListener('touchcancel', onTouchCancel, { capture: true });
    };
  }, []);
}
