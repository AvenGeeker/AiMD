import { z } from 'zod';

/** OpenAI-compatible AI provider contracts shared by the server and every client. */

export const AI_PRESET_ALIBABA = 'alibaba_token_plan';
export const AI_PRESET_CUSTOM = 'custom_openai_compatible';
export const AI_PRESETS = [AI_PRESET_ALIBABA, AI_PRESET_CUSTOM] as const;
export type AiProviderPreset = (typeof AI_PRESETS)[number];

export const ALIBABA_TOKEN_PLAN_BASE_URL =
  'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';
export const AI_DEFAULT_MODEL = 'qwen3.7-plus';

export const AI_MAX_TAGS = 3;
export const AI_MAX_KEY_POINTS = 5;
export const AI_MAX_TODOS = 8;
export const AI_AUTO_MIN_CHARS = 20;

export const AI_STATUSES = ['idle', 'queued', 'running', 'done', 'error'] as const;
export const aiStatusSchema = z.enum(AI_STATUSES);
export type AiStatus = (typeof AI_STATUSES)[number];

export const AI_JOB_KINDS = ['note', 'backfill', 'favorite'] as const;
export const aiJobKindSchema = z.enum(AI_JOB_KINDS);
export type AiJobKind = (typeof AI_JOB_KINDS)[number];

export const AI_JOB_STATUSES = [
  'queued',
  'running',
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled',
] as const;
export const aiJobStatusSchema = z.enum(AI_JOB_STATUSES);
export type AiJobStatus = (typeof AI_JOB_STATUSES)[number];

export const aiTodoDto = z.object({
  id: z.string().min(1).max(64),
  text: z.string().min(1).max(240),
  done: z.boolean(),
  order: z.number().int().nonnegative(),
});
export type AiTodoDto = z.infer<typeof aiTodoDto>;

export const aiResultDto = z.object({
  summary: z.string(),
  keyPoints: z.array(z.string()),
  todos: z.array(aiTodoDto),
  model: z.string(),
});
export type AiResultDto = z.infer<typeof aiResultDto>;

/** Masked provider configuration returned to the browser. The API key never leaves the server. */
export const AI_WEB_SEARCH_MODES = ['none', 'dashscope', 'openai_chat'] as const;
export const aiWebSearchModeSchema = z.enum(AI_WEB_SEARCH_MODES);
export type AiWebSearchMode = (typeof AI_WEB_SEARCH_MODES)[number];

export const aiConfigDto = z.object({
  enabled: z.boolean(),
  preset: z.enum(AI_PRESETS),
  baseUrl: z.string(),
  model: z.string(),
  visionModel: z.string().nullable(),
  transcriptionModel: z.string().nullable(),
  webSearchMode: aiWebSearchModeSchema,
  apiKeyConfigured: z.boolean(),
  apiKeyHint: z.string(),
  lastTest: z
    .object({
      at: z.string(),
      ok: z.boolean(),
      message: z.string().nullable(),
    })
    .nullable(),
});
export type AiConfigDto = z.infer<typeof aiConfigDto>;

export const aiConfigInput = z.object({
  enabled: z.boolean(),
  preset: z.enum(AI_PRESETS),
  baseUrl: z.string().trim().min(1, '接口地址不能为空').max(500).url('接口地址格式不正确'),
  model: z.string().trim().min(1, '模型名不能为空').max(160),
  /** Blank clears the optional media models. */
  visionModel: z.string().trim().max(160).nullable().optional(),
  transcriptionModel: z.string().trim().max(160).nullable().optional(),
  webSearchMode: aiWebSearchModeSchema.default('none'),
  /** Blank/absent keeps the stored key so the settings form never has to resend it. */
  apiKey: z.string().trim().min(1).max(2048).optional(),
});
export type AiConfigInput = z.infer<typeof aiConfigInput>;

export const aiConfigTestInput = z.object({
  preset: z.enum(AI_PRESETS),
  baseUrl: z.string().trim().min(1).max(500).url('接口地址格式不正确'),
  model: z.string().trim().min(1).max(160),
  apiKey: z.string().trim().min(1).max(2048).optional(),
});
export type AiConfigTestInput = z.infer<typeof aiConfigTestInput>;

export const aiConfigTestResultDto = z.object({
  ok: z.boolean(),
  latencyMs: z.number().int().nonnegative(),
  model: z.string(),
  message: z.string().nullable(),
});
export type AiConfigTestResultDto = z.infer<typeof aiConfigTestResultDto>;

export const aiJobDto = z.object({
  id: z.string(),
  kind: aiJobKindSchema,
  status: aiJobStatusSchema,
  total: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  currentNoteId: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export type AiJobDto = z.infer<typeof aiJobDto>;

export const aiOverviewDto = z.object({
  config: aiConfigDto.nullable(),
  counts: z.object({
    untaggedNotes: z.number().int().nonnegative(),
    missingSummaryNotes: z.number().int().nonnegative(),
    pendingNotes: z.number().int().nonnegative(),
  }),
  activeJob: aiJobDto.nullable(),
  lastJob: aiJobDto.nullable(),
});
export type AiOverviewDto = z.infer<typeof aiOverviewDto>;

export const aiJobEnvelopeDto = z.object({ job: aiJobDto });
export type AiJobEnvelopeDto = z.infer<typeof aiJobEnvelopeDto>;
