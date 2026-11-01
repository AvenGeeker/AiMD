import { useState } from 'react';
import {
  ArrowLeft,
  Cloud,
  CloudOff,
  Eye,
  Download,
  Loader2,
  Menu,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Tags,
  Trash2,
  X,
} from 'lucide-react';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import type {
  NoteSummaryDto,
  SettingsDto,
  TagDto,
  TreeDto,
  UserDto,
} from '@aimarkdown/shared';
import type { SyncStatus } from '../lib/sync.js';
import { writeNoteTagIds } from '../hooks/useNoteDocument.js';
import type { QuickCaptureEntry } from '../lib/quickCaptures.js';
import { Sidebar, type SidebarSelection } from './Sidebar.js';
import { NoteList } from './NoteList.js';
import { CaptureList } from './CaptureList.js';
import { MarkdownEditor, type EditorMode, type EditorReveal } from './MarkdownEditor.js';
import { TagEditor } from './TagEditor.js';
import { AiPanel } from './AiPanel.js';
import { ActionMenu, MenuItem } from './ui/Menu.js';
import { SettingsToolbarIcon } from './ui/ToolbarIcons.js';

/**
 * Single-pane mobile shell.
 *
 * The desktop app shows title bar, sidebar, note list, editor and outline simultaneously; on a
 * phone that does not fit. This shell keeps *all* state in the parent Workspace and only changes
 * the presentation: list ⇄ editor navigation, a slide-in folder/tag drawer, and touch-sized
 * chrome (safe areas, ≥44px targets).
 */

export interface MobileShellProps {
  tree: TreeDto | undefined;
  settings: SettingsDto;
  dark: boolean;
  notes: NoteSummaryDto[];
  loading: boolean;
  inTrash: boolean;
  selection: SidebarSelection;
  selectedNoteId: string | null;
  doc: Y.Doc | null;
  source: string;
  awareness: Awareness | null;
  status: SyncStatus;
  tagIds: string[];
  displayTitle: string;
  user: UserDto;
  banner: string | null;
  inboxNoteId: string | null;
  captures: QuickCaptureEntry[];
  capturesLoading: boolean;
  captureView: boolean;
  captureCount: number;
  reveal: EditorReveal | null;
  /** True while a tag mutation is in flight (disables the tag editor input). */
  tagBusy: boolean;

  onSelect(next: SidebarSelection): void;
  onOpenNote(id: string): void;
  onOpenCaptures(): void;
  onOpenCapture(entry: QuickCaptureEntry): void;
  onCapture(): void;
  onCreateNote(): Promise<void>;
  onCreateFolder(parentId: string | null): void;
  onDeleteFolder(id: string): void;
  onRenameFolder(id: string, name: string): void;
  onDropNote(noteId: string, folderId: string | null): void;
  onTogglePin(note: NoteSummaryDto): void;
  onDeleteNote(id: string): void;
  onRestoreNote(id: string): void;
  onTitleChange(value: string): void;
  onSourceChange(source: string): void;
  onModeChange(mode: EditorMode): void;
  onOpenSettings(): void;
  onExportNote(): void;
  onLogout(): void;
  onCreateTag(name: string): Promise<TagDto | undefined>;
  resolveWikilink?(target: string): Promise<string | null>;
  onNavigate(noteId: string): void;
}

const STATUS_META: Record<SyncStatus, { label: string; icon: typeof Cloud; className: string }> = {
  connected: { label: '已同步', icon: Cloud, className: 'text-success' },
  connecting: { label: '同步中', icon: Loader2, className: 'text-muted animate-spin' },
  disconnected: { label: '离线（已本地保存）', icon: CloudOff, className: 'text-warning' },
  denied: { label: '同步被拒绝', icon: ShieldAlert, className: 'text-danger' },
};

function SyncBadge({ status }: { status: SyncStatus }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <div
      className="flex items-center"
      title={meta.label}
      data-testid="sync-status"
      data-status={status}
    >
      <Icon size={15} className={meta.className} />
    </div>
  );
}

