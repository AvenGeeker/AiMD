import { FileText, Pin, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { NoteSummaryDto } from '@aimarkdown/shared';

/** Middle rail: the notes matching the current sidebar selection. */

interface NoteListProps {
  notes: NoteSummaryDto[];
  selectedId: string | null;
  onOpen(id: string): void;
  onTogglePin(note: NoteSummaryDto): void;
  onDelete(id: string): void;
  onRestore(id: string): void;
  inTrash: boolean;
  loading: boolean;
  onCreateNote?(): void;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toTimeString().slice(0, 5);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function NoteList({
  notes,
  selectedId,
  onOpen,
  onTogglePin,
  onDelete,
  onRestore,
  inTrash,
  loading,
  onCreateNote,
}: NoteListProps) {
  return (
    <div className="notes-panel flex h-full flex-col" data-testid="note-list">
      <div className="notes-header flex shrink-0 items-center justify-between px-4">
        <div className="flex items-baseline gap-2">
          <span className="text-[12px] font-semibold text-foreground">{inTrash ? '回收站' : '笔记'}</span>
          <span className="text-[10.5px] tabular-nums text-muted">{notes.length}</span>
        </div>
        {!inTrash && onCreateNote && (
          <button
            type="button"
            className="icon-button !h-7 !w-7"
            onClick={onCreateNote}
            title="新建笔记"
            aria-label="新建笔记"
            data-testid="note-list-new-note"
          >
            <Plus size={15} />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && notes.length === 0 && (
          <div className="space-y-3 p-4" aria-label="正在加载笔记">
            {[0, 1, 2].map((index) => (
              <div key={index} className="animate-pulse space-y-2">
                <div className="h-3 w-3/4 rounded bg-hover" />
                <div className="h-2.5 w-full rounded bg-hover/70" />
                <div className="h-2.5 w-1/2 rounded bg-hover/60" />
              </div>
            ))}
          </div>
        )}
        {!loading && notes.length === 0 && (
          <div className="empty-state mx-4 mt-6" data-testid="note-list-empty">
            <span className="empty-state-icon">
              <FileText size={19} />
            </span>
            <div className="text-xs text-muted">这里还没有笔记</div>
            {!inTrash && onCreateNote && (
              <button type="button" className="button-secondary mt-1" onClick={onCreateNote}>
                <Plus size={14} />
                新建笔记
              </button>
            )}
          </div>
        )}
        {notes.map((note) => (
          <div
            key={note.id}
            draggable={!inTrash}
            onDragStart={(event) => event.dataTransfer.setData('text/aimarkdown-note', note.id)}
            onClick={() => onOpen(note.id)}
            className={`note-row group cursor-pointer ${selectedId === note.id ? 'is-selected' : ''}`}
            data-testid={`note-item-${note.id}`}
            aria-current={selectedId === note.id ? 'page' : undefined}
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {note.pinned && <Pin size={11} className="shrink-0 fill-current text-accent" />}
                  <span className="note-row-title truncate">{note.title}</span>
                </div>
                {note.excerpt && <div className="note-row-excerpt mt-1 line-clamp-2">{note.excerpt}</div>}
              </div>
              <span className="note-row-date mt-0.5 shrink-0">{formatDate(note.contentUpdatedAt)}</span>
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

            <div className="note-row-actions mt-1.5 flex items-center gap-0.5">
              {!inTrash ? (
                <>
                  <button
                    type="button"
                    className="icon-button !h-6 !w-6"
                    title={note.pinned ? '取消置顶' : '置顶'}
                    aria-label={note.pinned ? '取消置顶' : '置顶'}
                    onClick={(event) => {
                      event.stopPropagation();
                      onTogglePin(note);
                    }}
                  >
                    <Pin size={12} />
                  </button>
                  <button
                    type="button"
                    className="icon-button is-danger !h-6 !w-6"
                    title="移到回收站"
                    aria-label="移到回收站"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(note.id);
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="flex h-6 items-center gap-1 rounded px-1.5 text-[10.5px] text-muted hover:bg-hover hover:text-foreground"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRestore(note.id);
                    }}
                  >
                    <RotateCcw size={11} /> 恢复
                  </button>
                  <button
                    type="button"
                    className="flex h-6 items-center gap-1 rounded px-1.5 text-[10.5px] text-muted hover:bg-danger-soft hover:text-danger"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(note.id);
                    }}
                  >
                    <Trash2 size={11} /> 彻底删除
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
