import * as Y from 'yjs';
import type { TagDto } from '@aimarkdown/shared';
import { AiPanel } from './AiPanel.js';
import { OutlineBody } from './Outline.js';
import { TagEditor } from './TagEditor.js';

export type InspectorTab = 'ai' | 'outline';

export interface InspectorProps {
  activeTab: InspectorTab;
  onTabChange(tab: InspectorTab): void;
  noteId: string | null;
  doc: Y.Doc | null;
  source: string;
  createdAt?: string;
  updatedAt?: string;
  inTrash: boolean;
  onJump(anchorId: string): void;
  onOpenSettings(): void;
  allTags: TagDto[];
  selectedTagIds: string[];
  tagBusy: boolean;
  onCreateTag(name: string): Promise<TagDto | undefined>;
  onToggleTags(nextSelected: string[]): void;
}

export function Inspector(props: InspectorProps) {
  return (
    <aside
      className="flex h-full w-80 shrink-0 flex-col border-l border-border bg-surface"
      data-testid="outline"
    >
      <div className="flex shrink-0 border-b border-border p-1">
        {(['ai', 'outline'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => props.onTabChange(tab)}
            className={`flex-1 rounded px-2 py-1 text-[11px] ${
              props.activeTab === tab ? 'bg-accent/10 font-medium text-accent' : 'text-muted hover:bg-hover'
            }`}
            data-testid={`inspector-tab-${tab}`}
          >
            {tab === 'ai' ? 'AI' : '大纲'}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {props.activeTab === 'ai' ? (
          <AiPanel
            noteId={props.noteId}
            doc={props.doc}
            source={props.source}
            onOpenSettings={props.onOpenSettings}
          />
        ) : (
          <OutlineBody
            source={props.source}
            createdAt={props.createdAt}
            updatedAt={props.updatedAt}
            onJump={props.onJump}
          />
        )}
      </div>

      {props.noteId && !props.inTrash && (
        <TagEditor
          allTags={props.allTags}
          selectedIds={props.selectedTagIds}
          busy={props.tagBusy}
          onCreate={props.onCreateTag}
          onToggle={(_tagId, nextSelected) => props.onToggleTags(nextSelected)}
        />
      )}
    </aside>
  );
}
