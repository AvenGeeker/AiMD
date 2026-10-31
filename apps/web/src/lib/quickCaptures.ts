import { useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';
import { INBOX_NOTE_TITLE, NOTE_KEYS } from '@aimarkdown/shared';

/**
 * A single quick-capture entry parsed out of the inbox note.
 *
 * Quick captures are deliberately appended to one CRDT `body` rather than stored as separate
 * notes. That keeps concurrent captures safe, but makes the inbox hard to browse once it grows.
 * The capture view reconstructs entries from the stamps the capture window writes.
 */
export interface QuickCaptureEntry {
  /** Stable for the current document revision; used as a React key. */
  id: string;
  /** Zero-based line of the stamp (or first content line for an unstamped capture). */
  line: number;
  /** Human-readable stamp, e.g. `2026-10-31 14:05` or `14:05`. Null for stampFormat=none. */
  stampLabel: string | null;
  /** Capture text without the timestamp header. */
  body: string;
}

const HEADING_STAMP = /^##[ \t]+(\d{4})-(\d{2})-(\d{2})[ \t]+(\d{2}):(\d{2})[ \t]*$/;
const BULLET_STAMP = /^-[ \t]+\[(\d{2}):(\d{2})\][ \t]*$/;

interface Marker {
  line: number;
  stampLabel: string;
}

function findMarkers(lines: string[]): Marker[] {
  const markers: Marker[] = [];
  lines.forEach((line, index) => {
    const heading = HEADING_STAMP.exec(line);
    if (heading) {
      const [, year, month, day, hour, minute] = heading;
      markers.push({
        line: index,
        stampLabel: `${year}-${month}-${day} ${hour}:${minute}`,
      });
      return;
    }
    const bullet = BULLET_STAMP.exec(line);
    if (bullet) {
      markers.push({ line: index, stampLabel: `${bullet[1]}:${bullet[2]}` });
    }
  });
  return markers;
}

/** Remove the title/help paragraph the server seeds into a fresh inbox. */
function stripInboxPreamble(lines: string[]): { line: number; text: string } {
  let index = 0;
  const skipBlank = () => {
    while (index < lines.length && lines[index]?.trim() === '') index += 1;
  };

  skipBlank();
  if (lines[index]?.trim() === `# ${INBOX_NOTE_TITLE}`) {
    index += 1;
    skipBlank();
  }
  if (lines[index]?.trim() === '全局快捷键唤出速记窗口，内容会自动追加到这里。') {
    index += 1;
    skipBlank();
  }

  return { line: index, text: lines.slice(index).join('\n').trim() };
}

/**
 * Split an inbox body into captures.
 *
 * Only the exact stamps emitted by `formatStamp` are boundaries. Ordinary headings, task list
 * checkboxes and bullet lists inside a capture therefore stay part of that capture's body.
 *
 * Older captures with `stampFormat: 'none'` have no boundary at all; they are surfaced as one
 * combined entry rather than being hidden.
 */
export function parseQuickCaptures(body: string): QuickCaptureEntry[] {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const markers = findMarkers(lines);

  if (markers.length === 0) {
    const loose = stripInboxPreamble(lines);
    if (loose.text.length === 0) return [];
    return [{ id: `capture-${loose.line}`, line: loose.line, stampLabel: null, body: loose.text }];
  }

  const entries: QuickCaptureEntry[] = [];
  markers.forEach((marker, index) => {
    const next = markers[index + 1]?.line ?? lines.length;
    const text = lines
      .slice(marker.line + 1, next)
      .join('\n')
      .trim();
    if (text.length === 0) return;
    entries.push({
      id: `capture-${marker.line}`,
      line: marker.line,
      stampLabel: marker.stampLabel,
      body: text,
    });
  });

  // The inbox is append-only, so the newest capture is last in the markdown body.
  return entries.reverse();
}

/** Observe the inbox body so the capture list updates on captures made from any device. */
export function useQuickCaptures(doc: Y.Doc | null): QuickCaptureEntry[] {
  const [version, bump] = useState(0);

  useEffect(() => {
    if (!doc) return;
    const body = doc.getText(NOTE_KEYS.body);
    const observer = () => bump((value) => value + 1);
    body.observe(observer);
    // The document may already hold cached content before this effect subscribes.
    bump((value) => value + 1);
    return () => body.unobserve(observer);
  }, [doc]);

  return useMemo(() => {
    if (!doc) return [];
    return parseQuickCaptures(doc.getText(NOTE_KEYS.body).toString());
    // `version` is the observation signal that forces a recompute when the Y.Text changes.
  }, [doc, version]);
}
