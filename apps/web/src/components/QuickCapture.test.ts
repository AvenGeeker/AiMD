import { describe, expect, it } from 'vitest';
import { formatStamp } from './QuickCapture.js';

const at = new Date(2026, 9, 30, 9, 5, 0); // 2026-10-30 09:05 local

describe('formatStamp', () => {
  it('renders a heading stamp with zero-padded parts', () => {
    expect(formatStamp('heading', at)).toBe('## 2026-10-30 09:05');
  });

  it('renders a bullet stamp', () => {
    expect(formatStamp('bullet', at)).toBe('- [09:05]');
  });

  it('renders nothing for the none format', () => {
    expect(formatStamp('none', at)).toBe('');
  });

  it('matches the server implementation exactly', async () => {
    // The desktop capture window can be offline, so it formats locally; the server formats the
    // same way for web captures. The two must not drift or an inbox note gets inconsistent headings.
    const { formatStamp: serverFormat } = await import('../../../server/src/services/notes.js');
    for (const format of ['heading', 'bullet', 'none'] as const) {
      expect(formatStamp(format, at)).toBe(serverFormat(format, at));
    }
  });
});
