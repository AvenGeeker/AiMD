import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpenAiCompatibleClient } from '../../src/ai/client.js';

const config = {
  enabled: true,
  preset: 'custom_openai_compatible',
  baseUrl: 'https://example.com/v1',
  model: 'fake',
  apiKey: 'sk-test',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAI-compatible client', () => {
  it('uses map/reduce calls for long notes and returns the final analysis', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as {
        messages: Array<{ content: string }>;
      };
      const user = payload.messages.at(-1)?.content ?? '';
      const content = user.includes('不同分段的分析结果')
        ? JSON.stringify({
            summary: '合并后的摘要',
            keyPoints: ['合并要点'],
            todos: ['合并待办'],
            tags: ['合并'],
          })
        : JSON.stringify({
            keyPoints: ['分段要点'],
            todos: ['分段待办'],
            tags: ['分段'],
          });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createOpenAiCompatibleClient({
      maxChunkChars: 80,
      maxChunks: 20,
      requestIntervalMs: 0,
      timeoutMs: 5_000,
    });
    const result = await client.analyze({
      config,
      note: {
        title: '长笔记',
        existingTags: [],
        body: Array.from({ length: 10 }, (_, i) => `第${i}段：${'内容'.repeat(20)}`).join('\n\n'),
      },
    });
    expect(result.analysis.summary).toBe('合并后的摘要');
    expect(result.callCount).toBeGreaterThan(1);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('falls back when the provider rejects response_format', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      calls++;
      const payload = JSON.parse(String(init?.body)) as { response_format?: unknown };
      if (payload.response_format) {
        return new Response(JSON.stringify({ error: { message: 'response_format is unsupported' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: '降级成功',
                  keyPoints: [],
                  todos: [],
                  tags: [],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = createOpenAiCompatibleClient({ requestIntervalMs: 0, timeoutMs: 5_000 });
    const result = await client.analyze({
      config,
      note: { title: '短笔记', body: '一段足够短的正文', existingTags: [] },
    });
    expect(result.analysis.summary).toBe('降级成功');
    expect(calls).toBe(2);
  });
});
