import { describe, expect, it } from 'vitest';
import { chunkMarkdown } from '../../src/ai/chunk.js';
import { decryptSecret, encryptSecret, maskApiKey } from '../../src/ai/crypto.js';
import { parseAiAnalysis, parseAiChunk } from '../../src/ai/parse.js';
import { normalizeAiTags, tagColorForName } from '../../src/ai/tags.js';
import { mergeTodoEntries } from '../../src/ai/todos.js';
import { assertSafeAiBaseUrl } from '../../src/ai/url.js';

describe('AI chunking', () => {
  it('keeps short notes in one chunk', () => {
    expect(chunkMarkdown('很短的一段笔记', 100, 10)).toEqual(['很短的一段笔记']);
  });

  it('splits long notes near paragraph boundaries and keeps overlap', () => {
    const body = Array.from({ length: 12 }, (_, i) => `第${i}段：${'内容'.repeat(20)}`).join('\n\n');
    const chunks = chunkMarkdown(body, 160, 40);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 200)).toBe(true);
    expect(chunks.join('')).toContain('第0段');
    expect(chunks.join('')).toContain('第11段');
  });

  it('rejects notes that exceed the configured chunk cap', () => {
    expect(() => chunkMarkdown('x'.repeat(1000), 100, 2)).toThrow(/过长/);
  });
});

describe('AI response parsing', () => {
  it('parses a fenced JSON response and normalizes limits', () => {
    const result = parseAiAnalysis(`\`\`\`json
      {
        "summary": "  会议讨论了发布计划  ",
        "keyPoints": ["发布在下周", "发布在下周", "需要回归", "需要准备", "需要通知", "额外要点"],
        "todos": ["补回归用例", "补回归用例", "通知团队", "准备发布说明", "检查监控", "确认回滚", "更新文档", "安排值班", "额外待办"],
        "tags": ["#发布", "发布", "会议纪要", "计划", "多余"]
      }
    \`\`\``);
    expect(result.summary).toBe('会议讨论了发布计划');
    expect(result.keyPoints).toHaveLength(5);
    expect(result.todos).toHaveLength(8);
    expect(result.tags).toEqual(['发布', '会议纪要', '计划']);
  });

  it('rejects a response without a usable summary', () => {
    expect(() => parseAiAnalysis('{"summary":"","keyPoints":[],"todos":[],"tags":[]}')).toThrow(/摘要/);
  });

  it('parses partial chunk output without requiring a summary', () => {
    const partial = parseAiChunk('{"keyPoints":["一"],"todos":["做"],"tags":["项"]}');
    expect(partial.keyPoints).toEqual(['一']);
  });
});

describe('AI tags and todos', () => {
  it('normalizes, de-duplicates and caps tags at three', () => {
    expect(normalizeAiTags(['#发布', ' 发布 ', '会议纪要', '项目', '多余'])).toEqual([
      '发布',
      '会议纪要',
      '项目',
    ]);
  });

  it('chooses a stable color for the same tag name', () => {
    expect(tagColorForName('发布')).toBe(tagColorForName('发布'));
    expect(tagColorForName('发布')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('keeps a todo done state when regenerated text is unchanged', () => {
    const merged = mergeTodoEntries(
      [{ id: 'a', text: '补测试', done: true, order: 0 }],
      ['补测试', '通知团队'],
      '2026-11-01T00:00:00.000Z',
    );
    expect(merged[0]).toMatchObject({ text: '补测试', done: true, order: 0 });
    expect(merged[1]).toMatchObject({ text: '通知团队', done: false, order: 1 });
  });
});

describe('AI credential encryption', () => {
  const secret = 'unit-test-secret-at-least-32-characters-long';

  it('round-trips a key and binds it to one user', () => {
    const encrypted = encryptSecret('sk-test-1234', secret, 'u1');
    expect(encrypted).not.toContain('sk-test-1234');
    expect(decryptSecret(encrypted, secret, 'u1')).toBe('sk-test-1234');
    expect(() => decryptSecret(encrypted, secret, 'u2')).toThrow();
  });

  it('masks a key without exposing the middle', () => {
    expect(maskApiKey('sk-sp-1234567890abc')).toBe('sk-…abc');
  });
});


describe('AI base URL safety', () => {
  it('rejects loopback endpoints unless explicitly allowed', async () => {
    await expect(assertSafeAiBaseUrl('http://127.0.0.1:11434/v1', false)).rejects.toThrow(/HTTPS|内网/);
    await expect(assertSafeAiBaseUrl('http://127.0.0.1:11434/v1', true)).resolves.toBeUndefined();
  });

  it('rejects credentials embedded in the URL', async () => {
    await expect(assertSafeAiBaseUrl('https://user:pass@example.com/v1', true)).rejects.toThrow(/用户名|密码/);
  });
});
