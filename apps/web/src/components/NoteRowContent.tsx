import { Pin } from 'lucide-react';
import type { NoteSummaryDto } from '@aimarkdown/shared';
import { plainExcerpt } from '../lib/excerpt.js';
import { formatNoteDate } from '../lib/relativeTime.js';

/**
 * Shared row content for a note list entry.
 *
 * Two variants over one implementation: `desktop` keeps the exact markup the three-pane rail has
 * always rendered (hover actions positioned absolutely over it), `mobile` is the card layout used
 * by the touch surfaces. Both read dates through `formatNoteDate`, so the wording cannot drift.
 */

export interface NoteRowContentProps {
  note: NoteSummaryDto;
  variant?: 'desktop' | 'mobile';
  /** Resolved tag names, shown as chips on the mobile card. */
  tagNames?: string[];
}

export function NoteRowContent({ note, variant = 'desktop', tagNames }: NoteRowContentProps) {
  const date = formatNoteDate(note.contentUpdatedAt);

  // The desktop rail keeps the raw excerpt it has always shown; the touch surfaces preview the
  // cleaned prose so headings and code fences do not leak into the card.
  const excerpt =
    variant === 'desktop' ? note.aiSummary ?? note.excerpt : plainExcerpt(note.aiSummary ?? note.excerpt, note.title);

  if (variant === 'desktop') {
    return (
      <>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              {note.pinned && <Pin size={11} className="shrink-0 fill-current text-accent" />}
              <span className="note-row-title truncate">{note.title}</span>
            </div>
            {excerpt && <div className="note-row-excerpt mt-1 line-clamp-2">{excerpt}</div>}
          </div>
          <span className="note-row-date mt-0.5 shrink-0">{date}</span>
        </div>

        {note.matches && note.matches.length > 0 && (
          <div className="mt-1.5 space-y-0.5">
            {note.matches.slice(0, 2).map((match, index) => (
              <div key={index} className="truncate text-[10.5px] leading-4 text-accent/85">
                {match}
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="mnote-row-body">
      <div className="mnote-row-line">
        {note.pinned && <Pin size={12} className="mnote-row-pin" aria-label="已置顶" />}
        <span className="mnote-row-title">{note.title}</span>
        <span className="mnote-row-date">{date}</span>
      </div>
      {excerpt && <div className="mnote-row-excerpt">{excerpt}</div>}
      {note.matches && note.matches.length > 0 && (
        <div className="mnote-row-matches">
          {note.matches.slice(0, 2).map((match, index) => (
            <div key={index} className="mnote-row-match">
              {match}
            </div>
          ))}
        </div>
      )}
      {tagNames && tagNames.length > 0 && (
        <div className="mnote-row-tags">
          {tagNames.slice(0, 3).map((name) => (
            <span key={name} className="mnote-tag-chip">
              {name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
