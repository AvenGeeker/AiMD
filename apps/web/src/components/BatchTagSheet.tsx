import { useEffect, useState } from 'react';
import { Tags, X } from 'lucide-react';
import type { TagDto } from '@aimarkdown/shared';
import { TagEditor } from './TagEditor.js';
import { hapticTap } from '../lib/haptics.js';

/**
 * Batch tagging.
 *
 * Semantics are additive: the checked tags are unioned into every selected note, and tags a note
 * already carries elsewhere are left alone. Removing tags in bulk would silently strip tags that
 * another device just added, which the CRDT cannot distinguish from a deliberate edit.
 */

export interface BatchTagSheetProps {
  open: boolean;
  count: number;
  tags: TagDto[];
  busy?: boolean;
  onCreate(name: string): Promise<TagDto | undefined>;
  onClose(): void;
  onApply(tagIds: string[]): void;
}

export function BatchTagSheet({
  open,
  count,
  tags,
  busy = false,
  onCreate,
  onClose,
  onApply,
}: BatchTagSheetProps) {
  const [draft, setDraft] = useState<string[]>([]);

  useEffect(() => {
    if (open) setDraft([]);
  }, [open]);

  if (!open) return null;

  return (
    <div className="mobile-backdrop" onClick={onClose} data-testid="batch-tag-backdrop">
      <div
        className="mobile-sheet"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="批量添加标签"
        data-testid="batch-tag-sheet"
      >
        <span className="sheet-grabber" aria-hidden />
        <div className="sheet-header">
          <span className="sheet-title">
            <Tags size={15} className="text-accent" />
            添加标签
          </span>
          <span className="sheet-subtitle">为选中的 {count} 篇笔记追加</span>
          <button type="button" className="icon-button" aria-label="关闭" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <TagEditor
            allTags={tags}
            selectedIds={draft}
            busy={busy}
            onCreate={onCreate}
            onToggle={(_tagId, nextSelected) => setDraft(nextSelected)}
          />
        </div>

        <div className="sheet-footer">
          <button type="button" className="button-ghost" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            type="button"
            className="button-primary"
            disabled={busy || draft.length === 0}
            data-testid="batch-tag-apply"
            onClick={() => {
              hapticTap();
              onApply(draft);
            }}
          >
            添加 {draft.length > 0 ? `${draft.length} 个标签` : '标签'}
          </button>
        </div>
      </div>
    </div>
  );
}
