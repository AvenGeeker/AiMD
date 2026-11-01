import { describe, expect, it } from 'vitest';
import {
  AI_DEFAULT_MODEL,
  AI_MAX_TAGS,
  AI_PRESET_ALIBABA,
  ALIBABA_TOKEN_PLAN_BASE_URL,
  aiConfigInput,
  aiJobDto,
  aiStatusSchema,
} from '../src/ai.js';

describe('AI contracts', () => {
  it('ships the Alibaba Token Plan preset expected by the settings UI', () => {
    expect(AI_PRESET_ALIBABA).toBe('alibaba_token_plan');
    expect(ALIBABA_TOKEN_PLAN_BASE_URL).toBe(
      'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    );
    expect(AI_DEFAULT_MODEL).toBe('qwen3.7-plus');
    expect(AI_MAX_TAGS).toBe(3);
  });

  it('accepts a config without a replacement API key and keeps the endpoint required', () => {
    const parsed = aiConfigInput.parse({
      enabled: true,
      preset: AI_PRESET_ALIBABA,
      baseUrl: ALIBABA_TOKEN_PLAN_BASE_URL,
      model: AI_DEFAULT_MODEL,
    });
    expect(parsed.apiKey).toBeUndefined();
    expect(() =>
      aiConfigInput.parse({
        enabled: true,
        preset: AI_PRESET_ALIBABA,
        baseUrl: '',
        model: AI_DEFAULT_MODEL,
      }),
    ).toThrow();
  });

  it('validates job progress values from the wire', () => {
    expect(aiStatusSchema.parse('running')).toBe('running');
    expect(() => aiStatusSchema.parse('unknown')).toThrow();
    const job = aiJobDto.parse({
      id: 'job1',
      kind: 'backfill',
      status: 'running',
      total: 4,
      completed: 1,
      succeeded: 1,
      failed: 0,
      currentNoteId: 'n1',
      error: null,
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      finishedAt: null,
    });
    expect(job.total).toBe(4);
  });
});
