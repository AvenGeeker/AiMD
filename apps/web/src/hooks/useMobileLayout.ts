import { useEffect, useState } from 'react';
import { resolveMobileLayout, type MobileLayoutMode } from '../lib/mobileLayout.js';

/** Width of the layout viewport; the visual viewport shrinks with the software keyboard. */
function layoutWidth(): number {
  if (typeof document === 'undefined') return 0;
  return document.documentElement.clientWidth || window.innerWidth;
}

/**
 * Track fold/unfold, rotation and multi-window resizes without remounting the shell.
 *
 * ResizeObserver covers Android/desktop window resizes that do not emit `resize`; the visual
 * viewport listener covers iOS WKWebView rotations. State only changes when the layout class
 * changes, so a continuous fold animation does not re-render every frame.
 */
export function useMobileLayout(): MobileLayoutMode {
  const [mode, setMode] = useState<MobileLayoutMode>(() => resolveMobileLayout(layoutWidth()));

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const next = resolveMobileLayout(layoutWidth());
      setMode((current) => (current === next ? current : next));
    };
    const schedule = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(update);
    };

    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(schedule);
    observer?.observe(document.documentElement);
    update();

    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      observer?.disconnect();
    };
  }, []);

  return mode;
}
