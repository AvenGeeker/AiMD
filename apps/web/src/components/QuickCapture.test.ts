import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { appendQuickCapture, formatStamp } from './QuickCapture.js';

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


describe('appendQuickCapture', () => {
  const at = new Date(2026, 9, 31, 18, 28, 0);

  it('appends a stamped capture without clearing the existing inbox body', () => {
    const doc = new Y.Doc();
    const body = doc.getText('body');
    body.insert(0, '# 收集箱\n\n已有内容\n');

    appendQuickCapture(body, '新速记', 'heading', at);

    expect(body.toString()).toBe(
      '# 收集箱\n\n已有内容\n\n## 2026-10-31 18:28\n\n新速记',
    );
  });

  it('appends stamp-less captures with exactly one paragraph separator', () => {
    const doc = new Y.Doc();
    const body = doc.getText('body');
    body.insert(0, '已有内容');

    appendQuickCapture(body, '第一条', 'none', at);
    appendQuickCapture(body, '第二条', 'none', at);

    expect(body.toString()).toBe('已有内容\n\n第一条\n\n第二条');
  });

  it('does not append an empty or whitespace-only capture', () => {
    const doc = new Y.Doc();
    const body = doc.getText('body');
    body.insert(0, '已有内容');

    expect(appendQuickCapture(body, '   \n  ', 'heading', at)).toBe('');
    expect(body.toString()).toBe('已有内容');
  });
});
