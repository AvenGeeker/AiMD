import { Fragment } from 'react';
import { Check, Folder, FolderPlus, Inbox, X } from 'lucide-react';
import type { FolderDto } from '@aimarkdown/shared';
import { buildTree } from './Sidebar.js';
import { hapticTap } from '../lib/haptics.js';

/**
 * Destination picker for "移动到目录".
 *
 * Rendered as a bottom sheet on the phone and as a dialog panel on desktop; the tree itself is
 * the same `buildTree()` the sidebar uses, so cycles and unreachable folders behave identically.
 */

export interface FolderPickerSheetProps {
  open: boolean;
  count: number;
  folders: FolderDto[];
  busy?: boolean;
  /** Currently selected destination, shown with a check mark. */
  activeFolderId?: string | null;
  onClose(): void;
  onPick(folderId: string | null): void;
  onCreateFolder(parentId: string | null): void;
}

interface Row {
  folder: FolderDto;
  depth: number;
}

function flatten(nodes: ReturnType<typeof buildTree>, depth = 0, out: Row[] = []): Row[] {
  for (const node of nodes) {
    out.push({ folder: node.folder, depth });
    flatten(node.children, depth + 1, out);
  }
  return out;
}

export function FolderPickerSheet({
  open,
  count,
  folders,
  busy = false,
  activeFolderId,
  onClose,
  onPick,
  onCreateFolder,
}: FolderPickerSheetProps) {
  if (!open) return null;
  const rows = flatten(buildTree(folders));

  const pick = (folderId: string | null) => {
    hapticTap();
    onPick(folderId);
  };

  return (
    <div className="mobile-backdrop" onClick={onClose} data-testid="folder-picker-backdrop">
      <div
        className="mobile-sheet folder-picker-sheet"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="移动到目录"
        data-testid="folder-picker"
      >
        <span className="sheet-grabber" aria-hidden />
        <div className="sheet-header">
          <span className="sheet-title">移动到目录</span>
          <span className="sheet-subtitle">{count > 0 ? `已选 ${count} 篇` : '选择目标目录'}</span>
          <button type="button" className="icon-button" aria-label="关闭" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          <button
            type="button"
            className="folder-pick-row"
            onClick={() => pick(null)}
            data-testid="folder-pick-root"
          >
            <span className="folder-pick-icon">
              <Inbox size={15} />
            </span>
            <span className="folder-pick-name">根目录（未分组）</span>
            {activeFolderId === null && <Check size={15} className="folder-pick-check" />}
          </button>

          {rows.length === 0 && (
            <div className="folder-pick-empty">还没有目录，先新建一个</div>
          )}

          {rows.map(({ folder, depth }) => (
            <Fragment key={folder.id}>
              <button
                type="button"
                className="folder-pick-row"
                style={{ paddingLeft: 12 + depth * 16 }}
                onClick={() => pick(folder.id)}
                data-testid={`folder-pick-${folder.id}`}
              >
                <span className="folder-pick-icon">
                  <Folder size={15} />
                </span>
                <span className="folder-pick-name">{folder.name}</span>
                <span className="folder-pick-count">{folder.noteCount}</span>
                {activeFolderId === folder.id && <Check size={15} className="folder-pick-check" />}
              </button>
            </Fragment>
          ))}
        </div>

        <div className="sheet-footer">
          <button
            type="button"
            className="button-secondary"
            onClick={() => onCreateFolder(null)}
            data-testid="folder-picker-create"
          >
            <FolderPlus size={14} />
            新建目录
          </button>
          <button type="button" className="button-ghost" onClick={onClose} disabled={busy}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
