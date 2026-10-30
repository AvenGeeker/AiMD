import { Pin, RotateCcw, Trash2 } from 'lucide-react';
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
}: NoteListProps) {
  return (
    <div className="flex h-full w-72 shrink-0 flex-col border-r border-border bg-background" data-testid="note-list">
      <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs text-muted">
        <span>{inTrash ? '回收站' : '笔记'}</span>
        <span>{notes.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {loading && notes.length === 0 && (
          <div className="p-4 text-center text-xs text-muted">加载中…</div>
        )}
        {!loading && notes.length === 0 && (
          <div className="p-4 text-center text-xs text-muted">这里还没有笔记</div>
        )}
        {notes.map((note) => (
          <div
            key={note.id}
            draggable={!inTrash}
            onDragStart={(event) => event.dataTransfer.setData('text/aimarkdown-note', note.id)}
            onClick={() => onOpen(note.id)}
            className={`group cursor-pointer border-b border-border/60 px-3 py-2 ${
              selectedId === note.id ? 'bg-accent/10' : 'hover:bg-hover'
            }`}
            data-testid={`note-item-${note.id}`}
          >
            <div className="flex items-center gap-1">
              {note.pinned && <Pin size={12} className="shrink-0 text-accent" />}
              <span className="flex-1 truncate text-sm font-medium">{note.title}</span>
              <span className="shrink-0 text-[11px] text-muted/70">{formatDate(note.contentUpdatedAt)}</span>
            </div>
            {note.excerpt && <div className="mt-0.5 truncate text-xs text-muted">{note.excerpt}</div>}
            {note.matches && note.matches.length > 0 && (
              <div className="mt-1 space-y-0.5">
                {note.matches.slice(0, 2).map((match, index) => (
                  <div key={index} className="truncate text-[11px] text-accent/80">
                    {match}
                  </div>
                ))}
              </div>
            )}
            <div className="mt-1 hidden items-center gap-2 group-hover:flex">
              {!inTrash ? (
                <>
                  <button
                    type="button"
                    className="text-[11px] text-muted hover:text-foreground"
                    onClick={(event) => {
                      event.stopPropagation();
                      onTogglePin(note);
                    }}
                  >
                    {note.pinned ? '取消置顶' : '置顶'}
                  </button>
                  <button
                    type="button"
                    className="text-[11px] text-muted hover:text-danger"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(note.id);
                    }}
                  >
                    删除
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="flex items-center gap-1 text-[11px] text-muted hover:text-foreground"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRestore(note.id);
                    }}
                  >
                    <RotateCcw size={11} /> 恢复
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-1 text-[11px] text-muted hover:text-danger"
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
