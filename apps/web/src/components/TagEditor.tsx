import { useState } from 'react';
import { Plus, Tags, X } from 'lucide-react';
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
    <div className="border-t border-border-subtle px-3 py-3" data-testid="tag-editor">
      <div className="mb-2 flex items-center justify-between px-0.5">
        <span className="flex items-center gap-1.5 text-[10.5px] font-semibold tracking-wide text-muted">
          <Tags size={12} />
          标签
        </span>
        <span className="text-[10px] tabular-nums text-muted/60">{selected.length}</span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {selected.length === 0 && <span className="px-1 text-[11px] text-muted/65">未添加标签</span>}
        {selected.map((tag) => (
          <span
            key={tag.id}
            className="chip is-active"
            data-testid={`assigned-tag-${tag.name}`}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: tag.color }} />
            {tag.name}
            <button
              type="button"
              className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full text-muted hover:bg-danger-soft hover:text-danger"
              onClick={() => onToggle(tag.id, selectedIds.filter((id) => id !== tag.id))}
              aria-label={`移除标签 ${tag.name}`}
            >
              <X size={10} />
            </button>
          </span>
        ))}
      </div>

      <div className="mt-2.5 flex items-center gap-1.5">
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
          className="input-base min-h-8 px-2.5 text-[11px]"
          data-testid="tag-input"
        />
        <button
          type="button"
          disabled={busy || creating || draft.trim().length === 0}
          onClick={() => void commit()}
          className="icon-button !h-8 !w-8 border-border"
          aria-label="添加标签"
          data-testid="tag-add"
        >
          <Plus size={13} />
        </button>
      </div>

      {draft.trim().length > 0 && suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {suggestions.slice(0, 8).map((tag) => (
            <button
              key={tag.id}
              type="button"
              onClick={() => {
                onToggle(tag.id, [...selectedIds, tag.id]);
                setDraft('');
              }}
              className="chip"
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: tag.color }} />
              {tag.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
