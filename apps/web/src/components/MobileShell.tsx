import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Cloud,
  CloudOff,
  Eye,
  Download,
  Loader2,
  Menu,
  MessageSquareText,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Search,
  ShieldAlert,
  Sparkles,
  Tags,
  Trash2,
  X,
} from 'lucide-react';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import {
  APP_NAME,
  type NoteSummaryDto,
  type SettingsDto,
  type TagDto,
  type TreeDto,
  type UserDto,
} from '@aimarkdown/shared';
import type { SyncStatus } from '../lib/sync.js';
import { writeNoteTagIds } from '../hooks/useNoteDocument.js';
import { useMobileBackButton, type BackLayerAction } from '../lib/androidBack.js';
import { useIOSEdgeSwipeBack } from '../lib/iosSwipeBack.js';
import type { QuickCaptureEntry } from '../lib/quickCaptures.js';
import { useMobileLayout } from '../hooks/useMobileLayout.js';
import { Sidebar, type SidebarSelection } from './Sidebar.js';
import { NoteList } from './NoteList.js';
import { FavoriteList } from './FavoriteList.js';
import { CaptureList } from './CaptureList.js';
import { MarkdownEditor, type EditorMode, type EditorReveal } from './MarkdownEditor.js';
import { TagEditor } from './TagEditor.js';
import { AiPanel } from './AiPanel.js';
import { ActionMenu, MenuItem } from './ui/Menu.js';
import { SettingsToolbarIcon, SidebarToolbarIcon } from './ui/ToolbarIcons.js';

/**
 * Adaptive mobile shell.
 *
 * The parent Workspace owns every piece of state; this component only changes the presentation.
 * A folded phone uses list ⇄ editor navigation, an unfolded foldable becomes list + editor, and
 * an unfolded landscape foldable / tablet adds the persistent navigation sidebar. Resizing is
 * live, so folding, rotating or entering split-screen never requires a reload. All variants keep
 * the slide-in folder/tag drawer and touch-sized chrome (safe areas, ≥44px targets).
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
  /** Bumped when an external trigger asks to capture; expands the inline composer. */
  composerSignal: number;
  onSubmitCapture(text: string): Promise<void>;
  onOpenPalette(): void;
  reveal: EditorReveal | null;
  settingsOpen: boolean;
  /** True while a tag mutation is in flight (disables the tag editor input). */
  tagBusy: boolean;
  favoritesFolderId: string | null;
  favoritesInboxFolderId: string | null;
  favoriteCount: number;
  favoritesPending: number;
  favoritePlatform: string;
  onFavoritePlatformChange(value: string): void;
  onOpenFavorites(): void;
  onOpenFavoriteFolder(folderId: string): void;
  onCreateFavorite(): void;
  onAskFolderAi(): void;

  onSelect(next: SidebarSelection): void;
  onOpenNote(id: string): void;
  onOpenCaptures(): void;
  onOpenCapture(entry: QuickCaptureEntry): void;
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
  onCloseSettings(): void;
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

const NAV_VISIBLE_KEY = 'aimarkdown.mobile-nav-visible';
const LIST_VISIBLE_KEY = 'aimarkdown.mobile-list-visible';

function readPaneVisible(key: string): boolean {
  try {
    return window.localStorage.getItem(key) !== '0';
  } catch {
    return true;
  }
}

