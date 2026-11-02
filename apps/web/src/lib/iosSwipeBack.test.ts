import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AndroidBackState, BackLayerAction } from './androidBack.js';

vi.mock('./platform.js', () => ({ mobilePlatform: () => 'ios' }));

import { isIOSEdgeSwipeBack, useIOSEdgeSwipeBack } from './iosSwipeBack.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EDITOR: AndroidBackState = {
  settingsOpen: false,
  aiOpen: false,
  tagsOpen: false,
  drawerOpen: false,
  view: 'editor',
};

const START = { x: 8, y: 240, time: 1000 };

function touchEvent(
  type: 'touchstart' | 'touchmove' | 'touchend',
  x: number,
  y: number,
  time: number,
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const touch = { clientX: x, clientY: y };
  Object.defineProperty(event, 'touches', {
    value: type === 'touchend' ? [] : [touch],
  });
  Object.defineProperty(event, 'changedTouches', { value: [touch] });
  Object.defineProperty(event, 'timeStamp', { value: time });
  return event;
}

function SwipeHarness({
  state,
  onBack,
}: {
  state: AndroidBackState;
  onBack: (action: BackLayerAction) => void;
}) {
  useIOSEdgeSwipeBack(state, onBack);
  return null;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderHook(state: AndroidBackState, onBack: (action: BackLayerAction) => void): void {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(createElement(SwipeHarness, { state, onBack }));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('iOS left-edge back gesture recognizer', () => {
  it('accepts a deliberate rightward drag from the left edge', () => {
    expect(isIOSEdgeSwipeBack(START, { x: 92, y: 246, time: 1180 })).toBe(true);
  });

  it('accepts a short, fast flick', () => {
    expect(isIOSEdgeSwipeBack(START, { x: 40, y: 242, time: 1040 })).toBe(true);
  });

  it('rejects a gesture that starts away from the edge', () => {
    expect(isIOSEdgeSwipeBack({ ...START, x: 80 }, { x: 240, y: 240, time: 1080 })).toBe(false);
  });

  it('rejects vertical scrolling and leftward movement', () => {
    expect(isIOSEdgeSwipeBack(START, { x: 30, y: 360, time: 1180 })).toBe(false);
    expect(isIOSEdgeSwipeBack(START, { x: -40, y: 240, time: 1080 })).toBe(false);
  });

  it('rejects a long press followed by a drag', () => {
    expect(isIOSEdgeSwipeBack(START, { x: 100, y: 240, time: 2100 })).toBe(false);
  });
});

describe('iOS left-edge back hook', () => {
  it('returns from the editor to the note list', () => {
    const onBack = vi.fn();
    renderHook(EDITOR, onBack);

    act(() => {
      document.dispatchEvent(touchEvent('touchstart', 8, 240, 1000));
      document.dispatchEvent(touchEvent('touchmove', 50, 242, 1050));
      document.dispatchEvent(touchEvent('touchend', 100, 242, 1100));
    });

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledWith('show-list');
  });

  it('closes a full-screen settings layer before touching the editor', () => {
    const onBack = vi.fn();
    renderHook({ ...EDITOR, settingsOpen: true }, onBack);

    act(() => {
      document.dispatchEvent(touchEvent('touchstart', 8, 240, 1000));
      document.dispatchEvent(touchEvent('touchend', 100, 242, 1100));
    });

    expect(onBack).toHaveBeenCalledWith('close-settings');
  });

  it('does nothing at the root note list', () => {
    const onBack = vi.fn();
    renderHook({ ...EDITOR, view: 'list' }, onBack);

    act(() => {
      document.dispatchEvent(touchEvent('touchstart', 8, 240, 1000));
      document.dispatchEvent(touchEvent('touchend', 100, 242, 1100));
    });

    expect(onBack).not.toHaveBeenCalled();
  });

  it('does not treat a vertical swipe as back navigation', () => {
    const onBack = vi.fn();
    renderHook(EDITOR, onBack);

    act(() => {
      document.dispatchEvent(touchEvent('touchstart', 8, 240, 1000));
      document.dispatchEvent(touchEvent('touchmove', 20, 380, 1100));
      document.dispatchEvent(touchEvent('touchend', 20, 380, 1200));
    });

    expect(onBack).not.toHaveBeenCalled();
  });
});
