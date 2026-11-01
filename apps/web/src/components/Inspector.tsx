import * as Y from 'yjs';
import { ListTree, Sparkles } from 'lucide-react';
import type { TagDto } from '@aimarkdown/shared';
import { AiPanel } from './AiPanel.js';
import { OutlineBody } from './Outline.js';
import { TagEditor } from './TagEditor.js';
import { SegmentedControl } from './ui/SegmentedControl.js';

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

const TABS = [
  { value: 'outline' as const, label: '大纲', icon: ListTree },
  { value: 'ai' as const, label: 'AI', icon: Sparkles },
];

export function Inspector(props: InspectorProps) {
  return (
    <aside className="inspector-panel flex h-full flex-col" data-testid="outline">
      <div className="flex shrink-0 items-center border-b border-border-subtle px-3 py-2.5">
        <SegmentedControl
          value={props.activeTab}
          options={TABS}
          onChange={props.onTabChange}
          ariaLabel="右侧检查器"
          testIdPrefix="inspector-tab"
          className="w-full [&_.segmented-button]:flex-1"
        />
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
