import { describe, expect, it } from 'vitest';
import { shareTokenFromPath } from './shareLink.js';

describe('shareTokenFromPath', () => {
  it('extracts a token from a public share path', () => {
    expect(shareTokenFromPath('/s/abcDEF_123-xyz')).toBe('abcDEF_123-xyz');
    expect(shareTokenFromPath('/s/abcDEF_123-xyz/')).toBe('abcDEF_123-xyz');
  });

  it('leaves ordinary application paths alone', () => {
    expect(shareTokenFromPath('/')).toBeNull();
    expect(shareTokenFromPath('/notes/abc')).toBeNull();
    expect(shareTokenFromPath('/settings')).toBeNull();
  });

  it('shows the invalid-link page for an empty or malformed share path', () => {
    expect(shareTokenFromPath('/s')).toBe('');
    expect(shareTokenFromPath('/s/')).toBe('');
    expect(shareTokenFromPath('/s/%E0%A4%A')).toBe('');
  });
});
