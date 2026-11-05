import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isPtrArmed,
  ptrOffsetFromDrag,
  ptrProgress,
  shouldArmPtr,
} from '../lib/pullToRefresh.js';

/**
 * Pull-to-refresh for a mobile list scroller.
 *
 * Returns a callback ref: the listeners must follow the element, which changes whenever the list
 * switches between the notes, favourites and capture surfaces.
 */

export interface PullToRefreshState {
  /** Callback ref for the scrolling container. */
  ref(node: HTMLDivElement | null): void;
  offset: number;
  progress: number;
  armed: boolean;
  refreshing: boolean;
}

export function usePullToRefresh(options: {
  enabled: boolean;
  onRefresh(): Promise<void> | void;
}): PullToRefreshState {
  const { enabled, onRefresh } = options;
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const drag = useRef<{ startY: number | null; active: boolean }>({ startY: null, active: false });
  const latest = useRef({ enabled, refreshing, onRefresh });
  latest.current = { enabled, refreshing, onRefresh };

  // Read at release time without re-registering the listeners on every drag frame.
  const offsetRef = useRef(offset);
  offsetRef.current = offset;

  const ref = useCallback((next: HTMLDivElement | null) => setNode(next), []);

  useEffect(() => {
    if (!node) return;

    const onTouchStart = (event: TouchEvent) => {
      drag.current = { startY: null, active: false };
      if (event.touches.length !== 1) return;
      if (!shouldArmPtr({ scrollTop: node.scrollTop, enabled: latest.current.enabled })) return;
      const touch = event.touches[0];
      if (touch) drag.current.startY = touch.clientY;
    };

    const onTouchMove = (event: TouchEvent) => {
      const startY = drag.current.startY;
      if (startY === null || event.touches.length !== 1) return;
      if (!shouldArmPtr({ scrollTop: node.scrollTop, enabled: latest.current.enabled })) {
        drag.current.startY = null;
        return;
      }
      const touch = event.touches[0];
      if (!touch) return;
      const dy = touch.clientY - startY;
      if (dy <= 0) {
        if (drag.current.active) setOffset(0);
        drag.current.active = false;
        return;
      }
      drag.current.active = true;
      // Claim the gesture once it is clearly a pull, so WKWebView does not rubber-band as well.
      if (event.cancelable) event.preventDefault();
      setOffset(ptrOffsetFromDrag(dy));
    };

    const onTouchEnd = () => {
      const wasActive = drag.current.active;
      drag.current = { startY: null, active: false };
      if (!wasActive) return;
      const armed = isPtrArmed(offsetRef.current);
      setOffset(0);
      if (!armed || latest.current.refreshing) return;
      setRefreshing(true);
      void Promise.resolve(latest.current.onRefresh()).finally(() => setRefreshing(false));
    };

    node.addEventListener('touchstart', onTouchStart, { passive: true });
    node.addEventListener('touchmove', onTouchMove, { passive: false });
    node.addEventListener('touchend', onTouchEnd, { passive: true });
    node.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchmove', onTouchMove);
      node.removeEventListener('touchend', onTouchEnd);
      node.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [node, enabled]);

  return {
    ref,
    offset,
    progress: ptrProgress(offset),
    armed: isPtrArmed(offset),
    refreshing,
  };
}
