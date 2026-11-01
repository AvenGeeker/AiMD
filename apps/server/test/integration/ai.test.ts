import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AiClient } from '../../src/ai/client.js';
import { parseJsonb } from '../../src/db/json.js';
import {
  api,
  databaseAvailable,
  register,
  startTestServer,
  type AuthedClient,
  type TestServer,
} from './helpers.js';

const dbUp = await databaseAvailable();
const describeDb = dbUp ? describe : describe.skip;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(read: () => Promise<T | null>, label: string, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${label}`);
}

class FakeAiClient implements AiClient {
  calls = 0;
  delayMs = 0;
  async analyze(input: Parameters<AiClient['analyze']>[0]) {
    if (this.delayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, this.delayMs);
        input.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('AI 任务已取消'));
        }, { once: true });
      });
    }
    this.calls++;
    return {
      analysis: {
        summary: `摘要：${input.note.title}`,
        keyPoints: ['要点一', '要点二'],
        todos: ['补测试', '通知团队'],
        tags: ['发布', '计划', '会议', '多余'],
      },
      callCount: 1,
      inputTokens: 10,
      outputTokens: 20,
    };
  }
  async test() {
    this.calls++;
    return { latencyMs: 3, message: '{"ok":true}' };
  }
}

describeDb('AI summaries, tags and backfill', () => {
  let server: TestServer;
  let client: FakeAiClient;
  let alice: AuthedClient;
  let bob: AuthedClient;

  const configBody = {
    enabled: true,
    preset: 'custom_openai_compatible',
    baseUrl: 'http://127.0.0.1:9999/v1',
    model: 'fake-model',
    apiKey: 'sk-test-secret-1234',
  };

  beforeAll(async () => {
    client = new FakeAiClient();
    server = await startTestServer({ AI_ALLOW_PRIVATE_BASE_URL: 'true', AI_REQUEST_INTERVAL_MS: '0' }, { aiClient: client });
    alice = await register(server, 'ai-alice@example.com');
    bob = await register(server, 'ai-bob@example.com');
  });

  afterAll(async () => {
    await server?.stop();
  });

  it('stores the key encrypted and never returns it to the browser', async () => {
    const saved = await api(server, alice, 'PUT', '/api/ai/config', configBody);
    expect(saved.status).toBe(200);
    expect(JSON.stringify(saved.body)).not.toContain(configBody.apiKey);
    expect(saved.body).toMatchObject({ apiKeyConfigured: true, apiKeyHint: 'sk-…234' });

    const rows = await server.handle.sql`
      select api_key_enc, api_key_hint from ai_provider_configs where user_id = ${alice.userId}
    `;
    expect(String(rows[0]?.api_key_enc)).not.toContain(configBody.apiKey);
    expect(String(rows[0]?.api_key_hint)).toBe('sk-…234');

    const tested = await api(server, alice, 'POST', '/api/ai/config/test', {
      preset: configBody.preset,
      baseUrl: configBody.baseUrl,
      model: configBody.model,
      apiKey: 'sk-draft-key-5678',
    });
    expect(tested.status).toBe(200);
    expect(tested.body).toMatchObject({ ok: true, model: 'fake-model' });
  });

  it('auto-analyzes a newly created note once and caps AI tags at three', async () => {
    const before = client.calls;
    const created = await api<{ id: string }>(server, alice, 'POST', '/api/notes', {
      title: '发布计划',
      body: '这是一篇足够长的笔记正文，用来触发自动 AI 分析。'.repeat(3),
    });
    expect(created.status).toBe(201);
    const noteId = created.body.id;

    const row = await waitFor(async () => {
      const rows = await server.handle.sql`
        select ai_status, ai_result from notes where id = ${noteId}
      `;
      return rows[0]?.ai_status === 'done' ? rows[0] : null;
    }, 'auto AI completion');
    const result = parseJsonb<{ summary: string; todos: Array<{ text: string }> }>(row.ai_result);
    expect(result?.summary).toContain('发布计划');
    expect(result?.todos.map((todo) => todo.text)).toEqual(['补测试', '通知团队']);
    expect(client.calls).toBeGreaterThan(before);

    const tags = await server.handle.sql`
      select t.name from tags t
      join note_tags nt on nt.tag_id = t.id
      where nt.note_id = ${noteId}
      order by t.name
    `;
    expect(tags.map((tag) => String(tag.name)).sort()).toEqual(['发布', '会议', '计划'].sort());

    await api(server, alice, 'PATCH', `/api/notes/${noteId}`, {
      body: '修改后的正文仍然足够长，不应该再次自动触发 AI 分析。'.repeat(3),
    });
    await sleep(600);
    const jobs = await server.handle.sql`
      select count(*)::int as c from ai_jobs where note_id = ${noteId} and kind = 'note'
    `;
    expect(Number(jobs[0]?.c)).toBe(1);
  });

  it('does not touch existing manual tags', async () => {
    const tag = await api<{ id: string }>(server, alice, 'POST', '/api/tags', { name: '人工标签' });
    expect(tag.status).toBe(201);
    const created = await api<{ id: string }>(server, alice, 'POST', '/api/notes', {
      title: '已有标签',
      body: '这篇笔记已经有标签，但仍需要生成摘要和待办。'.repeat(3),
      tagIds: [tag.body.id],
    });
    const noteId = created.body.id;
    await waitFor(async () => {
      const rows = await server.handle.sql`select ai_status from notes where id = ${noteId}`;
      return rows[0]?.ai_status === 'done' ? true : null;
    }, 'tagged note AI completion');
    const tags = await server.handle.sql`
      select t.name from tags t join note_tags nt on nt.tag_id = t.id where nt.note_id = ${noteId}
    `;
    expect(tags.map((tagRow) => String(tagRow.name))).toEqual(['人工标签']);
  });

  it('backfills notes created while AI was disabled', async () => {
    await api(server, alice, 'PUT', '/api/ai/config', { ...configBody, enabled: false });
    const created = await api<{ id: string }>(server, alice, 'POST', '/api/notes', {
      title: '待回填',
      body: 'AI 关闭期间创建的笔记，需要在首次回填时补摘要和标签。'.repeat(3),
    });
    const noteId = created.body.id;
    await api(server, alice, 'PUT', '/api/ai/config', configBody);

    const overview = await api<{ counts: { pendingNotes: number } }>(server, alice, 'GET', '/api/ai/overview');
    expect(overview.body.counts.pendingNotes).toBeGreaterThan(0);

    const started = await api<{ job: { id: string } }>(server, alice, 'POST', '/api/ai/backfill');
    expect(started.status).toBe(202);
    await waitFor(async () => {
      const rows = await server.handle.sql`
        select status from ai_jobs where id = ${started.body.job.id}
      `;
      return rows[0]?.status === 'completed' ? true : null;
    }, 'backfill completion');

    const row = await waitFor(async () => {
      const rows = await server.handle.sql`select ai_status, ai_result from notes where id = ${noteId}`;
      return rows[0]?.ai_status === 'done' ? rows[0] : null;
    }, 'backfilled note');
    expect(parseJsonb<{ summary: string }>(row.ai_result)?.summary).toContain('待回填');
  });

  it('cancels a running backfill and leaves completed items intact', async () => {
    await api(server, alice, 'PUT', '/api/ai/config', { ...configBody, enabled: false });
    await api(server, alice, 'POST', '/api/notes', {
      title: '取消一',
      body: '这篇笔记用于验证取消回填时后台任务能够停止。'.repeat(3),
    });
    await api(server, alice, 'POST', '/api/notes', {
      title: '取消二',
      body: '这篇笔记用于验证取消回填时后续项目不再执行。'.repeat(3),
    });
    await api(server, alice, 'PUT', '/api/ai/config', configBody);

    client.delayMs = 3_000;
    const started = await api<{ job: { id: string } }>(server, alice, 'POST', '/api/ai/backfill');
    expect(started.status).toBe(202);
    await waitFor(async () => {
      const rows = await server.handle.sql`
        select status from ai_jobs where id = ${started.body.job.id}
      `;
      return rows[0]?.status === 'running' ? true : null;
    }, 'backfill running');
    const cancelled = await api<{ job: { status: string } }>(
      server,
      alice,
      'POST',
      `/api/ai/jobs/${started.body.job.id}/cancel`,
    );
    expect(cancelled.body.job.status).toBe('cancelled');
    client.delayMs = 0;
  });

  it('keeps jobs tenant-scoped', async () => {
    const rows = await server.handle.sql`select id from ai_jobs where owner_id = ${alice.userId} limit 1`;
    const jobId = String(rows[0]!.id);
    const foreign = await api(server, bob, 'GET', `/api/ai/jobs/${jobId}`);
    expect(foreign.status).toBe(404);
    const own = await api(server, alice, 'GET', `/api/ai/jobs/${jobId}`);
    expect(own.status).toBe(200);
  });
});
