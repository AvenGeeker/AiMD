import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AiClient } from '../../src/ai/client.js';
import type { FolderQueryDto, NoteDto, TreeDto } from '@aimarkdown/shared';
import { api, databaseAvailable, register, startTestServer, type AuthedClient, type TestServer } from './helpers.js';

const dbUp = await databaseAvailable();
const describeDb = dbUp ? describe : describe.skip;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

class FakeFolderAi implements AiClient {
  async analyze() {
    return {
      analysis: { summary: '摘要', keyPoints: [], todos: [], tags: [], category: null, suggestedCategory: null, categoryConfidence: 0.5 },
      callCount: 1, inputTokens: 1, outputTokens: 1,
    };
  }
  async test() { return { latencyMs: 1, message: 'ok' }; }
  async pickRelevantNotes(input: Parameters<AiClient['pickRelevantNotes']>[0]) {
    return input.catalog.map((item) => item.id).slice(0, 5);
  }
  async answerFolder(input: Parameters<AiClient['answerFolder']>[0]) {
    return {
      text: input.notes.map((_note, index) => `[${index + 1}]`).join(' ') + ' 综合回答',
      webSources: [],
      inputTokens: 1,
      outputTokens: 1,
    };
  }
  async ocrImage() { return ''; }
  async transcribeAudio() { return ''; }
}

describeDb('folder AI queries', () => {
  let server: TestServer;
  let alice: AuthedClient;
  let bob: AuthedClient;
  let folderId: string;
  let noteId: string;

  beforeAll(async () => {
    server = await startTestServer({ AI_ALLOW_PRIVATE_BASE_URL: 'true' }, { aiClient: new FakeFolderAi() });
    alice = await register(server, 'folder-ai-alice@example.com');
    bob = await register(server, 'folder-ai-bob@example.com');
    const saved = await api(server, alice, 'PUT', '/api/ai/config', {
      enabled: true,
      preset: 'custom_openai_compatible',
      baseUrl: 'http://127.0.0.1:9999/v1',
      model: 'fake',
      apiKey: 'sk-folder-test',
      webSearchMode: 'none',
    });
    expect(saved.status).toBe(200);
    const folder = await api<{ id: string }>(server, alice, 'POST', '/api/folders', { name: '旅行资料' });
    folderId = folder.body.id;
    const note = await api<NoteDto>(server, alice, 'POST', '/api/notes', {
      title: '大理攻略',
      folderId,
      body: '大理适合骑行和看洱海，建议安排三天行程。',
    });
    noteId = note.body.id;
  });

  afterAll(async () => { await server?.stop(); });

  it('answers with citations from the folder and hides others', async () => {
    const created = await api<{ query: FolderQueryDto }>(server, alice, 'POST', `/api/ai/folders/${folderId}/query`, {
      mode: 'qa', question: '怎么安排大理行程？', allowWebSearch: false, history: [],
    });
    expect(created.status).toBe(202);
    let result = created.body.query;
    for (let i = 0; i < 100 && (result.status === 'queued' || result.status === 'running'); i++) {
      await sleep(100);
      const poll = await api<{ query: FolderQueryDto }>(server, alice, 'GET', `/api/ai/queries/${result.id}`);
      result = poll.body.query;
    }
    expect(result.status).toBe('done');
    expect(result.answer).toContain('综合回答');
    expect(result.citations.map((item) => item.id)).toContain(noteId);

    const tree = await api<TreeDto>(server, bob, 'GET', '/api/tree');
    expect(tree.body.settings.favoritesFolderId).toBeTruthy();
    const foreign = await api(server, bob, 'POST', `/api/ai/folders/${folderId}/query`, {
      mode: 'qa', question: '越权查询', allowWebSearch: false, history: [],
    });
    expect(foreign.status).toBe(404);
  });
});
