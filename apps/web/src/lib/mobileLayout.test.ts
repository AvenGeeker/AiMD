import { describe, expect, it } from 'vitest';
import {
  MOBILE_EXPANDED_MIN_WIDTH,
  MOBILE_SPLIT_MIN_WIDTH,
  resolveMobileLayout,
} from './mobileLayout.js';

describe('resolveMobileLayout', () => {
  it('keeps a folded phone on the single-pane flow', () => {
    expect(resolveMobileLayout(390)).toBe('compact');
    expect(resolveMobileLayout(MOBILE_SPLIT_MIN_WIDTH - 1)).toBe('compact');
  });

  it('uses list + editor for an unfolded foldable in portrait', () => {
    expect(resolveMobileLayout(MOBILE_SPLIT_MIN_WIDTH)).toBe('split');
    expect(resolveMobileLayout(700)).toBe('split');
    expect(resolveMobileLayout(MOBILE_EXPANDED_MIN_WIDTH - 1)).toBe('split');
  });

  it('uses the three-pane workspace when unfolded landscape or on a tablet', () => {
    expect(resolveMobileLayout(MOBILE_EXPANDED_MIN_WIDTH)).toBe('expanded');
    expect(resolveMobileLayout(1200)).toBe('expanded');
  });

  it('falls back safely for a missing or transient zero width', () => {
    expect(resolveMobileLayout(0)).toBe('compact');
    expect(resolveMobileLayout(Number.NaN)).toBe('compact');
  });
});
