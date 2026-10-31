import { useMemo, useState } from 'react';
import {
  ChevronRight,
  FilePlus2,
  FolderPlus,
  Folder as FolderIcon,
  Inbox,
  NotebookPen,
  Search,
  Trash2,
} from 'lucide-react';
import type { FolderDto, TagDto, TreeDto } from '@aimarkdown/shared';
import { MIN_SEARCH_QUERY_LENGTH } from '@aimarkdown/shared';

/** Left rail: search, folder tree, tag filter, quick captures, inbox and trash. */

export interface SidebarSelection {
  folderId: string | null | undefined; // undefined = all notes
  rootOnly: boolean;
  tagIds: string[];
  archived: 'true' | 'false' | 'only';
  q: string;
}

export const EMPTY_SELECTION: SidebarSelection = {
  folderId: undefined,
  rootOnly: false,
  tagIds: [],
  archived: 'false',
  q: '',
};

interface SidebarProps {
  /**
   * `rail` is the fixed desktop left rail. `drawer` fills its container and is used by the
   * mobile shell's slide-in navigation (same component, same data-testids, different width).
   */
  variant?: 'rail' | 'drawer';
  tree: TreeDto | undefined;
  selection: SidebarSelection;
  onSelect(next: SidebarSelection): void;
  onOpenNote(id: string): void;
  onCreateNote(): void;
  onCreateFolder(parentId: string | null): void;
  onDeleteFolder(id: string): void;
  onRenameFolder(id: string, name: string): void;
  onDropNote(noteId: string, folderId: string | null): void;
  inboxNoteId: string | null;
  captureCount: number;
  capturesActive: boolean;
  onOpenCaptures(): void;
}

interface TreeNode {
  folder: FolderDto;
  children: TreeNode[];
}

