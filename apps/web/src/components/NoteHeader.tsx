import { Download, Pin, PinOff, RotateCcw, Share2, Trash2 } from 'lucide-react';
import { ActionMenu, MenuItem } from './ui/Menu.js';

export interface NoteHeaderProps {
  title: string;
  updatedAt?: string;
  pinned: boolean;
  inTrash: boolean;
  onTitleChange(value: string): void;
  onTogglePin(): void;
  onShare(): void;
  onExport(): void;
  onDelete(): void;
  onRestore(): void;
}

function formatUpdatedAt(value: string | undefined): string {
  if (!value) return '尚未保存';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '尚未保存';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Document-centred title area; all edits still go through the note CRDT. */
export function NoteHeader({
  title,
  updatedAt,
  pinned,
  inTrash,
  onTitleChange,
  onTogglePin,
  onShare,
  onExport,
  onDelete,
  onRestore,
}: NoteHeaderProps) {
  return (
    <div className="note-header flex shrink-0 items-center gap-3 px-5" data-testid="note-header">
      <div className="min-w-0 flex-1">
        <input
          value={title}
          disabled={inTrash}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder="无标题"
          aria-label="笔记标题"
          className="note-title-input"
          data-testid="note-title-input"
        />
        <div className="note-meta mt-1.5 px-1.5">
          {inTrash ? (
            <>
              <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[10px] font-medium text-danger">
                回收站
              </span>
              <span className="note-meta-dot" />
            </>
          ) : null}
          <span>{inTrash ? '只读预览' : formatUpdatedAt(updatedAt)}</span>
          {!inTrash && pinned ? (
            <>
              <span className="note-meta-dot" />
              <span className="flex items-center gap-1 text-accent">
                <Pin size={10} /> 已置顶
              </span>
            </>
          ) : null}
        </div>
      </div>

      <div className="titlebar-no-drag flex shrink-0 items-center gap-1">
        {!inTrash && (
          <button
            type="button"
            className="icon-button"
            onClick={onShare}
            title="分享笔记"
            aria-label="分享笔记"
            data-testid="note-header-share"
          >
            <Share2 size={16} />
          </button>
        )}
        {!inTrash && (
          <button
            type="button"
            className={`icon-button ${pinned ? 'is-active' : ''}`}
            onClick={onTogglePin}
            title={pinned ? '取消置顶' : '置顶笔记'}
            aria-label={pinned ? '取消置顶' : '置顶笔记'}
            data-testid="note-header-pin"
          >
            {pinned ? <PinOff size={16} /> : <Pin size={16} />}
          </button>
        )}
        <ActionMenu label="笔记操作" testId="note-actions-menu">
          <MenuItem icon={<Download size={14} />} onClick={onExport} testId="note-export">
            导出当前笔记
          </MenuItem>
          {inTrash ? (
            <>
              <MenuItem icon={<RotateCcw size={14} />} onClick={onRestore} testId="note-restore">
                恢复笔记
              </MenuItem>
              <div className="menu-separator" />
              <MenuItem icon={<Trash2 size={14} />} onClick={onDelete} danger testId="note-delete">
                彻底删除
              </MenuItem>
            </>
          ) : (
            <>
              <div className="menu-separator" />
              <MenuItem icon={<Trash2 size={14} />} onClick={onDelete} danger testId="note-delete">
                移到回收站
              </MenuItem>
            </>
          )}
        </ActionMenu>
      </div>
    </div>
  );
}
