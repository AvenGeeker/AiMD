import { createSlugger } from './slug.js';

export interface OutlineEntry {
  /** Heading text with inline markup removed. */
  text: string;
  level: number;
  /** Matches the `id` attribute emitted by `headingAnchorPlugin`. */
  id: string;
  /** Source line number (0-based), used for editor/preview scroll sync. */
  line: number;
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE_RE = /^\s*(```|~~~)/;

/**
 * Derive the document outline straight from the markdown source.
 *
 * Done with a line scanner rather than a token walk because the sidebar also needs source
 * line numbers for scroll sync. Fenced code blocks are skipped so `# comment` inside code
 * is not mistaken for a heading. Slugs come from the same `createSlugger()` the renderer
 * uses, so anchors line up exactly.
 */
export function extractOutline(source: string): OutlineEntry[] {
  const lines = (source ?? '').split('\n');
  const slug = createSlugger();
  const entries: OutlineEntry[] = [];
  let inFence = false;
  let fenceMarker = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const fenceMatch = FENCE_RE.exec(line);
    if (fenceMatch) {
      const marker = (fenceMatch[1] ?? '```').slice(0, 3);
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

    const match = HEADING_RE.exec(line);
    if (!match) continue;
    const level = (match[1] ?? '').length;
    const rawText = match[2] ?? '';
    const text = rawText.replace(/[*_`~]/g, '').trim();
    if (!text) continue;
    entries.push({ text, level, id: slug(text), line: i });
  }
  return entries;
}
