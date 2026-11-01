import { ApiError, ERROR_CODES } from '@aimarkdown/shared';
import { chunkMarkdown } from './chunk.js';
import { parseAiAnalysis, parseAiChunk, type AiAnalysis } from './parse.js';
import { buildMapPrompt, buildReducePrompt, buildSinglePrompt, type NotePromptInput } from './prompt.js';

export interface AiProviderConfig {
  enabled: boolean;
  preset: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface AiAnalyzeInput {
  config: AiProviderConfig;
  note: NotePromptInput;
  signal?: AbortSignal;
}

export interface AiAnalyzeOutput {
  analysis: AiAnalysis;
  callCount: number;
  inputTokens: number;
  outputTokens: number;
}

export interface AiTestResult {
  latencyMs: number;
  message: string | null;
}

export interface AiClient {
  analyze(input: AiAnalyzeInput): Promise<AiAnalyzeOutput>;
  test(config: AiProviderConfig, signal?: AbortSignal): Promise<AiTestResult>;
}

export interface OpenAiClientOptions {
  timeoutMs?: number;
  maxChunkChars?: number;
  maxChunks?: number;
  requestIntervalMs?: number;
}

interface Usage {
  inputTokens: number;
  outputTokens: number;
}

interface JsonCallResult {
  text: string;
  usage: Usage;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function completionUrl(baseUrl: string): string {
  return new URL('chat/completions', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
}

function abortError(): ApiError {
  return new ApiError(ERROR_CODES.BAD_REQUEST, 'AI 任务已取消');
}

function combineSignals(timeoutMs: number, external?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return external ? AbortSignal.any([external, timeout]) : timeout;
}

/** Extract only the provider's human-readable error message; request/response bodies stay out of logs. */
async function upstreamMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown }; message?: unknown };
    const message = body.error?.message ?? body.message;
    return typeof message === 'string' ? message.slice(0, 500) : '';
  } catch {
    return '';
  }
}

export function createOpenAiCompatibleClient(options: OpenAiClientOptions = {}): AiClient {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const maxChunkChars = options.maxChunkChars ?? 16_000;
  const maxChunks = options.maxChunks ?? 48;
  const requestIntervalMs = options.requestIntervalMs ?? 750;

  async function requestJson(
    config: AiProviderConfig,
    messages: Array<{ role: 'system' | 'user'; content: string }>,
    signal: AbortSignal | undefined,
    jsonMode = true,
  ): Promise<JsonCallResult> {
    const url = completionUrl(config.baseUrl);
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(Math.min(800 * attempt, 2_500));
      const response = await fetch(url, {
        method: 'POST',
        redirect: 'error',
        signal: combineSignals(timeoutMs, signal),
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          temperature: 0.2,
          max_tokens: 1400,
          ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
      }).catch((error: unknown) => {
        if (signal?.aborted) throw abortError();
        lastError = error;
        return null;
      });
      if (!response) continue;

      if (response.status === 400 && jsonMode) {
        const message = await upstreamMessage(response);
        if (/response_format|json_object/i.test(message)) {
          return requestJson(config, messages, signal, false);
        }
        throw new ApiError(ERROR_CODES.AI_UPSTREAM_ERROR, message || 'AI 上游拒绝了请求');
      }
      if (response.status === 429) {
        const message = await upstreamMessage(response);
        lastError = new ApiError(ERROR_CODES.AI_RATE_LIMITED, message || 'AI 上游限流');
        if (attempt < 2) {
          const retryAfter = Number(response.headers.get('retry-after'));
          if (Number.isFinite(retryAfter) && retryAfter > 0) await sleep(Math.min(retryAfter * 1000, 5_000));
          continue;
        }
        throw lastError;
      }
      if (response.status >= 500) {
        const message = await upstreamMessage(response);
        lastError = new ApiError(ERROR_CODES.AI_UPSTREAM_ERROR, message || `AI 上游错误 ${response.status}`);
        if (attempt < 2) continue;
        throw lastError;
      }
      if (!response.ok) {
        const message = await upstreamMessage(response);
        throw new ApiError(ERROR_CODES.AI_UPSTREAM_ERROR, message || `AI 上游错误 ${response.status}`);
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
        usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
      };
      const text = payload.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || text.trim().length === 0) {
        throw new ApiError(ERROR_CODES.AI_INVALID_RESPONSE, 'AI 返回了空内容');
      }
      return {
        text,
        usage: {
          inputTokens: Number(payload.usage?.prompt_tokens ?? 0) || 0,
          outputTokens: Number(payload.usage?.completion_tokens ?? 0) || 0,
        },
      };
    }
    throw lastError instanceof ApiError
      ? lastError
      : new ApiError(ERROR_CODES.AI_UPSTREAM_ERROR, 'AI 上游请求失败');
  }

  return {
    async analyze(input) {
      const chunks = chunkMarkdown(input.note.body, maxChunkChars, maxChunks);
      let callCount = 0;
      let inputTokens = 0;
      let outputTokens = 0;

      const call = async (messages: Array<{ role: 'system' | 'user'; content: string }>) => {
        if (callCount > 0 && requestIntervalMs > 0) await sleep(requestIntervalMs);
        const result = await requestJson(input.config, messages, input.signal);
        callCount++;
        inputTokens += result.usage.inputTokens;
        outputTokens += result.usage.outputTokens;
        return result.text;
      };

      if (chunks.length <= 1) {
        const text = await call(buildSinglePrompt(input.note));
        return {
          analysis: parseAiAnalysis(text),
          callCount,
          inputTokens,
          outputTokens,
        };
      }

      let partials: unknown[] = [];
      for (const [index, chunk] of chunks.entries()) {
        const text = await call(buildMapPrompt(input.note, chunk, index, chunks.length));
        partials.push(parseAiChunk(text));
      }

      while (partials.length > 8) {
        const next: unknown[] = [];
        for (let index = 0; index < partials.length; index += 8) {
          const group = partials.slice(index, index + 8);
          const text = await call(buildReducePrompt(input.note, group, false));
          next.push(parseAiChunk(text));
        }
        partials = next;
      }

      const finalText = await call(buildReducePrompt(input.note, partials, true));
      return {
        analysis: parseAiAnalysis(finalText),
        callCount,
        inputTokens,
        outputTokens,
      };
    },

    async test(config, signal) {
      const started = Date.now();
      const result = await requestJson(
        config,
        [
          { role: 'system', content: '只输出 JSON，不要输出其他文字。' },
          { role: 'user', content: '请返回 {"ok":true}' },
        ],
        signal,
        true,
      );
      return {
        latencyMs: Date.now() - started,
        message: result.text.trim().slice(0, 200),
      };
    },
  };
}