export function buildTree(folders: FolderDto[]): TreeNode[] {
  const byParent = new Map<string | null, FolderDto[]>();
  const ids = new Set(folders.map((folder) => folder.id));
  for (const folder of folders) {
    // A parent that is not in the set (deleted elsewhere) is treated as root-level.
    const parentId = folder.parentId && ids.has(folder.parentId) ? folder.parentId : null;
    const list = byParent.get(parentId) ?? [];
    list.push(folder);
    byParent.set(parentId, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => (a.position < b.position ? -1 : 1));

  const placed = new Set<string>();
  const build = (parentId: string | null): TreeNode[] => {
    const list = byParent.get(parentId) ?? [];
    const out: TreeNode[] = [];
    for (const folder of list) {
      // `placed` doubles as the cycle guard: a folder can only be rendered once, so a merged
      // cycle terminates instead of recursing forever.
      if (placed.has(folder.id)) continue;
      placed.add(folder.id);
      out.push({ folder, children: build(folder.id) });
    }
    return out;
  };

  const roots = build(null);

  // Any folder still unplaced is only reachable through a cycle, so it has no root ancestor.
  // Surface those at the top level rather than dropping them: a CRDT merge must never make a
  // user's folders silently disappear from the sidebar.
  const unreachable = folders
    .filter((folder) => !placed.has(folder.id))
    .map((folder) => ({ folder, children: [] as TreeNode[] }));

  return [...roots, ...unreachable];
}

export function Sidebar(props: SidebarProps) {
  const {
    variant = 'rail',
    tree,
    selection,
    onSelect,
    onOpenNote,
    onCreateNote,
    onCreateFolder,
    onDeleteFolder,
    onRenameFolder,
    onDropNote,
    inboxNoteId,
    captureCount,
    capturesActive,
    onOpenCaptures,
  } = props;

  const [query, setQuery] = useState(selection.q);
  const [dragOverFolder, setDragOverFolder] = useState<string | null | undefined>(undefined);
  const [editingFolder, setEditingFolder] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const folders = useMemo(() => buildTree(tree?.folders ?? []), [tree?.folders]);
  const tags = tree?.tags ?? [];
  const queryTooShort = query.trim().length > 0 && query.trim().length < MIN_SEARCH_QUERY_LENGTH;

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectFolder = (folderId: string | null | undefined) => {
    onSelect({ ...EMPTY_SELECTION, folderId, rootOnly: folderId === null, q: selection.q, tagIds: selection.tagIds });
  };

  const toggleTag = (tagId: string) => {
    const next = selection.tagIds.includes(tagId)
      ? selection.tagIds.filter((id) => id !== tagId)
      : [...selection.tagIds, tagId];
    onSelect({ ...selection, tagIds: next });
  };

  const renderNodes = (nodes: TreeNode[], depth: number) =>
    nodes.map((node) => {
      const isOpen = expanded.has(node.folder.id);
      const isActive = selection.folderId === node.folder.id && !selection.rootOnly;
      return (
        <div key={node.folder.id}>
          <div
            className={`group flex items-center gap-1 rounded px-2 py-1 text-sm ${
              isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-hover'
            } ${dragOverFolder === node.folder.id ? 'ring-1 ring-accent' : ''}`}
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOverFolder(node.folder.id);
            }}
            onDragLeave={() => setDragOverFolder(undefined)}
            onDrop={(event) => {
              event.preventDefault();
              const noteId = event.dataTransfer.getData('text/aimarkdown-note');
              setDragOverFolder(undefined);
              if (noteId) onDropNote(noteId, node.folder.id);
            }}
          >
            <button
              type="button"
              className="w-4 shrink-0 text-muted"
              onClick={() => toggleExpanded(node.folder.id)}
              aria-label={isOpen ? '折叠' : '展开'}
            >
              <ChevronRight size={14} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />
            </button>
            <FolderIcon size={14} className="shrink-0 text-muted" />
            {editingFolder === node.folder.id ? (
              <input
                autoFocus
                defaultValue={node.folder.name}
                className="w-full rounded border border-border bg-background px-1 text-sm"
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (value && value !== node.folder.name) onRenameFolder(node.folder.id, value);
                  setEditingFolder(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
                  if (event.key === 'Escape') setEditingFolder(null);
                }}
              />
            ) : (
              <button
                type="button"
                className="flex-1 truncate text-left"
                onClick={() => selectFolder(node.folder.id)}
                onDoubleClick={() => setEditingFolder(node.folder.id)}
                title="双击重命名"
              >
                {node.folder.name}
              </button>
            )}
            <span className="shrink-0 text-[11px] text-muted/70">{node.folder.noteCount}</span>
            <button
              type="button"
              className="hidden shrink-0 text-muted hover:text-danger group-hover:block"
              onClick={() => onDeleteFolder(node.folder.id)}
              aria-label="删除目录"
            >
              <Trash2 size={13} />
            </button>
          </div>
          {isOpen && renderNodes(node.children, depth + 1)}
        </div>
      );
    });

  return (
    <aside
      className={`flex h-full flex-col border-r border-border bg-surface ${
        variant === 'drawer' ? 'w-full' : 'w-64 shrink-0'
      }`}
      data-testid="sidebar"
    >
      <div className="flex items-center gap-2 border-b border-border p-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2 top-2.5 text-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                const q = query.trim();
                if (q.length > 0 && q.length < MIN_SEARCH_QUERY_LENGTH) return;
                onSelect({ ...selection, q });
              }
              if (event.key === 'Escape') {
                setQuery('');
                onSelect({ ...selection, q: '' });
              }
            }}
            placeholder={`搜索（至少 ${MIN_SEARCH_QUERY_LENGTH} 字符）`}
            className="w-full rounded border border-border bg-background py-1.5 pl-7 pr-2 text-sm outline-none focus:border-accent"
            data-testid="search-input"
          />
        </div>
        <button
          type="button"
          title="新建笔记"
          onClick={onCreateNote}
          className="rounded p-1.5 text-muted hover:bg-hover hover:text-foreground"
          data-testid="new-note"
        >
          <FilePlus2 size={16} />
        </button>
        <button
          type="button"
          title="新建目录"
          onClick={() => onCreateFolder(selection.folderId ?? null)}
          className="rounded p-1.5 text-muted hover:bg-hover hover:text-foreground"
          data-testid="new-folder"
        >
          <FolderPlus size={16} />
        </button>
      </div>

      {queryTooShort && (
        <div className="px-3 py-1 text-[11px] text-warning">
          搜索词至少 {MIN_SEARCH_QUERY_LENGTH} 个字符（中文分词限制）
        </div>
      )}
      {selection.q && !queryTooShort && (
        <div className="flex items-center justify-between px-3 py-1 text-[11px] text-muted">
          <span>搜索「{selection.q}」</span>
          <button type="button" className="hover:text-foreground" onClick={() => onSelect({ ...selection, q: '' })}>
            清除
          </button>
        </div>
      )}

      <nav className="min-h-0 flex-1 overflow-auto p-2">
        <button
          type="button"
          onClick={() => onSelect({ ...EMPTY_SELECTION, q: selection.q })}
          className={`flex w-full items-center gap-2 rounded px-2 py-1 text-sm ${
            !capturesActive && selection.folderId === undefined && selection.archived === 'false' && selection.tagIds.length === 0
              ? 'bg-accent text-accent-foreground'
              : 'hover:bg-hover'
          }`}
          data-testid="all-notes"
        >
          <FilePlus2 size={14} className="text-muted" />
          全部笔记
          <span className="ml-auto text-[11px] text-muted/70">{tree?.counts.notes ?? 0}</span>
        </button>

        <button
          type="button"
          onClick={onOpenCaptures}
          className={`flex w-full items-center gap-2 rounded px-2 py-1 text-sm ${
            capturesActive ? 'bg-accent text-accent-foreground' : 'hover:bg-hover'
          }`}
          data-testid="captures-link"
        >
          <NotebookPen size={14} className="text-muted" />
          速记
          <span className="ml-auto text-[11px] text-muted/70">{captureCount}</span>
        </button>

        {inboxNoteId && (
          <button
            type="button"
            onClick={() => onOpenNote(inboxNoteId)}
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-sm hover:bg-hover"
            data-testid="inbox-link"
          >
            <Inbox size={14} className="text-muted" />
            收集箱
          </button>
        )}

        <div className="mt-3 flex items-center justify-between px-2 text-[11px] uppercase tracking-wide text-muted">
          <span>目录</span>
        </div>
        <div
          className={`rounded ${dragOverFolder === null ? 'ring-1 ring-accent' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOverFolder(null);
          }}
          onDragLeave={() => setDragOverFolder(undefined)}
          onDrop={(event) => {
            event.preventDefault();
            const noteId = event.dataTransfer.getData('text/aimarkdown-note');
            setDragOverFolder(undefined);
            if (noteId) onDropNote(noteId, null);
          }}
        >
          {folders.length === 0 ? (
            <div className="px-2 py-1 text-xs text-muted/70">还没有目录</div>
          ) : (
            renderNodes(folders, 0)
          )}
        </div>

        <div className="mt-3 px-2 text-[11px] uppercase tracking-wide text-muted">标签</div>
        <div className="flex flex-wrap gap-1 px-2 py-1">
          {tags.length === 0 && <span className="text-xs text-muted/70">还没有标签</span>}
          {tags.map((tag: TagDto) => {
            const active = selection.tagIds.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggleTag(tag.id)}
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
                  active ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted hover:bg-hover'
                }`}
                data-testid={`tag-${tag.name}`}
              >
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: tag.color }} />
                {tag.name}
                <span className="text-muted/60">{tag.noteCount}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-3 border-t border-border pt-2">
          <button
            type="button"
            onClick={() => onSelect({ ...EMPTY_SELECTION, archived: 'only', q: selection.q })}
            className={`flex w-full items-center gap-2 rounded px-2 py-1 text-sm ${
              selection.archived === 'only' ? 'bg-accent text-accent-foreground' : 'hover:bg-hover'
            }`}
            data-testid="trash-link"
          >
            <Trash2 size={14} className="text-muted" />
            回收站
            <span className="ml-auto text-[11px] text-muted/70">{tree?.counts.trashed ?? 0}</span>
          </button>
        </div>
      </nav>
    </aside>
  );
}
