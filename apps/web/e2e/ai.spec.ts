import { createServer, type Server } from 'node:http';
import { expect, test } from '@playwright/test';
import { createNote, registerThroughUi, typeInEditor, waitForEditorBound } from './helpers.js';

let fakeAi: Server;
let fakeAiPort = 0;

test.beforeAll(async () => {
  fakeAi = createServer((request, response) => {
    if (!request.url?.includes('/chat/completions')) {
      response.writeHead(404).end();
      return;
    }
    let body = '';
    request.on('data', (chunk) => {
      body += String(chunk);
    });
    request.on('end', () => {
      const payload = {
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: 'AI 摘要：这是一段会议记录。',
                keyPoints: ['确认发布计划', '补齐回归测试'],
                todos: ['补齐回归测试', '通知团队'],
                tags: ['会议', '计划', '发布', '多余标签'],
              }),
            },
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 30 },
      };
      void body;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(payload));
    });
  });
  await new Promise<void>((resolve) => fakeAi.listen(0, '127.0.0.1', resolve));
  const address = fakeAi.address();
  if (!address || typeof address === 'string') throw new Error('fake AI server did not bind');
  fakeAiPort = address.port;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    fakeAi.close((error) => (error ? reject(error) : resolve()));
  });
});

test('AI panel summarizes, tags, syncs todo state and backfills', async ({ page }) => {
  await registerThroughUi(page);
  const config = {
    enabled: true,
    preset: 'custom_openai_compatible',
    baseUrl: `http://127.0.0.1:${fakeAiPort}/v1`,
    model: 'fake-model',
    apiKey: 'sk-e2e-secret',
  };
  const saved = await page.request.put('/api/ai/config', { data: config });
  expect(saved.ok()).toBe(true);

  const noteId = await createNote(page);
  await typeInEditor(page, '# 周会纪要\n\n讨论了发布计划、回归测试和团队通知，正文足够长以触发自动总结。\n');

  await page.getByTestId('open-ai').click();
  await expect(page.getByTestId('ai-summary')).toContainText('AI 摘要', { timeout: 20_000 });
  await expect(page.getByTestId('assigned-tag-会议')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('assigned-tag-计划')).toBeVisible();
  await expect(page.getByTestId('assigned-tag-发布')).toBeVisible();
  await expect(page.getByTestId('assigned-tag-多余标签')).toHaveCount(0);

  const firstTodo = page.locator('[data-testid^="ai-todo-"]').first();
  await expect(firstTodo).not.toBeChecked();
  await firstTodo.check();

  await page.reload();
  await expect(page.getByTestId('workspace')).toBeVisible({ timeout: 20_000 });
  await page.locator(`[data-testid="note-item-${noteId}"]`).click();
  await waitForEditorBound(page, noteId);
  await page.getByTestId('open-ai').click();
  await expect(page.locator('[data-testid^="ai-todo-"]').first()).toBeChecked({ timeout: 20_000 });

  // Create a note while AI is disabled, then enable and run the first-time backfill.
  await page.request.put('/api/ai/config', { data: { ...config, enabled: false, apiKey: undefined } });
  const legacy = await page.request.post('/api/notes', {
    data: {
      title: '待回填笔记',
      body: '这是 AI 关闭期间新增的笔记，需要在回填时生成摘要、待办和标签。',
    },
  });
  expect(legacy.ok()).toBe(true);
  await page.request.put('/api/ai/config', { data: { ...config, apiKey: undefined } });

  await page.getByTestId('open-settings').click();
  await page.getByTestId('settings-tab-ai').click();
  await expect(page.getByTestId('ai-settings')).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByTestId('ai-backfill').click();

  await expect
    .poll(
      async () => {
        const response = await page.request.get('/api/ai/overview');
        const overview = (await response.json()) as {
          counts: { pendingNotes: number };
          lastJob: { kind: string; status: string } | null;
        };
        return `${overview.lastJob?.kind}:${overview.lastJob?.status}:${overview.counts.pendingNotes}`;
      },
      { timeout: 30_000 },
    )
    .toContain('backfill:completed');
});
