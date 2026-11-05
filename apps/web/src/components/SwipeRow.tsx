import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  LONG_PRESS_MS,
  isLongPress,
  isSwipeBlockedByEdge,
  resolveSwipeAxis,
  resolveSwipeOutcome,
  swipeDragOffset,
  type SwipeAxis,
  type SwipePoint,
} from '../lib/swipeActions.js';
import { mobilePlatform } from '../lib/platform.js';
import { hapticSelect, hapticTap } from '../lib/haptics.js';

/**
 * Touch swipe container for list rows.
 *
 * Trailing (left) swipe reveals the row's actions; dragging past the commit threshold deletes
 * without a second tap and the caller offers an undo. Leading (right) swipe is the pin shortcut.
 * A 500ms press without movement enters multi-select.
 *
 * Listeners are attached natively with `passive: false` because React registers `touchmove`
 * passively at the root, which makes `preventDefault()` a no-op — and without it the list scrolls
 * sideways while the row is being dragged.
 */

export interface SwipeAction {
  key: string;
  label: string;
  icon: ReactNode;
  tone?: 'default' | 'danger';
  testId?: string;
  onClick(): void;
}

export interface SwipeRowProps {
  /** Trailing actions, rendered right-to-left in the order given. */
  actions: SwipeAction[];
  /** False in selection mode: rows must not swipe while the user is picking. */
  enabled?: boolean;
  /** Controlled open state so the list can keep exactly one row revealed. */
  open?: boolean;
  onOpenChange?(open: boolean): void;
  /** Full left swipe past the commit threshold. */
  onCommit?(): void;
  /** Right swipe shortcut (pin/unpin). */
  onLeading?(): void;
  onLongPress?(): void;
  testId?: string;
  className?: string;
  children: ReactNode;
}

const TRANSITION = 'transform 220ms cubic-bezier(0.22, 0.61, 0.36, 1)';

