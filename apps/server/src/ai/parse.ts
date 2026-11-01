import { AI_MAX_KEY_POINTS, AI_MAX_TODOS, ApiError, ERROR_CODES } from '@aimarkdown/shared';
import { normalizeAiTags } from './tags.js';

export interface AiAnalysis {
  summary: string;
  keyPoints: string[];
  todos: string[];
  tags: string[];
}

export interface AiChunkAnalysis {
  keyPoints: string[];
  todos: string[];
  tags: string[];
}

/** Models sometimes wrap JSON in markdown despite being told not to; recover the object text. */
export function extractJsonObject(raw: string): string {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new ApiError(ERROR_CODES.AI_INVALID_RESPONSE, 'AI 未返回可解析的 JSON');
  }
  return text.slice(start, end + 1);
}

function parseObject(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(extractJsonObject(raw));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(ERROR_CODES.AI_INVALID_RESPONSE, 'AI 返回的 JSON 格式不正确');
  }
}

function stringList(value: unknown, limit: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const text = item.trim().replace(/\s+/g, ' ').slice(0, maxLength);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

export function parseAiChunk(raw: string): AiChunkAnalysis {
  const object = parseObject(raw);
  return {
    keyPoints: stringList(object.keyPoints, AI_MAX_KEY_POINTS, 240),
    todos: stringList(object.todos, AI_MAX_TODOS, 300),
    tags: normalizeAiTags(object.tags),
  };
}

export function parseAiAnalysis(raw: string): AiAnalysis {
  const object = parseObject(raw);
  const summary = typeof object.summary === 'string'
    ? object.summary.trim().replace(/\s+/g, ' ').slice(0, 1200)
    : '';
  if (!summary) {
    throw new ApiError(ERROR_CODES.AI_INVALID_RESPONSE, 'AI 返回的摘要为空');
  }
  return {
    summary,
    keyPoints: stringList(object.keyPoints, AI_MAX_KEY_POINTS, 240),
    todos: stringList(object.todos, AI_MAX_TODOS, 300),
    tags: normalizeAiTags(object.tags),
  };
}
