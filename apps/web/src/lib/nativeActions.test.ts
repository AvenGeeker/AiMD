import { describe, expect, it, vi } from 'vitest';
import {
  consumeOpenFavoriteRequest,
  installNativeActions,
  requestOpenFavorite,
  subscribeOpenFavorite,
} from './nativeActions.js';

describe('native actions', () => {
  it('queues a widget request until the workspace consumes it once', () => {
    installNativeActions();
    window.__aimdOpenFavorite?.();

    expect(consumeOpenFavoriteRequest()).toBe(true);
    expect(consumeOpenFavoriteRequest()).toBe(false);
  });

  it('notifies a mounted workspace immediately', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeOpenFavorite(listener);

    requestOpenFavorite();

    expect(listener).toHaveBeenCalledOnce();
    expect(consumeOpenFavoriteRequest()).toBe(true);
    unsubscribe();
  });
});
