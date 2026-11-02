import { useEffect, useRef } from 'react';
import { mobilePlatform } from './platform.js';

/** Coarse navigation state needed to decide what Android's hardware back key should do. */
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
 * Register Android's hardware back handler once per mounted mobile shell.
 *
 * The listener reads from a ref so state changes do not re-register the native callback and race
 * an in-flight back press. Other platforms keep their normal browser/desktop behavior.
 */
export function useAndroidBackButton(handler: () => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (mobilePlatform() !== 'android') return;

    let active = true;
    let remove: (() => void) | undefined;

    void import('@capacitor/app')
      .then(async ({ App }) => {
        const listener = await App.addListener('backButton', () => handlerRef.current());
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
