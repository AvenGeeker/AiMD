import { describe, expect, it } from 'vitest';
import { favoriteTitleFromUrl, firstFavoriteUrl } from './favoriteUrl.js';

describe('firstFavoriteUrl', () => {
  it('extracts a plain URL', () => {
    expect(firstFavoriteUrl(' https://example.com/post ')).toBe('https://example.com/post');
  });

  it('extracts the target of a pasted Markdown link', () => {
    const input =
      '[https://www.aivi.fyi/llms/hermes-agent-advanced#%E6%AD%A5%E9%AA%A4-2%E4%B8%BB%E6%A8%A1%E5%9E%8B%E9%85%8D%E7%BD%AE](https://www.aivi.fyi/llms/hermes-agent-advanced#%E6%AD%A5%E9%AA%A4-2%E4%B8%BB%E6%A8%A1%E5%9E%8B%E9%85%8D%E7%BD%AE)';
    expect(firstFavoriteUrl(input)).toBe(
      'https://www.aivi.fyi/llms/hermes-agent-advanced#%E6%AD%A5%E9%AA%A4-2%E4%B8%BB%E6%A8%A1%E5%9E%8B%E9%85%8D%E7%BD%AE',
    );
  });

  it('trims trailing punctuation from chat-app copies', () => {
    expect(firstFavoriteUrl('看这个 https://example.com/post）。')).toBe('https://example.com/post');
  });

  it('derives a non-empty title for older servers', () => {
    expect(favoriteTitleFromUrl('https://www.aivi.fyi/llms/hermes-agent-advanced#step')).toBe(
      'hermes agent advanced',
    );
  });
});
