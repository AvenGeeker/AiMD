import { ApiError, ERROR_CODES } from '@aimarkdown/shared';

/**
 * Split a long markdown note into overlapping chunks near paragraph boundaries.
 *
 * The cap is a safety valve: a 2 MB note would otherwise turn one click into hundreds of
 * upstream calls. Callers surface AI_NOTE_TOO_LONG instead of silently dropping content.
 */
export function chunkMarkdown(text: string, maxChars = 16_000, maxChunks = 48): string[] {
  if (text.length === 0) return [];
  if (!Number.isFinite(maxChars) || maxChars < 32) throw new Error('分块长度配置不正确');
  if (!Number.isFinite(maxChunks) || maxChunks < 1) throw new Error('分块数量配置不正确');
  if (text.length <= maxChars) return [text];

  const overlap = Math.min(Math.floor(maxChars / 4), 800);
  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    if (chunks.length >= maxChunks) {
      throw new ApiError(
        ERROR_CODES.AI_NOTE_TOO_LONG,
        `笔记内容过长，超过 ${maxChunks} 个分块的处理上限`,
      );
    }
    const hardEnd = Math.min(text.length, cursor + maxChars);
    let end = hardEnd;
    if (hardEnd < text.length) {
      const searchFrom = cursor + Math.floor(maxChars * 0.55);
      const boundary = text.lastIndexOf('\n\n', hardEnd);
      if (boundary > searchFrom) end = boundary;
    }
    if (end <= cursor) end = hardEnd;
    chunks.push(text.slice(cursor, end));
    if (end >= text.length) {
      cursor = text.length;
      break;
    }
    const next = end - overlap;
    cursor = next > cursor ? next : end;
  }

  if (cursor < text.length) {
    throw new ApiError(
      ERROR_CODES.AI_NOTE_TOO_LONG,
      `笔记内容过长，超过 ${maxChunks} 个分块的处理上限`,
    );
  }
  return chunks;
}
