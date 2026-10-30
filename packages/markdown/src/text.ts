/** Plain-text helpers shared by list previews, search excerpts and word counts. */

const CODE_FENCE = /```[\s\S]*?```/g;
const MATH_BLOCK = /\$\$[\s\S]*?\$\$/g;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;

/**
 * Strip markdown syntax down to readable plain text. Used for list excerpts, word counts
 * and the search index mirror — it must never be used as a security boundary.
 */
export function stripMarkdown(source: string): string {
  return (
    source
      .replace(HTML_COMMENT, ' ')
      .replace(CODE_FENCE, ' ')
      .replace(MATH_BLOCK, ' ')
      // Keep wikilink aliases/labels readable.
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      // Images: drop entirely (alt text is noise in a preview).
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      // Links: keep the label.
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      // Headings, blockquotes, list markers, table pipes.
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s{0,3}>\s?/gm, '')
      .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+[.)]\s+/gm, '')
      .replace(/\|/g, ' ')
      // Emphasis, code spans, strikethrough.
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/(\*|_)(.*?)\1/g, '$2')
      .replace(/~~(.*?)~~/g, '$1')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Word count that behaves sensibly for mixed Chinese/English text: CJK characters count
 * individually, runs of latin/digit characters count as one word.
 */
export function countWords(source: string): number {
  const text = stripMarkdown(source);
  if (!text) return 0;
  const cjk = text.match(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g)?.length ?? 0;
  const words = text
    .replace(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
  return cjk + words;
}

/** First `length` characters of the readable text, for note list rows. */
export function makeExcerpt(source: string, length = 200): string {
  const text = stripMarkdown(source);
  if (text.length <= length) return text;
  return `${text.slice(0, length).trimEnd()}…`;
}

const ATX_HEADING = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;
const MAX_TITLE_LENGTH = 80;

/**
 * Derive a note title from its markdown body.
 *
 * Prefers the first ATX heading, then the first non-empty line, then `fallback`. Used when
 * the user has not set a title explicitly, so the sidebar and search results always show
 * something meaningful. Fenced code blocks are skipped so a leading `#!/bin/bash` is not
 * mistaken for a heading.
 */
export function deriveTitle(source: string, fallback = '无标题'): string {
  const lines = (source ?? '').split('\n');
  let inFence = false;
  let fenceMarker = '';
  let firstText: string | null = null;

  for (const line of lines) {
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = (fence[1] ?? '').slice(0, 3);
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
        fenceMarker = '';
      }
      continue;
    }
    if (inFence) continue;

    const heading = ATX_HEADING.exec(line);
    if (heading) {
      const text = cleanTitleText(heading[1] ?? '');
      if (text) return text;
    }
    if (firstText === null) {
      const trimmed = cleanTitleText(line);
      if (trimmed) firstText = trimmed;
    }
  }

  return firstText ?? fallback;
}

/** Strip markdown noise so a title reads as plain text. */
export function cleanTitleText(raw: string): string {
  const text = stripMarkdown(raw)
    .replace(/^[-*+\s]+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .trim();
  if (text.length <= MAX_TITLE_LENGTH) return text;
  return `${text.slice(0, MAX_TITLE_LENGTH).trimEnd()}…`;
}
