import { useEffect, useState } from 'react';
import { isMobile } from '../lib/platform.js';

/**
 * True when the UI should use the mobile single-pane shell.
 *
 * A native Capacitor build forces mobile unconditionally; a plain browser tab follows the width
 * media query so the responsive layout can be developed and tested without a device.
 */

const MOBILE_QUERY = '(max-width: 767px)';

export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => {
    if (isMobile()) return true;
    return typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches;
  });

  useEffect(() => {
    if (isMobile()) {
      setMobile(true);
      return;
    }
    const query = window.matchMedia(MOBILE_QUERY);
    const listener = (event: MediaQueryListEvent) => setMobile(event.matches);
    query.addEventListener('change', listener);
    setMobile(query.matches);
    return () => query.removeEventListener('change', listener);
  }, []);

  return mobile;
}