/** Per-device pane preference, matching the desktop sidebar's persisted visibility. */
function usePaneVisible(key: string): [boolean, (visible: boolean) => void] {
  const [visible, setVisible] = useState(() => readPaneVisible(key));
  useEffect(() => {
    try {
      window.localStorage.setItem(key, visible ? '1' : '0');
    } catch {
      /* private mode / storage disabled: the in-memory preference still works */
    }
  }, [key, visible]);
  return [visible, setVisible];
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
    composerSignal,
    onSubmitCapture,
    onOpenPalette,
    reveal,
    settingsOpen,
    tagBusy,
    favoritesFolderId,
    favoritesInboxFolderId,
    favoriteCount,
    favoritesPending,
    favoritePlatform,
    onFavoritePlatformChange,
    onOpenFavorites,
    onOpenFavoriteFolder,
    onCreateFavorite,
    onAskFolderAi,
    onSelect,
    onOpenNote,
    onOpenCaptures,
    onOpenCapture,
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
    onCloseSettings,
    onExportNote,
    onLogout,
    onCreateTag,
    resolveWikilink,
    onNavigate,
  } = props;

  const layout = useMobileLayout();
  const [view, setView] = useState<'list' | 'editor'>('list');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [navVisible, setNavVisible] = usePaneVisible(NAV_VISIBLE_KEY);
  const [listVisible, setListVisible] = usePaneVisible(LIST_VISIBLE_KEY);

  const showNavPane = layout === 'expanded' && navVisible;
  // The expanded layout always keeps the note list; list visibility only controls the two-pane
  // unfolded layout. Otherwise a list hidden in portrait could leave no way to restore it after
  // rotating into the three-pane layout.
  const showListPane = layout === 'split' ? listVisible : layout === 'expanded';
  const leftPaneVisible = layout === 'expanded' ? navVisible : listVisible;

  // Android's hardware key and iOS's left-edge gesture share one layer order: overlays first,
  // then the editor, and only the root list is allowed to leave the app. Wide layouts have no
  // editor→list step because both panes stay on screen.
  const applyBackAction = (action: BackLayerAction) => {
    switch (action) {
      case 'close-settings':
        onCloseSettings();
        return;
      case 'close-ai':
        setAiOpen(false);
        return;
      case 'close-tags':
        setTagsOpen(false);
        return;
      case 'close-drawer':
        setDrawerOpen(false);
        return;
      case 'show-list':
        setView('list');
        return;
    }
  };

  const backView: 'list' | 'editor' = layout === 'compact' ? view : 'list';
  const backState = { settingsOpen, aiOpen, tagsOpen, drawerOpen, view: backView };
  useMobileBackButton(backState, applyBackAction);
  useIOSEdgeSwipeBack(backState, applyBackAction);

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

  /**
   * The leftmost visible pane is the collapse target: navigation in the three-pane layout, the
   * note list in the two-pane layout. Keeping one control makes the behavior predictable when a
   * foldable is rotated while the user is mid-note.
   */
  const toggleLeftPane = () => {
    if (layout === 'expanded') setNavVisible(!navVisible);
    else setListVisible(!listVisible);
  };

  const leftPaneLabel =
    layout === 'expanded'
      ? navVisible
        ? '隐藏左侧栏'
        : '显示左侧栏'
      : listVisible
        ? '隐藏笔记列表'
        : '显示笔记列表';

  const titleEditable = Boolean(selectedNoteId) && !inTrash;
  const selectedNote = notes.find((note) => note.id === selectedNoteId);

  const headerButton =
    'flex h-11 w-11 shrink-0 items-center justify-center rounded text-muted active:bg-hover';

  const renderBanner = () =>
    banner ? (
      <div
        className="border-b border-border bg-accent/10 px-3 py-1.5 text-xs text-accent"
        data-testid="banner"
      >
        {banner}
      </div>
    ) : null;

  const renderSidebar = (variant: 'rail' | 'drawer', closeAfterSelect: boolean) => (
    <Sidebar
      variant={variant}
      tree={tree}
      selection={selection}
      onSelect={(next) => {
        onSelect(next);
        if (closeAfterSelect) closeDrawer();
      }}
      onOpenNote={(id) => {
        onOpenNote(id);
        setView('editor');
        if (closeAfterSelect) closeDrawer();
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
        setView('list');
        if (closeAfterSelect) closeDrawer();
      }}
      favoritesFolderId={favoritesFolderId}
      favoritesInboxFolderId={favoritesInboxFolderId}
      favoriteCount={favoriteCount}
      favoritesPending={favoritesPending}
      onOpenFavorites={() => {
        onOpenFavorites();
        setView('list');
        if (closeAfterSelect) closeDrawer();
      }}
      onOpenFavoriteFolder={(folderId) => {
        onOpenFavoriteFolder(folderId);
        setView('list');
        if (closeAfterSelect) closeDrawer();
      }}
      onCreateFavorite={() => {
        onCreateFavorite();
        if (closeAfterSelect) closeDrawer();
      }}
    />
  );

  const renderListPane = (wide: boolean) => (
    <div
      className={
        wide
          ? 'mobile-list-pane flex min-h-0 flex-col'
          : 'flex min-h-0 flex-1 flex-col'
      }
      data-testid="mobile-list-pane"
    >
      <header className="mobile-header flex shrink-0 items-center gap-1 px-2 pt-[env(safe-area-inset-top)]">
        {(!wide || !showNavPane) && (
          <button
            type="button"
            className={headerButton}
            onClick={() => setDrawerOpen(true)}
            aria-label="打开导航"
            data-testid="open-drawer"
          >
            <Menu size={20} />
          </button>
        )}
        <div className="flex min-w-0 flex-1 items-center gap-2.5 pl-1">
          {!wide && (
            <span className="brand-mark !h-7 !w-7 !rounded-lg !text-[11px]" aria-hidden>
              M
            </span>
          )}
          <span className="truncate text-[13px] font-semibold tracking-tight">
            {captureView ? '速记' : wide ? '笔记' : APP_NAME}
          </span>
        </div>
        <button
          type="button"
          className={headerButton}
          aria-label="搜索或输入命令"
          onClick={onOpenPalette}
          data-testid="mobile-open-palette"
        >
          <Search size={19} />
        </button>
        <SyncBadge status={status} />
        {selection.folderId ? (
          <button type="button" className={headerButton} aria-label="问 AI" onClick={onAskFolderAi}>
            <MessageSquareText size={19} />
          </button>
        ) : null}
        <button
          type="button"
          className={headerButton}
          aria-label="新建笔记"
          onClick={() => void handleCreateNote()}
          data-testid="mobile-new-note"
        >
          <Plus size={20} />
        </button>
        {!wide && (
          <button
            type="button"
            className={headerButton}
            aria-label="设置"
            onClick={onOpenSettings}
            data-testid="open-settings"
          >
            <SettingsToolbarIcon size={20} />
          </button>
        )}
      </header>

      {renderBanner()}

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
            composerSignal={composerSignal}
            onSubmitCapture={onSubmitCapture}
          />
        ) : selection.favorites ? (
          <FavoriteList
            notes={notes}
            selectedId={selectedNoteId}
            onOpen={openNote}
            loading={loading}
            platform={favoritePlatform}
            onPlatformChange={onFavoritePlatformChange}
            onCreateFavorite={onCreateFavorite}
            onAskAi={onAskFolderAi}
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
            onCreateFavorite={onCreateFavorite}
          />
        )}
      </div>
    </div>
  );

  const renderEditorPane = (wide: boolean) => (
    <div
      className={
        wide
          ? 'mobile-editor-pane flex min-h-0 min-w-0 flex-1 flex-col'
          : 'flex min-h-0 flex-1 flex-col'
      }
      data-testid="mobile-editor-pane"
    >
      <header className="mobile-header flex shrink-0 items-center gap-1 px-2 pt-[env(safe-area-inset-top)]">
        {wide ? (
          <button
            type="button"
            className={`${headerButton} ${leftPaneVisible ? 'text-accent' : ''}`}
            aria-label={leftPaneLabel}
            aria-pressed={leftPaneVisible}
            title={leftPaneLabel}
            onClick={toggleLeftPane}
            data-testid="toggle-left-pane"
          >
            <SidebarToolbarIcon size={19} active={leftPaneVisible} />
          </button>
        ) : (
          <button
            type="button"
            className={headerButton}
            aria-label="返回笔记列表"
            onClick={() => setView('list')}
            data-testid="back-to-list"
          >
            <ArrowLeft size={20} />
          </button>
        )}
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

      {(!wide || !showListPane) && renderBanner()}

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
    </div>
  );

  return (
    <div
      className="mobile-shell flex flex-col bg-canvas text-foreground"
      data-testid="workspace"
      data-layout={layout}
      // Same contract as the desktop shell: exposes the active note without list-ordering
      // assumptions (the inbox note is pinned and always sorts first).
      data-active-note-id={selectedNoteId ?? ''}
    >
      {layout === 'compact' ? (
        view === 'list' ? (
          renderListPane(false)
        ) : (
          renderEditorPane(false)
        )
      ) : (
        <div className={`mobile-layout-wide mobile-layout-${layout} flex min-h-0 flex-1`}>
          {showNavPane && (
            <div className="mobile-nav-pane flex min-h-0 flex-col" data-testid="mobile-nav-pane">
              <div className="min-h-0 flex-1">{renderSidebar('rail', false)}</div>
              <div className="flex h-14 shrink-0 items-center gap-2 border-t border-border-subtle px-3 pb-[env(safe-area-inset-bottom)]">
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
          )}

          {showListPane && renderListPane(true)}
          {renderEditorPane(true)}
        </div>
      )}

      {/* slide-in navigation drawer */}
      {drawerOpen && (
        <div className="mobile-backdrop" onClick={closeDrawer} data-testid="drawer-backdrop">
          <div className="mobile-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-border-subtle px-3">
              <div className="flex items-center gap-2.5">
                <span className="brand-mark" aria-hidden>
                  M
                </span>
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
            <div className="min-h-0 flex-1">{renderSidebar('drawer', true)}</div>
            <div className="flex h-14 shrink-0 items-center gap-2 border-t border-border-subtle px-4 pb-[env(safe-area-inset-bottom)]">
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
  );
}
