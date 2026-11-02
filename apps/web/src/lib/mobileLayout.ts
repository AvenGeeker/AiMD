/**
 * Viewport layout classes for the mobile shell.
 *
 * Foldables change width at runtime without reloading the WebView: a phone can be 390 CSS px
 * folded, ~700 px unfolded in portrait, and >840 px unfolded in landscape. Keep the thresholds
 * in one place so the hook, CSS and tests cannot drift.
 */
export type MobileLayoutMode = 'compact' | 'split' | 'expanded';

export const MOBILE_SPLIT_MIN_WIDTH = 600;
export const MOBILE_EXPANDED_MIN_WIDTH = 840;

/**
 * Resolve the shell presentation from the available CSS width.
 *
 * `compact` is the phone list ⇄ editor flow. `split` keeps the note list and editor side by side.
 * `expanded` adds the persistent navigation sidebar, matching the desktop three-pane workspace.
 */
export function resolveMobileLayout(width: number): MobileLayoutMode {
  if (!Number.isFinite(width) || width < MOBILE_SPLIT_MIN_WIDTH) return 'compact';
  if (width < MOBILE_EXPANDED_MIN_WIDTH) return 'split';
  return 'expanded';
}
