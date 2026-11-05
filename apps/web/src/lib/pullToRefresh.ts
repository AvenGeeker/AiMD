/**
 * Pull-to-refresh geometry.
 *
 * WKWebView already rubber-bands and Android WebView has no native refresh, so the shell owns
 * the gesture: it only arms at `scrollTop === 0`, resists as it is dragged, and fires once past
 * the threshold. Pure functions here; listener wiring lives in `hooks/usePullToRefresh.ts`.
 */

/** Raw finger travel that arms a refresh. */
export const PTR_THRESHOLD = 56;
/** Resistance applied to the raw travel before it becomes visual offset. */
export const PTR_RESISTANCE = 0.5;
/** Visual offset at which the gesture fires. */
export const PTR_ARMED_OFFSET = PTR_THRESHOLD * PTR_RESISTANCE;
/** The indicator never grows past this. */
export const PTR_MAX_OFFSET = 64;

/** Raw drag (CSS px, downwards positive) to the damped visual offset. */
export function ptrOffsetFromDrag(dy: number): number {
  if (dy <= 0) return 0;
  return Math.min(dy * PTR_RESISTANCE, PTR_MAX_OFFSET);
}

/** 0..1 progress: drives the spinner rotation and the "release to refresh" state. */
export function ptrProgress(offset: number): number {
  if (offset <= 0) return 0;
  return Math.min(offset / PTR_ARMED_OFFSET, 1);
}

export function isPtrArmed(offset: number): boolean {
  return offset >= PTR_ARMED_OFFSET;
}

/**
 * Whether a touch may start the gesture.
 *
 * Disabled while the list is in multi-select, while a swipe row is open, and anywhere but the
 * very top of the scroller — otherwise a normal scroll-up would keep re-arming the spinner.
 */
export function shouldArmPtr(options: {
  scrollTop: number;
  enabled: boolean;
  dy?: number;
}): boolean {
  if (!options.enabled) return false;
  if (options.scrollTop > 0) return false;
  return options.dy === undefined || options.dy > 0;
}
