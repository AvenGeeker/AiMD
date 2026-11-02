import { useEffect, useRef } from 'react';
import { mobilePlatform } from './platform.js';

/** Coarse navigation state needed to decide what a hardware back key should do. */
export interface AndroidBackState {
  settingsOpen: boolean;
  aiOpen: boolean;
  tagsOpen: boolean;
  drawerOpen: boolean;
  view: 'list' | 'editor';
}

export type AndroidBackAction =
  | 'close-settings'
  | 'close-ai'
  | 'close-tags'
  | 'close-drawer'
  | 'show-list'
  | 'exit';

/** Every action except `exit` is applied inside the page; only the shell may terminate. */
export type BackLayerAction = Exclude<AndroidBackAction, 'exit'>;

declare global {
  interface Window {
    /**
     * Installed for the HarmonyOS ArkWeb shell. Its `onBackPress` has no history to pop (the
     * shell loads one SPA document), so it calls this and exits only on `'exit'`.
     */
    __aimdHandleBack?: () => 'handled' | 'exit';
  }
}

/**
 * Back must peel one visible layer at a time. Keep this separate from the reader so the order is
 * explicit and testable: overlays first, then the editor, and only the list is allowed to exit.
 */
export function resolveAndroidBackAction(state: AndroidBackState): AndroidBackAction {
  if (state.settingsOpen) return 'close-settings';
  if (state.aiOpen) return 'close-ai';
  if (state.tagsOpen) return 'close-tags';
  if (state.drawerOpen) return 'close-drawer';
  if (state.view === 'editor') return 'show-list';
  return 'exit';
}

/**
 * Resolve-and-apply in one synchronous step, shared by every shell's back callback.
 *
 * Returning `'exit'` is deliberately the only thing the page cannot do by itself: Android needs
 * Capacitor's `App.exitApp()`, HarmonyOS needs the ability's `terminateSelf()`.
 */
export function createBackRunner(
  getState: () => AndroidBackState,
  apply: (action: BackLayerAction) => void,
): () => 'handled' | 'exit' {
  return () => {
    const action = resolveAndroidBackAction(getState());
    if (action === 'exit') return 'exit';
    apply(action);
    return 'handled';
  };
}

/**
 * Register the mobile shell's hardware back handler once per mount.
 *
 * - Android: Capacitor emits `backButton`; we exit only when nothing is left to close.
 * - HarmonyOS: the ArkWeb host calls `window.__aimdHandleBack()` from `onBackPress()` and
 *   terminates the ability when it answers `'exit'`.
 * - Everything else: leave the browser/desktop behavior untouched.
 *
 * Both paths read from refs so state changes do not re-register the native callback and race an
 * in-flight back press.
 */
export function useMobileBackButton(
  state: AndroidBackState,
  apply: (action: BackLayerAction) => void,
): void {
  const stateRef = useRef(state);
  stateRef.current = state;
  const applyRef = useRef(apply);
  applyRef.current = apply;

  useEffect(() => {
    const platform = mobilePlatform();

    if (platform === 'harmony') {
      const run = createBackRunner(() => stateRef.current, (action) => applyRef.current(action));
      window.__aimdHandleBack = run;
      return () => {
        delete window.__aimdHandleBack;
      };
    }

    if (platform !== 'android') return;

    const run = createBackRunner(() => stateRef.current, (action) => applyRef.current(action));
    let active = true;
    let remove: (() => void) | undefined;

    void import('@capacitor/app')
      .then(async ({ App }) => {
        const listener = await App.addListener('backButton', () => {
          if (run() === 'exit') void exitAndroidApp();
        });
        if (!active) {
          await listener.remove();
          return;
        }
        remove = () => {
          void listener.remove();
        };
      })
      .catch(() => {
        // If the native plug-in is unavailable, leave Android's default behavior untouched.
      });

    return () => {
      active = false;
      remove?.();
    };
  }, []);
}

/** Exit deliberately; Capacitor's back-button callback suppresses its own default exit path. */
export async function exitAndroidApp(): Promise<void> {
  const { App } = await import('@capacitor/app');
  await App.exitApp();
}
