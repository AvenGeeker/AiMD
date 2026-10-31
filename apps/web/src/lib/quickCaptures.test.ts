import { describe, expect, it } from 'vitest';
import { parseQuickCaptures } from './quickCaptures.js';

const inbox = (body: string) => `# 收集箱\n\n全局快捷键唤出速记窗口，内容会自动追加到这里。\n\n${body}`;

describe('parseQuickCaptures', () => {
  it('returns no captures for an untouched inbox', () => {
    expect(parseQuickCaptures(inbox(''))).toEqual([]);
  });

  it('splits heading-stamped captures and lists newest first', () => {
    const body = inbox(
      [
        '## 2026-10-30 09:05',
        '',
        '第一条速记',
        '',
        '## 2026-10-31 14:23',
        '',
        '第二条速记',
        '第二行',
      ].join('\n'),
    );

    const captures = parseQuickCaptures(body);

    expect(captures).toHaveLength(2);
    expect(captures[0]).toMatchObject({
      stampLabel: '2026-10-31 14:23',
      body: '第二条速记\n第二行',
    });
    expect(captures[1]).toMatchObject({
      stampLabel: '2026-10-30 09:05',
      body: '第一条速记',
    });
    expect(captures[0]!.line).toBeGreaterThan(captures[1]!.line);
  });

  it('keeps ordinary markdown headings inside a capture', () => {
    const body = inbox(
      [
        '## 2026-10-31 14:23',
        '',
        '### 会议要点',
        '',
        '- [ ] 跟进事项',
        '',
        '## 附录',
      ].join('\n'),
    );

    expect(parseQuickCaptures(body)).toEqual([
      expect.objectContaining({
        stampLabel: '2026-10-31 14:23',
        body: '### 会议要点\n\n- [ ] 跟进事项\n\n## 附录',
      }),
    ]);
  });

  it('supports bullet stamps', () => {
    const body = inbox(['- [09:05]', '', '早上记的', '', '- [18:40]', '', '晚上记的'].join('\n'));
    const captures = parseQuickCaptures(body);

    expect(captures.map((entry) => entry.stampLabel)).toEqual(['18:40', '09:05']);
    expect(captures.map((entry) => entry.body)).toEqual(['晚上记的', '早上记的']);
  });

  it('surfaces stamp-less captures as one entry without the inbox help text', () => {
    const captures = parseQuickCaptures(inbox('没有时间戳的速记'));

    expect(captures).toEqual([
      expect.objectContaining({
        stampLabel: null,
        body: '没有时间戳的速记',
      }),
    ]);
    expect(captures[0]!.body).not.toContain('全局快捷键');
  });

  it('skips empty stamped captures without dropping later ones', () => {
    const body = inbox(
      ['## 2026-10-31 09:00', '', '## 2026-10-31 10:00', '', '有内容的速记'].join('\n'),
    );

    expect(parseQuickCaptures(body)).toEqual([
      expect.objectContaining({ stampLabel: '2026-10-31 10:00', body: '有内容的速记' }),
    ]);
  });
});