export function MobileShell(props: MobileShellProps) {
  const {
    tree,
    settings,
    dark,
    notes,
    loading,
    inTrash,
    selection,
    selectedNoteId,
    doc,
    source,
    awareness,
    status,
    tagIds,
    displayTitle,
    user,
    banner,
    inboxNoteId,
    captures,
    capturesLoading,
    captureView,
    captureCount,
    reveal,
    tagBusy,
    onSelect,
    onOpenNote,
    onOpenCaptures,
    onOpenCapture,
    onCapture,
    onCreateNote,
    onCreateFolder,
    onDeleteFolder,
    onRenameFolder,
    onDropNote,
    onTogglePin,
    onDeleteNote,
    onRestoreNote,
    onTitleChange,
    onSourceChange,
    onModeChange,
    onOpenSettings,
    onExportNote,
    onLogout,
    onCreateTag,
    resolveWikilink,
    onNavigate,
  } = props;

  const [view, setView] = useState<'list' | 'editor'>('list');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  // Split view is a desktop affordance; a phone shows one pane at a time.
  const effectiveMode: EditorMode = inTrash
    ? 'preview'
    : settings.editorMode === 'split'
      ? 'edit'
      : settings.editorMode;

  const openNote = (id: string) => {
    onOpenNote(id);
    setView('editor');
  };

  const handleCreateNote = async () => {
    await onCreateNote();
    setView('editor');
  };

  const closeDrawer = () => setDrawerOpen(false);

  /** Drawer selection should both apply the filter and dismiss the drawer. */
  const selectInDrawer = (next: SidebarSelection) => {
    onSelect(next);
    closeDrawer();
  };

  const titleEditable = Boolean(selectedNoteId) && !inTrash;
  const selectedNote = notes.find((note) => note.id === selectedNoteId);

  const headerButton =
    'flex h-11 w-11 shrink-0 items-center justify-center rounded text-muted active:bg-hover';

  return (
    <div
      className="flex h-screen flex-col bg-canvas text-foreground"
      data-testid="workspace"
      // Same contract as the desktop shell: exposes the active note without list-ordering
      // assumptions (the inbox note is pinned and always sorts first).
      data-active-note-id={selectedNoteId ?? ''}
    >
      {view === 'list' ? (
        /* ------------------------------- list view ------------------------------- */
        <div className="flex min-h-0 flex-1 flex-col">
          <header className="mobile-header flex shrink-0 items-center gap-1 px-2 pt-[env(safe-area-inset-top)]">
            <button
              type="button"
              className={headerButton}
              onClick={() => setDrawerOpen(true)}
              aria-label="打开导航"
              data-testid="open-drawer"
            >
              <Menu size={20} />
            </button>
            <div className="flex min-w-0 flex-1 items-center gap-2.5 pl-1">
              <span className="brand-mark !h-7 !w-7 !rounded-lg !text-[11px]" aria-hidden>M</span>
              <span className="truncate text-[13px] font-semibold tracking-tight">
                {captureView ? '速记' : 'aiMarkdown'}
              </span>
            </div>
            <SyncBadge status={status} />
            <button
              type="button"
              className={headerButton}
              aria-label="新建笔记"
              onClick={() => void handleCreateNote()}
              data-testid="mobile-new-note"
            >
              <Plus size={20} />
            </button>
            <button
              type="button"
              className={headerButton}
              aria-label="设置"
              onClick={onOpenSettings}
              data-testid="open-settings"
            >
              <SettingsToolbarIcon size={20} />
            </button>
          </header>

          {banner && (
            <div
              className="border-b border-border bg-accent/10 px-3 py-1.5 text-xs text-accent"
              data-testid="banner"
            >
              {banner}
            </div>
          )}

          <div className="min-h-0 flex-1">
            {captureView ? (
              <CaptureList
                captures={captures}
                loading={capturesLoading}
                hasInbox={Boolean(inboxNoteId)}
                onOpen={(entry) => {
                  onOpenCapture(entry);
                  setView('editor');
                }}
                onCapture={onCapture}
              />
            ) : (
              <NoteList
                notes={notes}
                selectedId={selectedNoteId}
                onOpen={openNote}
                inTrash={inTrash}
                loading={loading}
                onTogglePin={onTogglePin}
                onDelete={onDeleteNote}
                onRestore={onRestoreNote}
                onCreateNote={() => void handleCreateNote()}
              />
            )}
          </div>

          {/* slide-in navigation drawer */}
          {drawerOpen && (
            <div className="mobile-backdrop" onClick={closeDrawer} data-testid="drawer-backdrop">
              <div className="mobile-drawer" onClick={(event) => event.stopPropagation()}>
                <div className="flex h-14 shrink-0 items-center justify-between border-b border-border-subtle px-3">
                  <div className="flex items-center gap-2.5">
                    <span className="brand-mark" aria-hidden>M</span>
                    <span className="text-sm font-semibold">导航</span>
                  </div>
                  <button
                    type="button"
                    className={headerButton}
                    onClick={closeDrawer}
                    aria-label="关闭导航"
                    data-testid="close-drawer"
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="min-h-0 flex-1">
                  <Sidebar
                    variant="drawer"
                    tree={tree}
                    selection={selection}
                    onSelect={selectInDrawer}
                    onOpenNote={(id) => {
                      onOpenNote(id);
                      closeDrawer();
                      setView('editor');
                    }}
                    onCreateNote={() => void handleCreateNote()}
                    onCreateFolder={onCreateFolder}
                    onDeleteFolder={onDeleteFolder}
                    onRenameFolder={onRenameFolder}
                    onDropNote={onDropNote}
                    inboxNoteId={inboxNoteId}
                    captureCount={captureCount}
                    capturesActive={captureView}
                    onOpenCaptures={() => {
                      onOpenCaptures();
                      closeDrawer();
                      setView('list');
                    }}
                  />
                </div>
                <div className="flex h-14 shrink-0 items-center gap-2 border-t border-border-subtle px-4">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft text-[10px] font-semibold text-accent">
                    {Array.from(user.displayName.trim())[0]?.toUpperCase() ?? '?'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-muted">
                    {user.displayName}
                  </span>
                  <button
                    type="button"
                    className="button-ghost !min-h-8 px-2 text-[11px]"
                    onClick={onLogout}
                    data-testid="mobile-logout"
                  >
                    退出登录
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ------------------------------ editor view ------------------------------ */
        <div className="flex min-h-0 flex-1 flex-col">
          <header className="mobile-header flex shrink-0 items-center gap-1 px-2 pt-[env(safe-area-inset-top)]">
            <button
              type="button"
              className={headerButton}
              aria-label="返回笔记列表"
              onClick={() => setView('list')}
              data-testid="back-to-list"
            >
              <ArrowLeft size={20} />
            </button>
            <input
              value={selectedNoteId ? displayTitle : ''}
              disabled={!titleEditable}
              onChange={(event) => onTitleChange(event.target.value)}
              placeholder="无标题"
              className="min-w-0 flex-1 truncate rounded-md border border-transparent bg-transparent px-2 py-1.5 text-[15px] font-semibold tracking-[-0.02em] outline-none transition-colors hover:border-border focus:border-accent focus:bg-background disabled:cursor-default"
              data-testid="note-title-input"
            />
            {inTrash && (
              <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[9.5px] font-medium text-danger">
                回收站
              </span>
            )}
            <SyncBadge status={status} />
            {selectedNoteId && (
              <ActionMenu label="笔记操作" testId="mobile-note-actions">
                <MenuItem icon={<Download size={14} />} onClick={onExportNote}>
                  导出当前笔记
                </MenuItem>
                {!inTrash && selectedNote && (
                  <>
                    <MenuItem
                      icon={selectedNote.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                      onClick={() => onTogglePin(selectedNote)}
                    >
                      {selectedNote.pinned ? '取消置顶' : '置顶笔记'}
                    </MenuItem>
                    <div className="menu-separator" />
                    <MenuItem
                      icon={<Trash2 size={14} />}
                      danger
                      onClick={() => onDeleteNote(selectedNoteId)}
                    >
                      移到回收站
                    </MenuItem>
                  </>
                )}
                {inTrash && (
                  <>
                    <MenuItem icon={<RotateCcw size={14} />} onClick={() => onRestoreNote(selectedNoteId)}>
                      恢复笔记
                    </MenuItem>
                    <div className="menu-separator" />
                    <MenuItem
                      icon={<Trash2 size={14} />}
                      danger
                      onClick={() => onDeleteNote(selectedNoteId)}
                    >
                      彻底删除
                    </MenuItem>
                  </>
                )}
              </ActionMenu>
            )}
            <button
              type="button"
              className={headerButton}
              aria-label="设置"
              onClick={onOpenSettings}
              data-testid="open-settings"
            >
              <SettingsToolbarIcon size={20} />
            </button>
          </header>

          {banner && (
            <div
              className="border-b border-border bg-accent/10 px-3 py-1.5 text-xs text-accent"
              data-testid="banner"
            >
              {banner}
            </div>
          )}

          <div className="min-h-0 flex-1">
            {selectedNoteId && doc ? (
              <MarkdownEditor
                noteId={selectedNoteId}
                doc={doc}
                awareness={awareness}
                mode={effectiveMode}
                fontSize={settings.fontSize}
                dark={dark}
                onSourceChange={onSourceChange}
                resolveWikilink={resolveWikilink}
                onNavigate={onNavigate}
                reveal={reveal}
              />
            ) : (
              <div className="empty-state h-full">
                <span className="empty-state-icon">
                  <Sparkles size={19} />
                </span>
                <span className="text-[12px]">{loading ? '加载中…' : '选择或新建一篇笔记'}</span>
                {!loading && (
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => void handleCreateNote()}
                    data-testid="mobile-empty-create"
                  >
                    新建笔记
                  </button>
                )}
              </div>
            )}
          </div>

          {/* touch-first bottom bar */}
          <footer className="mobile-bottom-bar flex shrink-0 items-center gap-2 px-3 pb-[env(safe-area-inset-bottom)]">
            <div className="segmented">
              {(['edit', 'preview'] as const).map((entry) => {
                const Icon = entry === 'edit' ? Pencil : Eye;
                const active = effectiveMode === entry;
                return (
                  <button
                    key={entry}
                    type="button"
                    onClick={() => onModeChange(entry)}
                    className={`segmented-button !h-8 !px-3 ${active ? 'is-active' : ''}`}
                    data-testid={`mode-${entry}`}
                  >
                    <Icon size={13} />
                    {entry === 'edit' ? '编辑' : '预览'}
                  </button>
                );
              })}
            </div>
            <span className="min-w-0 flex-1" />
            <button
              type="button"
              className="flex h-11 items-center gap-1.5 rounded-lg px-3 text-[11px] text-muted active:bg-hover"
              onClick={() => setAiOpen(true)}
              data-testid="open-ai-mobile"
            >
              <Sparkles size={16} />
              AI
            </button>
            <button
              type="button"
              className="flex h-11 items-center gap-1.5 rounded-lg px-3 text-[11px] text-muted active:bg-hover"
              onClick={() => setTagsOpen(true)}
              data-testid="open-tags"
            >
              <Tags size={16} />
              标签
            </button>
          </footer>

          {/* tag sheet */}
          {tagsOpen && (
            <div className="mobile-backdrop" onClick={() => setTagsOpen(false)}>
              <div
                className="mobile-sheet"
                onClick={(event) => event.stopPropagation()}
                data-testid="tag-sheet"
              >
                <div className="flex h-14 shrink-0 items-center justify-between border-b border-border-subtle px-4">
                  <span className="text-sm font-medium">标签</span>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setTagsOpen(false)}
                    aria-label="关闭标签"
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-auto p-2">
                  <TagEditor
                    allTags={tree?.tags ?? []}
                    selectedIds={tagIds}
                    busy={tagBusy}
                    onCreate={onCreateTag}
                    onToggle={(_tagId, nextSelected) => {
                      writeNoteTagIds(doc, nextSelected);
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {aiOpen && (
            <div className="mobile-backdrop" onClick={() => setAiOpen(false)}>
              <div
                className="mobile-sheet h-[70vh]"
                onClick={(event) => event.stopPropagation()}
                data-testid="ai-sheet"
              >
                <div className="flex h-14 shrink-0 items-center justify-between border-b border-border-subtle px-4">
                  <span className="text-sm font-medium">AI 助手</span>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setAiOpen(false)}
                    aria-label="关闭 AI"
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                  <AiPanel
                    noteId={selectedNoteId}
                    doc={doc}
                    source={source}
                    onOpenSettings={() => {
                      setAiOpen(false);
                      onOpenSettings();
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
