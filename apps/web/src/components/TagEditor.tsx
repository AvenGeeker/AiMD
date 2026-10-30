import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { TagDto } from '@aimarkdown/shared';

/**
 * Tag assignment for the open note.
 *
 * Edits go through `PATCH /api/notes/:id`, which mutates the note's CRDT document server-side and
 * broadcasts it — so tagging from one device updates every other connected device, and an unknown
 * tag name is created on the fly.
 */

export interface TagEditorProps {
  allTags: TagDto[];
  selectedIds: string[];
  onToggle(tagId: string, nextSelected: string[]): void;
  onCreate(name: string): Promise<TagDto | undefined>;
  busy?: boolean;
}

export function TagEditor({ allTags, selectedIds, onToggle, onCreate, busy }: TagEditorProps) {
  const [draft, setDraft] = useState('');
  const [creating, setCreating] = useState(false);

  const selected = allTags.filter((tag) => selectedIds.includes(tag.id));
  const suggestions = allTags.filter(
    (tag) => !selectedIds.includes(tag.id) && (!draft || tag.name.toLowerCase().includes(draft.toLowerCase())),
  );

  const commit = async () => {
    const name = draft.trim();
    if (!name) return;
    const existing = allTags.find((tag) => tag.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      onToggle(existing.id, [...selectedIds, existing.id]);
      setDraft('');
      return;
    }
    setCreating(true);
    try {
      const created = await onCreate(name);
      if (created) onToggle(created.id, [...selectedIds, created.id]);
      setDraft('');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="border-t border-border px-3 py-2" data-testid="tag-editor">
      <div className="mb-1.5 text-[11px] uppercase tracking-wide text-muted">标签</div>

      <div className="flex flex-wrap gap-1">
        {selected.length === 0 && <span className="text-xs text-muted/70">未添加标签</span>}
        {selected.map((tag) => (
          <span
            key={tag.id}
            className="flex items-center gap-1 rounded-full border border-border bg-hover px-2 py-0.5 text-[11px]"
            data-testid={`assigned-tag-${tag.name}`}
          >
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: tag.color }} />
            {tag.name}
            <button
              type="button"
              className="text-muted hover:text-danger"
              onClick={() => onToggle(tag.id, selectedIds.filter((id) => id !== tag.id))}
              aria-label={`移除标签 ${tag.name}`}
            >
              <X size={11} />
            </button>
          </span>
        ))}
      </div>

      <div className="mt-2 flex items-center gap-1">
        <input
          value={draft}
          disabled={busy || creating}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void commit();
            }
          }}
          placeholder={suggestions.length > 0 ? '筛选或新建标签…' : '新建标签后回车'}
          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-accent"
          data-testid="tag-input"
        />
        <button
          type="button"
          disabled={busy || creating || draft.trim().length === 0}
          onClick={() => void commit()}
          className="rounded border border-border p-1 text-muted hover:bg-hover disabled:opacity-40"
          aria-label="添加标签"
          data-testid="tag-add"
        >
          <Plus size={13} />
        </button>
      </div>

      {draft.trim().length > 0 && suggestions.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {suggestions.slice(0, 8).map((tag) => (
            <button
              key={tag.id}
              type="button"
              onClick={() => {
                onToggle(tag.id, [...selectedIds, tag.id]);
                setDraft('');
              }}
              className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted hover:bg-hover"
            >
              {tag.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
