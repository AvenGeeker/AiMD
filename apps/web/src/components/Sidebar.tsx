import { useMemo, useState } from 'react';
import {
  ChevronRight,
  FilePlus2,
  FolderPlus,
  Folder as FolderIcon,
  Inbox,
  NotebookPen,
  Bookmark,
  BookmarkPlus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { FolderDto, TagDto, TreeDto } from '@aimarkdown/shared';
import { MIN_SEARCH_QUERY_LENGTH } from '@aimarkdown/shared';

/** Left rail: search, library navigation, folder tree, tags and trash. */

export interface SidebarSelection {
  folderId: string | null | undefined;
  rootOnly: boolean;
  tagIds: string[];
  archived: 'true' | 'false' | 'only';
  q: string;
  favorites: boolean;
  recursive: boolean;
}

export const EMPTY_SELECTION: SidebarSelection = {
  folderId: undefined,
  rootOnly: false,
  tagIds: [],
  archived: 'false',
  q: '',
  favorites: false,
  recursive: false,
};

interface SidebarProps {
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
  favoritesFolderId: string | null;
  favoritesInboxFolderId: string | null;
  favoriteCount: number;
  favoritesPending: number;
  onOpenFavorites(): void;
  onOpenFavoriteFolder(folderId: string): void;
  onCreateFavorite(): void;
}

interface TreeNode {
  folder: FolderDto;
  children: TreeNode[];
}

export function buildTree(folders: FolderDto[]): TreeNode[] {
  const byParent = new Map<string | null, FolderDto[]>();
  const ids = new Set(folders.map((folder) => folder.id));
  for (const folder of folders) {
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
      if (placed.has(folder.id)) continue;
      placed.add(folder.id);
      out.push({ folder, children: build(folder.id) });
    }
    return out;
  };

  const roots = build(null);
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
    favoritesFolderId,
    favoritesInboxFolderId,
    favoriteCount,
    favoritesPending,
    onOpenFavorites,
    onOpenFavoriteFolder,
    onCreateFavorite,
  } = props;

  const [query, setQuery] = useState(selection.q);
  const [dragOverFolder, setDragOverFolder] = useState<string | null | undefined>(undefined);
  const [editingFolder, setEditingFolder] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const favoriteSubtrees = useMemo(() => {
    const ids = new Set<string>();
    if (!favoritesFolderId) return ids;
    ids.add(favoritesFolderId);
    let changed = true;
    while (changed) {
      changed = false;
      for (const folder of tree?.folders ?? []) {
        if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
          ids.add(folder.id);
          changed = true;
        }
      }
    }
    return ids;
  }, [tree?.folders, favoritesFolderId]);
  const folders = useMemo(
    () => buildTree((tree?.folders ?? []).filter((folder) => !favoriteSubtrees.has(folder.id))),
    [tree?.folders, favoriteSubtrees],
  );
  const favoriteCategories = useMemo(
    () => (tree?.folders ?? []).filter((folder) => folder.parentId === favoritesFolderId),
    [tree?.folders, favoritesFolderId],
  );
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
    onSelect({
      ...EMPTY_SELECTION,
      folderId,
      rootOnly: folderId === null,
      q: selection.q,
      tagIds: selection.tagIds,
      favorites: false,
      recursive: false,
    });
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
      const hasChildren = node.children.length > 0;
      return (
        <div key={node.folder.id}>
          <div
            className={`folder-row group ${isActive ? 'is-active' : ''} ${
              dragOverFolder === node.folder.id ? 'ring-1 ring-accent' : ''
            }`}
            style={{ paddingLeft: `${depth * 13 + 4}px` }}
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
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted ${
                hasChildren ? 'hover:bg-hover hover:text-foreground' : 'pointer-events-none opacity-0'
              }`}
              onClick={() => toggleExpanded(node.folder.id)}
              aria-label={isOpen ? '折叠目录' : '展开目录'}
            >
              <ChevronRight
                size={13}
                className={`transition-transform duration-150 ${isOpen ? 'rotate-90' : ''}`}
              />
            </button>
            <FolderIcon size={14} className={`shrink-0 ${isActive ? 'text-accent' : 'text-muted'}`} />
            {editingFolder === node.folder.id ? (
              <input
                autoFocus
                defaultValue={node.folder.name}
                className="input-base h-6 min-h-0 flex-1 px-1.5 py-0 text-xs"
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
                className="min-w-0 flex-1 truncate text-left"
                onClick={() => selectFolder(node.folder.id)}
                onDoubleClick={() => setEditingFolder(node.folder.id)}
                title="双击重命名"
              >
                {node.folder.name}
              </button>
            )}
            <span className="shrink-0 text-[10.5px] tabular-nums text-muted/70">{node.folder.noteCount}</span>
            <button
              type="button"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted opacity-0 transition-opacity hover:bg-danger-soft hover:text-danger group-hover:opacity-100"
              onClick={() => onDeleteFolder(node.folder.id)}
              aria-label="删除目录"
            >
              <Trash2 size={12} />
            </button>
          </div>
          {isOpen && renderNodes(node.children, depth + 1)}
        </div>
      );
    });

  return (
    <aside
      className={`sidebar-panel flex h-full flex-col ${variant === 'drawer' ? '!w-full' : ''}`}
      data-testid="sidebar"
    >
      {favoritesFolderId ? (
        <div className="px-3 pb-2 pt-3" data-testid="favorites-nav">
          <div className="mb-2 flex items-center justify-between px-1">
            <button
              type="button"
              className={`flex items-center gap-1.5 text-[11px] font-semibold tracking-wide ${selection.favorites ? 'text-accent' : 'text-muted'}`}
              onClick={onOpenFavorites}
            >
              <Bookmark size={13} /> 收藏
              <span className="text-[10px] font-normal tabular-nums text-muted/70">{favoriteCount}</span>
            </button>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                className="icon-button !h-7 !w-7"
                onClick={() => onCreateFolder(favoritesFolderId)}
                title="新建收藏类别"
                aria-label="新建收藏类别"
              >
                <FolderPlus size={14} />
              </button>
              <button type="button" className="icon-button !h-7 !w-7" onClick={onCreateFavorite} title="收藏链接" aria-label="收藏链接">
                <BookmarkPlus size={15} />
              </button>
            </div>
          </div>
          <button type="button" className={`folder-row w-full ${selection.favorites && selection.folderId === favoritesFolderId ? 'is-active' : ''}`} onClick={onOpenFavorites}>
            <Bookmark size={13} className="shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate text-left">全部收藏</span>
            <span className="text-[10.5px] tabular-nums text-muted/70">{favoriteCount}</span>
          </button>
          {favoriteCategories.map((folder) => (
            <button
              key={folder.id}
              type="button"
              className={`folder-row w-full pl-6 ${selection.favorites && selection.folderId === folder.id ? 'is-active' : ''}`}
              onClick={() => onOpenFavoriteFolder(folder.id)}
            >
              <FolderIcon size={12} className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate text-left">{folder.name}</span>
              <span className="text-[10.5px] tabular-nums text-muted/70">
                {folder.id === favoritesInboxFolderId ? favoritesPending : folder.noteCount}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="px-3 pb-2 pt-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-[11px] font-semibold tracking-wide text-muted">笔记库</span>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              className="icon-button !h-7 !w-7"
              onClick={onCreateNote}
              title="新建笔记"
              aria-label="新建笔记"
              data-testid="new-note"
            >
              <FilePlus2 size={15} />
            </button>
            <button
              type="button"
              className="icon-button !h-7 !w-7"
              onClick={() => onCreateFolder(null)}
              title="新建目录"
              aria-label="新建目录"
              data-testid="new-folder"
            >
              <FolderPlus size={15} />
            </button>
          </div>
        </div>

        <div className="sidebar-search flex items-center gap-2 px-2.5">
          <Search size={14} className="shrink-0 text-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !queryTooShort) {
                onSelect({ ...selection, q: query.trim() });
              }
            }}
            placeholder="搜索笔记"
            aria-label="搜索笔记"
            className="h-8 min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted/65"
            data-testid="search-input"
          />
          {query && (
            <button
              type="button"
              className="flex h-5 w-5 items-center justify-center rounded text-muted hover:bg-hover hover:text-foreground"
              onClick={() => {
                setQuery('');
                onSelect({ ...selection, q: '' });
              }}
              aria-label="清除搜索"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {queryTooShort && (
          <div className="px-1 pt-1.5 text-[10.5px] text-warning">
            搜索词至少 {MIN_SEARCH_QUERY_LENGTH} 个字符
          </div>
        )}
        {selection.q && !queryTooShort && (
          <div className="flex items-center justify-between px-1 pt-1.5 text-[10.5px] text-muted">
            <span className="truncate">搜索「{selection.q}」</span>
            <button
              type="button"
              className="shrink-0 text-accent hover:underline"
              onClick={() => onSelect({ ...selection, q: '' })}
            >
              清除
            </button>
          </div>
        )}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <div className="space-y-0.5">
          <button
            type="button"
            onClick={() => onSelect({ ...EMPTY_SELECTION, q: selection.q })}
            className={`nav-item ${
              !capturesActive &&
              selection.folderId === undefined &&
              selection.archived === 'false' &&
              selection.tagIds.length === 0
                ? 'is-active'
                : ''
            }`}
            data-testid="all-notes"
          >
            <FilePlus2 size={15} className={selection.folderId === undefined ? 'text-accent' : 'text-muted'} />
            <span>全部笔记</span>
            <span className="nav-count">{tree?.counts.notes ?? 0}</span>
          </button>

          <button
            type="button"
            onClick={onOpenCaptures}
            className={`nav-item ${capturesActive ? 'is-active' : ''}`}
            data-testid="captures-link"
          >
            <NotebookPen size={15} className={capturesActive ? 'text-accent' : 'text-muted'} />
            <span>速记</span>
            <span className="nav-count">{captureCount}</span>
          </button>

          {inboxNoteId && (
            <button
              type="button"
              onClick={() => onOpenNote(inboxNoteId)}
              className="nav-item"
              data-testid="inbox-link"
            >
              <Inbox size={15} className="text-muted" />
              <span>收集箱</span>
            </button>
          )}
        </div>

        <div className="mb-1.5 mt-5 flex items-center justify-between">
          <span className="section-label">目录</span>
          <button
            type="button"
            className="flex h-5 w-5 items-center justify-center rounded text-muted hover:bg-hover hover:text-foreground"
            onClick={() => onCreateFolder(null)}
            aria-label="新建目录"
            title="新建目录"
          >
            <FolderPlus size={12} />
          </button>
        </div>
        <div
          className={`rounded-lg py-0.5 ${dragOverFolder === null ? 'ring-1 ring-accent' : ''}`}
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
            <div className="px-2 py-1.5 text-[11px] text-muted/65">还没有目录</div>
          ) : (
            renderNodes(folders, 0)
          )}
        </div>

        <div className="mb-2 mt-5 flex items-center justify-between">
          <span className="section-label">标签</span>
          <span className="pr-1 text-[10px] tabular-nums text-muted/60">{tags.length}</span>
        </div>
        <div className="flex flex-wrap gap-1.5 px-0.5">
          {tags.length === 0 && <span className="px-1.5 text-[11px] text-muted/65">还没有标签</span>}
          {tags.map((tag: TagDto) => {
            const active = selection.tagIds.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggleTag(tag.id)}
                className={`chip ${active ? 'is-active' : ''}`}
                data-testid={`tag-${tag.name}`}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: tag.color }} />
                <span>{tag.name}</span>
                <span className="tabular-nums opacity-55">{tag.noteCount}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-5 border-t border-border-subtle pt-2">
          <button
            type="button"
            onClick={() => onSelect({ ...EMPTY_SELECTION, archived: 'only', q: selection.q })}
            className={`nav-item ${selection.archived === 'only' ? 'is-active' : ''}`}
            data-testid="trash-link"
          >
            <Trash2 size={15} className={selection.archived === 'only' ? 'text-accent' : 'text-muted'} />
            <span>回收站</span>
            <span className="nav-count">{tree?.counts.trashed ?? 0}</span>
          </button>
        </div>
      </nav>
    </aside>
  );
}