export function SwipeRow({
  actions,
  enabled = true,
  open = false,
  onOpenChange,
  onCommit,
  onLeading,
  onLongPress,
  testId,
  className = '',
  children,
}: SwipeRowProps) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  // Gesture state lives in refs: the native listeners are registered once per mount and must read
  // fresh values without re-subscribing (which would drop an in-flight touch).
  const gesture = useRef<{
    start: SwipePoint | null;
    axis: SwipeAxis;
    blocked: boolean;
    longPressTimer: number | null;
    committing: boolean;
    /** Until this timestamp the browser's synthetic click after a gesture is swallowed. */
    suppressClickUntil: number;
  }>({
    start: null,
    axis: 'undecided',
    blocked: false,
    longPressTimer: null,
    committing: false,
    suppressClickUntil: 0,
  });
  const callbacks = useRef({ enabled, open, onOpenChange, onCommit, onLeading, onLongPress });
  callbacks.current = { enabled, open, onOpenChange, onCommit, onLeading, onLongPress };

  const clearLongPress = () => {
    const timer = gesture.current.longPressTimer;
    if (timer !== null) window.clearTimeout(timer);
    gesture.current.longPressTimer = null;
  };

  const close = () => {
    setOffset(0);
    setDragging(false);
    if (callbacks.current.open) callbacks.current.onOpenChange?.(false);
  };

  // Disabled rows (selection mode) snap shut instead of staying half-open.
  useEffect(() => {
    if (!enabled) {
      clearLongPress();
      setDragging(false);
      setOffset(0);
    }
  }, [enabled]);

  // The parent owns "which row is open" (one at a time, closable by back/tap-elsewhere); follow
  // it so an externally closed row animates shut instead of freezing half-open.
  useEffect(() => {
    setOffset((current) => {
      const target = open ? -actions.length * 74 : 0;
      return current === target ? current : target;
    });
  }, [open, actions.length]);

  // A touch anywhere outside an open row closes it, matching iOS list behaviour.
  useEffect(() => {
    if (!open) return;
    const onDocumentTouch = (event: Event) => {
      const target = event.target as Node | null;
      if (target && rowRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener('touchstart', onDocumentTouch, { capture: true, passive: true });
    document.addEventListener('mousedown', onDocumentTouch, { capture: true });
    return () => {
      document.removeEventListener('touchstart', onDocumentTouch, { capture: true });
      document.removeEventListener('mousedown', onDocumentTouch, { capture: true });
    };
    // `close` is stable enough for this effect: it only reads refs and setState.
  }, [open]);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;

    const onTouchStart = (event: TouchEvent) => {
      const state = gesture.current;
      clearLongPress();
      state.axis = 'undecided';
      state.committing = false;
      if (event.touches.length !== 1 || !callbacks.current.enabled) {
        state.start = null;
        state.blocked = true;
        return;
      }
      const touch = event.touches[0];
      if (!touch) {
        state.start = null;
        state.blocked = true;
        return;
      }
      const start: SwipePoint = { x: touch.clientX, y: touch.clientY, time: event.timeStamp };
      state.start = start;
      // Inside the iOS left-edge band the system back gesture owns this touch.
      state.blocked = isSwipeBlockedByEdge(start.x, mobilePlatform());
      if (onLongPress) {
        state.longPressTimer = window.setTimeout(() => {
          state.longPressTimer = null;
          const current = state.start;
          if (!current) return;
          if (!isLongPress(current, current, LONG_PRESS_MS)) return;
          state.blocked = true;
          state.start = null;
          // A hold that ends without movement still synthesises a click, which would
          // immediately toggle the row the long press just selected.
          state.suppressClickUntil = Date.now() + 450;
          hapticSelect();
          onLongPress();
        }, LONG_PRESS_MS);
      }
    };

    const onTouchMove = (event: TouchEvent) => {
      const state = gesture.current;
      const start = state.start;
      if (!start || state.blocked || event.touches.length !== 1) return;
      const touch = event.touches[0];
      if (!touch) return;
      const current: SwipePoint = { x: touch.clientX, y: touch.clientY, time: event.timeStamp };

      // Any real movement cancels the pending long press: it is either a scroll or a swipe.
      if (state.longPressTimer !== null && !isLongPress(start, current, event.timeStamp - start.time)) {
        clearLongPress();
      }

      if (state.axis === 'undecided') state.axis = resolveSwipeAxis(start, current);
      if (state.axis === 'vertical') {
        setOffset(0);
        setDragging(false);
        return;
      }
      if (state.axis !== 'horizontal') return;
      if (event.cancelable) event.preventDefault();
      setDragging(true);
      setOffset(swipeDragOffset(current.x - start.x));
    };

    const onTouchEnd = (event: TouchEvent) => {
      const state = gesture.current;
      const start = state.start;
      clearLongPress();
      state.start = null;
      if (!start || state.blocked) return;
      const touch = event.changedTouches[0];
      if (!touch) {
        setDragging(false);
        return;
      }
      const end: SwipePoint = { x: touch.clientX, y: touch.clientY, time: event.timeStamp };
      const outcome = resolveSwipeOutcome(start, end);
      setDragging(false);

      if (outcome === 'commit-delete' && !state.committing && onCommit) {
        state.committing = true;
        hapticTap();
        const width = rowRef.current?.clientWidth ?? 360;
        setOffset(-width);
        window.setTimeout(() => {
          state.committing = false;
          setOffset(0);
          onCommit();
        }, 180);
        return;
      }
      if (outcome === 'toggle-pin') {
        hapticTap();
        setOffset(0);
        onLeading?.();
        return;
      }
      const next = outcome === 'reveal' ? -actions.length * 74 : 0;
      setOffset(next);
      if (next !== 0) hapticTap();
      const wasOpen = callbacks.current.open;
      const isOpen = next !== 0;
      if (wasOpen !== isOpen) callbacks.current.onOpenChange?.(isOpen);
    };

    const onTouchCancel = () => {
      const state = gesture.current;
      clearLongPress();
      state.start = null;
      state.axis = 'undecided';
      setDragging(false);
      setOffset(callbacks.current.open ? -actions.length * 74 : 0);
    };

    row.addEventListener('touchstart', onTouchStart, { passive: true });
    row.addEventListener('touchmove', onTouchMove, { passive: false });
    row.addEventListener('touchend', onTouchEnd, { passive: true });
    row.addEventListener('touchcancel', onTouchCancel, { passive: true });
    return () => {
      row.removeEventListener('touchstart', onTouchStart);
      row.removeEventListener('touchmove', onTouchMove);
      row.removeEventListener('touchend', onTouchEnd);
      row.removeEventListener('touchcancel', onTouchCancel);
    };
    // `actions.length` sizes the reveal target; the listeners read everything else from refs.
  }, [actions.length, onCommit, onLeading, onLongPress]);

  const revealed = open || dragging || offset !== 0;
  const actionWidth = actions.length * 74;

  return (
    <div
      ref={rowRef}
      className={`swipe-row ${revealed ? 'is-open' : ''} ${className}`}
      data-testid={testId}
      data-swipe-open={revealed ? 'true' : 'false'}
      onClickCapture={(event) => {
        if (Date.now() < gesture.current.suppressClickUntil) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <div className="swipe-actions" style={{ width: actionWidth }} aria-hidden={!revealed}>
        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            className={`swipe-action ${action.tone === 'danger' ? 'is-danger' : ''}`}
            tabIndex={revealed ? 0 : -1}
            data-testid={action.testId}
            onClick={(event) => {
              event.stopPropagation();
              hapticTap();
              close();
              action.onClick();
            }}
          >
            <span className="swipe-action-icon">{action.icon}</span>
            <span className="swipe-action-label">{action.label}</span>
          </button>
        ))}
      </div>
      <div
        className="swipe-content"
        style={{
          transform: `translate3d(${offset}px, 0, 0)`,
          transition: dragging ? 'none' : TRANSITION,
        }}
      >
        {children}
      </div>
    </div>
  );
}
