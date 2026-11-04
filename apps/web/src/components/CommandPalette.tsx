import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Folder as FolderIcon, Loader2, Search } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { FolderDto, NoteSummaryDto } from '@aimarkdown/shared';
import { MIN_SEARCH_QUERY_LENGTH } from '@aimarkdown/shared';

/**
 * VS Code / Obsidian style command palette: one ⌘K surface for commands, note jumps and
 * folder jumps. Note search reuses the server search (≥2 chars); an empty query shows recents.
 */

export interface PaletteCommand {
  id: string;
  label: string;
  icon: LucideIcon;
  keywords?: string;
  run(): void;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose(): void;
  commands: PaletteCommand[];
  recents: NoteSummaryDto[];
  folders: FolderDto[];
  onOpenNote(id: string): void;
  onSelectFolder(folderId: string): void;
  searchNotes(q: string): Promise<NoteSummaryDto[]>;
}

interface FlatItem {
  key: string;
  group: '命令' | '笔记' | '目录';
  label: string;
  hint?: string;
  icon: LucideIcon;
  run(): void;
}

function noteHint(note: NoteSummaryDto): string {
  const date = new Date(note.contentUpdatedAt);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toTimeString().slice(0, 5);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function CommandPalette({
  open,
  onClose,
  commands,
  recents,
  folders,
  onOpenNote,
  onSelectFolder,
  searchNotes,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<NoteSummaryDto[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const q = query.trim().toLowerCase();

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setResults(null);
    setActive(0);
    window.setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (q.length < MIN_SEARCH_QUERY_LENGTH) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(() => {
      searchNotes(query.trim())
        .then((items) => {
          setResults(items);
          setSearching(false);
        })
        .catch(() => {
          setResults([]);
          setSearching(false);
        });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [open, q, query, searchNotes]);

  const items = useMemo<FlatItem[]>(() => {
    const out: FlatItem[] = [];
    for (const command of commands) {
      const haystack = `${command.label} ${command.keywords ?? ''}`.toLowerCase();
      if (q && !haystack.includes(q)) continue;
      out.push({ key: `cmd:${command.id}`, group: '命令', label: command.label, icon: command.icon, run: command.run });
    }
    const notes = q.length >= MIN_SEARCH_QUERY_LENGTH ? (results ?? []) : recents;
    for (const note of notes) {
      out.push({
        key: `note:${note.id}`,
        group: '笔记',
        label: note.title || '无标题',
        hint: noteHint(note),
        icon: FileText,
        run: () => onOpenNote(note.id),
      });
    }
    if (q) {
      for (const folder of folders) {
        if (!folder.name.toLowerCase().includes(q)) continue;
        out.push({
          key: `folder:${folder.id}`,
          group: '目录',
          label: folder.name,
          hint: String(folder.noteCount),
          icon: FolderIcon,
          run: () => onSelectFolder(folder.id),
        });
      }
    }
    return out;
  }, [commands, q, results, recents, folders, onOpenNote, onSelectFolder]);

  useEffect(() => setActive(0), [items.length, q]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-palette-index="${active}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const runAt = (index: number) => {
    const item = items[index];
    if (!item) return;
    onClose();
    // Let the overlay unmount first so focus lands inside the destination view.
    window.setTimeout(item.run, 0);
  };

  let lastIndex = -1;
  const groups: Array<FlatItem['group']> = ['命令', '笔记', '目录'];

  return (
    <div
      className="palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      data-testid="command-palette"
    >
      <div className="palette-panel" role="dialog" aria-modal="true" aria-label="命令面板">
        <div className="flex items-center gap-2 border-b border-border-subtle px-3.5">
          <Search size={15} className="shrink-0 text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((value) => (items.length ? (value + 1) % items.length : 0));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((value) => (items.length ? (value - 1 + items.length) % items.length : 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                runAt(active);
              }
            }}
            placeholder="搜索笔记、目录或输入命令"
            aria-label="命令面板搜索"
            className="h-11 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted/60"
            data-testid="command-palette-input"
          />
          {searching && <Loader2 size={14} className="animate-spin text-muted" />}
          <kbd className="rounded border border-border bg-background px-1.5 py-0.5 text-[9px] text-muted">Esc</kbd>
        </div>
        <div ref={listRef} className="palette-list min-h-0 flex-1 overflow-y-auto p-2" role="listbox">
          {items.length === 0 && (
            <div className="px-3 py-8 text-center text-[11px] text-muted">
              {q.length > 0 && q.length < MIN_SEARCH_QUERY_LENGTH
                ? `至少输入 ${MIN_SEARCH_QUERY_LENGTH} 个字符`
                : '没有匹配结果'}
            </div>
          )}
          {groups.map((group) => {
            const groupItems = items.filter((item) => item.group === group);
            if (groupItems.length === 0) return null;
            return (
              <div key={group} className="mb-1">
                <div className="section-label px-2 pb-1 pt-2">{group}</div>
                {groupItems.map((item) => {
                  lastIndex += 1;
                  const index = lastIndex;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      data-palette-index={index}
                      role="option"
                      aria-selected={index === active}
                      className={`palette-item ${index === active ? 'is-active' : ''}`}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => runAt(index)}
                    >
                      <Icon size={14} className="shrink-0 text-muted" />
                      <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                      {item.hint && <span className="shrink-0 text-[10px] tabular-nums text-muted/70">{item.hint}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
