import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownUp,
  ArrowLeft,
  BookmarkPlus,
  Check,
  CheckSquare,
  Download,
  Eye,
  ListFilter,
  Menu,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Share2,
  Sparkles,
  Tags,
  Trash2,
  X,
} from 'lucide-react';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import {
  MIN_SEARCH_QUERY_LENGTH,
  type NoteSort,
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
import type { NoteBatchController } from '../hooks/useNoteBatch.js';
import { Sidebar, EMPTY_SELECTION, type SidebarSelection } from './Sidebar.js';
import { MobileNoteList } from './MobileNoteList.js';
import { MobileTabBar, type MobileTab } from './MobileTabBar.js';
import { MobileFab, type MobileFabAction } from './MobileFab.js';
import { MobileProfilePage } from './MobileProfilePage.js';
import { FavoriteList } from './FavoriteList.js';
import { CaptureList } from './CaptureList.js';
import { MarkdownEditor, type EditorMode, type EditorReveal } from './MarkdownEditor.js';
import { TagEditor } from './TagEditor.js';
import { AiPanel } from './AiPanel.js';
import { ActionMenu, MenuItem } from './ui/Menu.js';
import { SegmentedControl } from './ui/SegmentedControl.js';
import { SelectionToolbar, selectionToolbarProps } from './SelectionToolbar.js';
import { SyncBadge } from './SyncStatusBadge.js';
import { SettingsToolbarIcon, SidebarToolbarIcon } from './ui/ToolbarIcons.js';
import { hapticTap } from '../lib/haptics.js';

/**
 * Adaptive mobile shell.
 *
 * The parent Workspace owns every piece of state; this component only changes the presentation.
 * A phone gets the modern touch shell — a large-title list with inline search, a bottom tab bar,
 * a contextual FAB, swipe actions and long-press multi-select. An unfolded foldable becomes
 * list + editor, and an unfolded landscape foldable / tablet adds the persistent navigation rail;
 * both keep the classic pane chrome instead of a tab bar, because they already have room for it.
 * Resizing is live, so folding, rotating or entering split-screen never requires a reload.
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

  /** Multi-select + batch operations, shared with the desktop shell. */
  batch: NoteBatchController;
  sort: NoteSort;
  onSortChange(sort: NoteSort): void;
  /** One row may reveal its swipe actions at a time; the shell owns that so back can close it. */
  openRowId: string | null;
  onOpenRowIdChange(id: string | null): void;
  movePickerOpen: boolean;
  onOpenMovePicker(): void;
  onCloseMovePicker(): void;
  batchTagOpen: boolean;
  onOpenBatchTags(): void;
  onCloseBatchTag(): void;
  serverUrl: string;
  pendingCount: number;
  onSaveSettings(patch: Partial<SettingsDto>): void;
  onSyncNow(): void;
  onImport(): void;
  onExportVault(): void;
  onOpenTrash(): void;
  onSearchChange(q: string): void;
  onRequestCapture(): void;
  refreshNotes(): Promise<void>;

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
  onShareNote(): void;
  onLogout(): void;
  onCreateTag(name: string): Promise<TagDto | undefined>;
  resolveWikilink?(target: string): Promise<string | null>;
  onNavigate(noteId: string): void;
}

const NAV_VISIBLE_KEY = 'aimarkdown.mobile-nav-visible';
const LIST_VISIBLE_KEY = 'aimarkdown.mobile-list-visible';
/** Scrolling past this collapses the large title into a compact bar. */
const TITLE_COLLAPSE_OFFSET = 24;
/** Debounce so a keystroke does not fire one search request per character. */
const SEARCH_DEBOUNCE_MS = 300;

const SORT_OPTIONS: { value: NoteSort; label: string }[] = [
  { value: 'updated', label: '最近更新' },
  { value: 'created', label: '最近创建' },
  { value: 'title', label: '标题' },
  { value: 'position', label: '手动排序' },
];

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
    batch,
    sort,
    onSortChange,
    openRowId,
    onOpenRowIdChange,
    movePickerOpen,
    onOpenMovePicker,
    onCloseMovePicker,
    batchTagOpen,
    onOpenBatchTags,
    onCloseBatchTag,
    serverUrl,
    pendingCount,
    onSaveSettings,
    onSyncNow,
    onImport,
    onExportVault,
    onOpenTrash,
    onSearchChange,
    onRequestCapture,
    refreshNotes,
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
    onShareNote,
    onLogout,
    onCreateTag,
    resolveWikilink,
    onNavigate,
  } = props;

  const layout = useMobileLayout();
  const [view, setView] = useState<'list' | 'editor'>('list');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [titleCollapsed, setTitleCollapsed] = useState(false);
  const [searchDraft, setSearchDraft] = useState(selection.q);
  const [navVisible, setNavVisible] = usePaneVisible(NAV_VISIBLE_KEY);
  const [listVisible, setListVisible] = usePaneVisible(LIST_VISIBLE_KEY);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const compact = layout === 'compact';
  const showNavPane = layout === 'expanded' && navVisible;
  // The expanded layout always keeps the note list; list visibility only controls the two-pane
  // unfolded layout. Otherwise a list hidden in portrait could leave no way to restore it after
  // rotating into the three-pane layout.
  const showListPane = layout === 'split' ? listVisible : layout === 'expanded';
  const leftPaneVisible = layout === 'expanded' ? navVisible : listVisible;

  /* -------------------------------- search -------------------------------- */

  // An external clear (the sidebar's own search box, a filter change) must reach the field.
  useEffect(() => {
    setSearchDraft((draft) => (draft === selection.q ? draft : selection.q));
  }, [selection.q]);

  const searchTooShort =
    searchDraft.trim().length > 0 && searchDraft.trim().length < MIN_SEARCH_QUERY_LENGTH;

  useEffect(() => {
    const value = searchDraft.trim();
    if (searchTooShort) return;
    if (value === selection.q) return;
    const timer = window.setTimeout(() => onSearchChange(value), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchDraft, searchTooShort, selection.q, onSearchChange]);

  /* ------------------------------ back layers ----------------------------- */

  // Android's hardware key and iOS's left-edge gesture share one layer order: overlays first,
  // then the profile tab, then list modes, then the editor. Only the root list may leave the app.
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
      case 'close-batch-tags':
        onCloseBatchTag();
        return;
      case 'close-move-sheet':
        onCloseMovePicker();
        return;
      case 'close-filter':
        setFilterOpen(false);
        return;
      case 'close-drawer':
        setDrawerOpen(false);
        return;
      case 'close-profile':
        setProfileOpen(false);
        return;
      case 'exit-selection':
        batch.exit();
        return;
      case 'close-swipe-row':
        onOpenRowIdChange(null);
        return;
      case 'show-list':
        setView('list');
        return;
    }
  };

  const backView: 'list' | 'editor' = compact ? view : 'list';
  const backState = {
    settingsOpen,
    aiOpen,
    tagsOpen,
    batchTagsOpen: batchTagOpen,
    moveSheetOpen: movePickerOpen,
    filterOpen,
    drawerOpen,
    profileOpen,
    selectMode: batch.selection.active,
    swipeRowOpen: openRowId !== null,
    view: backView,
  };
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
    'mobile-header-button flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted active:bg-hover';

  /* ------------------------------- tab / fab ------------------------------ */

  const activeTab: MobileTab = profileOpen
    ? 'me'
    : captureView
      ? 'captures'
      : selection.favorites
        ? 'favorites'
        : 'notes';

  const handleTabChange = (tab: MobileTab) => {
    setTitleCollapsed(false);
    setView('list');
    onOpenRowIdChange(null);
    if (batch.selection.active) batch.exit();
    switch (tab) {
      case 'me':
        setProfileOpen(true);
        return;
      case 'favorites':
        setProfileOpen(false);
        if (!selection.favorites) onOpenFavorites();
        return;
      case 'captures':
        setProfileOpen(false);
        if (!captureView) onOpenCaptures();
        return;
      case 'notes': {
        setProfileOpen(false);
        const atRoot =
          !captureView &&
          !selection.favorites &&
          selection.folderId === undefined &&
          selection.archived === 'false' &&
          selection.tagIds.length === 0 &&
          selection.q === '';
        // Tapping the active tab pops back to 全部笔记, the same affordance iOS lists use.
        if (!atRoot) onSelect({ ...EMPTY_SELECTION });
        return;
      }
    }
  };

  const fabAction: MobileFabAction | null =
    !compact || view === 'editor' || profileOpen || batch.selection.active
      ? null
      : captureView
        ? 'capture'
        : selection.favorites
          ? 'favorite'
          : 'note';

  const handleFab = () => {
    if (fabAction === 'note') void handleCreateNote();
    else if (fabAction === 'favorite') onCreateFavorite();
    else if (fabAction === 'capture') onRequestCapture();
  };

  /* -------------------------------- titles -------------------------------- */

  const scopeTitle = useMemo(() => {
    if (captureView) return '速记';
    if (selection.favorites) {
      if (!selection.folderId || selection.folderId === favoritesFolderId) return '收藏';
      return (
        tree?.folders.find((folder) => folder.id === selection.folderId)?.name ?? '收藏'
      );
    }
    if (inTrash) return '回收站';
    if (selection.tagIds.length > 0) {
      const names = selection.tagIds
        .map((id) => tree?.tags.find((tag) => tag.id === id)?.name)
        .filter((name): name is string => Boolean(name));
      return names.length > 0 ? names.join(' · ') : '标签';
    }
    if (selection.folderId) {
      return tree?.folders.find((folder) => folder.id === selection.folderId)?.name ?? '目录';
    }
    if (selection.q) return '搜索结果';
    return '全部笔记';
  }, [
    captureView,
    favoritesFolderId,
    inTrash,
    selection.favorites,
    selection.folderId,
    selection.q,
    selection.tagIds,
    tree,
  ]);

  const filterCount =
    (selection.folderId ? 1 : 0) +
    (selection.tagIds.length > 0 ? 1 : 0) +
    (inTrash ? 1 : 0) +
    (selection.rootOnly ? 1 : 0);

  /* ------------------------------ render bits ----------------------------- */

  const renderBanner = () =>
    banner ? (
      <div className="mobile-banner" data-testid="banner">
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
        if (closeAfterSelect) {
          closeDrawer();
          setFilterOpen(false);
          setProfileOpen(false);
        }
      }}
      onOpenNote={(id) => {
        onOpenNote(id);
        setView('editor');
        if (closeAfterSelect) {
          closeDrawer();
          setFilterOpen(false);
        }
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
        if (closeAfterSelect) {
          closeDrawer();
          setFilterOpen(false);
          setProfileOpen(false);
        }
      }}
      favoritesFolderId={favoritesFolderId}
      favoritesInboxFolderId={favoritesInboxFolderId}
      favoriteCount={favoriteCount}
      favoritesPending={favoritesPending}
      onOpenFavorites={() => {
        onOpenFavorites();
        setView('list');
        if (closeAfterSelect) {
          closeDrawer();
          setFilterOpen(false);
          setProfileOpen(false);
        }
      }}
      onOpenFavoriteFolder={(folderId) => {
        onOpenFavoriteFolder(folderId);
        setView('list');
        if (closeAfterSelect) {
          closeDrawer();
          setFilterOpen(false);
          setProfileOpen(false);
        }
      }}
      onCreateFavorite={() => {
        onCreateFavorite();
        if (closeAfterSelect) {
          closeDrawer();
          setFilterOpen(false);
        }
      }}
    />
  );

  /** Phone header: collapsing large title, inline search, sort and filter. */
  const renderTitleHeader = () => (
    <header
      className={`mobile-header mobile-titlebar ${titleCollapsed ? 'is-collapsed' : ''}`}
      data-testid="mobile-titlebar"
      data-collapsed={titleCollapsed ? 'true' : 'false'}
    >
      <div className="mobile-titlebar-row">
        <div className="mobile-titlebar-text">
          <h1 className="mobile-large-title">{scopeTitle}</h1>
          <span className="mobile-title-meta" data-testid="mobile-title-count">
            {captureView
              ? `${captureCount} 条`
              : selection.favorites
                ? `${notes.length} 条收藏`
                : `${notes.length} 篇`}
          </span>
        </div>
        <div className="mobile-titlebar-actions">
          <SyncBadge status={status} />
          {titleCollapsed && (
            <button
              type="button"
              className={headerButton}
              aria-label="搜索笔记"
              data-testid="mobile-search-expand"
              onClick={() => {
                setTitleCollapsed(false);
                window.setTimeout(() => searchInputRef.current?.focus(), 60);
              }}
            >
              <Search size={19} />
            </button>
          )}
          {!captureView && !selection.favorites && (
            <ActionMenu
              label="排序"
              testId="mobile-sort"
              trigger={<ArrowDownUp size={18} />}
            >
              {SORT_OPTIONS.map((option) => (
                <MenuItem
                  key={option.value}
                  testId={`mobile-sort-${option.value}`}
                  icon={sort === option.value ? <Check size={14} /> : <span className="menu-icon-spacer" />}
                  onClick={() => onSortChange(option.value)}
                >
                  {option.label}
                </MenuItem>
              ))}
            </ActionMenu>
          )}
          <ActionMenu label="更多" testId="mobile-more">
            <MenuItem
              icon={<CheckSquare size={14} />}
              testId="mobile-enter-selection"
              onClick={() => (batch.selection.active ? batch.exit() : batch.enter())}
            >
              {batch.selection.active ? '退出多选' : '选择笔记'}
            </MenuItem>
            <MenuItem
              icon={<ListFilter size={14} />}
              testId="mobile-open-filter-menu"
              onClick={() => setFilterOpen(true)}
            >
              筛选与目录
            </MenuItem>
            {!inTrash && (
              <MenuItem
                icon={<BookmarkPlus size={14} />}
                testId="mobile-open-favorite"
                onClick={onCreateFavorite}
              >
                收藏链接
              </MenuItem>
            )}
            {selection.folderId && !inTrash && (
              <MenuItem icon={<MessageSquareText size={14} />} onClick={onAskFolderAi}>
                问 AI
              </MenuItem>
            )}
            <MenuItem
              icon={<Trash2 size={14} />}
              testId="mobile-open-trash"
              onClick={() => (inTrash ? onSelect({ ...EMPTY_SELECTION }) : onOpenTrash())}
            >
              {inTrash ? '退出回收站' : '打开回收站'}
            </MenuItem>
            <div className="menu-separator" />
            <MenuItem icon={<Settings2 size={14} />} onClick={() => setProfileOpen(true)}>
              我的与设置
            </MenuItem>
          </ActionMenu>
        </div>
      </div>

      {!captureView && (
        <div className="mobile-search-row">
          <div className="mobile-search-field">
            <Search size={15} className="mobile-search-icon" />
            <input
              ref={searchInputRef}
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                if (searchTooShort) return;
                onSearchChange(searchDraft.trim());
              }}
              placeholder="搜索笔记"
              aria-label="搜索笔记"
              data-testid="mobile-search-input"
            />
            {searchDraft && (
              <button
                type="button"
                className="mobile-search-clear"
                aria-label="清除搜索"
                data-testid="mobile-search-clear"
                onClick={() => {
                  setSearchDraft('');
                  onSearchChange('');
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button
            type="button"
            className="mobile-filter-button"
            aria-label="筛选与目录"
            data-testid="mobile-filter-button"
            onClick={() => {
              hapticTap();
              setFilterOpen(true);
            }}
          >
            <ListFilter size={16} />
            {filterCount > 0 && <span className="mobile-filter-badge">{filterCount}</span>}
          </button>
        </div>
      )}

      {searchTooShort && (
        <div className="mobile-search-hint">搜索词至少 {MIN_SEARCH_QUERY_LENGTH} 个字符</div>
      )}
    </header>
  );

  /** Foldable / tablet header: keeps the drawer, adds a surface switch instead of the tab bar. */
  const renderWideListHeader = () => (
    <header className="mobile-header flex shrink-0 items-center gap-1 px-2 pt-[env(safe-area-inset-top)]">
      {!showNavPane && (
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
      <SegmentedControl
        value={activeTab === 'me' ? 'notes' : activeTab}
        ariaLabel="切换列表"
        testIdPrefix="wide-tab"
        className="mobile-surface-switch"
        options={[
          { value: 'notes', label: '笔记' },
          { value: 'favorites', label: '收藏' },
          { value: 'captures', label: '速记' },
        ]}
        onChange={(tab) => handleTabChange(tab as MobileTab)}
      />
      <span className="min-w-0 flex-1" />
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
      <button
        type="button"
        className={headerButton}
        aria-label="新建笔记"
        onClick={() => void handleCreateNote()}
        data-testid="mobile-new-note"
      >
        <Plus size={20} />
      </button>
    </header>
  );

  const renderListContent = () => {
    if (captureView) {
      return (
        <CaptureList
          captures={captures}
          loading={capturesLoading}
          hasInbox={Boolean(inboxNoteId)}
          hideHeader={compact}
          onOpen={(entry) => {
            onOpenCapture(entry);
            setView('editor');
          }}
          composerSignal={composerSignal}
          onSubmitCapture={onSubmitCapture}
        />
      );
    }
    if (selection.favorites) {
      return (
        <FavoriteList
          notes={notes}
          selectedId={selectedNoteId}
          onOpen={openNote}
          loading={loading}
          hideHeader={compact}
          platform={favoritePlatform}
          onPlatformChange={onFavoritePlatformChange}
          onCreateFavorite={onCreateFavorite}
          onAskAi={onAskFolderAi}
          batch={batch}
          openRowId={openRowId}
          onOpenRowIdChange={onOpenRowIdChange}
          onTogglePin={onTogglePin}
        />
      );
    }
    return (
      <MobileNoteList
        notes={notes}
        tags={tree?.tags ?? []}
        selectedNoteId={selectedNoteId}
        loading={loading}
        inTrash={inTrash}
        grouped={sort === 'updated'}
        batch={batch}
        openRowId={openRowId}
        onOpenRowIdChange={onOpenRowIdChange}
        onOpen={openNote}
        onTogglePin={onTogglePin}
        onCreateNote={() => void handleCreateNote()}
        onRefresh={refreshNotes}
        onScrollOffset={(offset) => setTitleCollapsed(offset > TITLE_COLLAPSE_OFFSET)}
        emptyTitle={selection.q ? `没有匹配「${selection.q}」的笔记` : '这里还没有笔记'}
        emptyHint={
          selection.q
            ? `搜索词至少 ${MIN_SEARCH_QUERY_LENGTH} 个字符，且只匹配正文与标题`
            : '点右下角的按钮写下第一篇'
        }
      />
    );
  };

  const renderListPane = (wide: boolean) => (
    <div
      className={wide ? 'mobile-list-pane flex min-h-0 flex-col' : 'flex min-h-0 flex-1 flex-col'}
      data-testid="mobile-list-pane"
    >
      {wide ? renderWideListHeader() : renderTitleHeader()}
      {renderBanner()}
      <div className="min-h-0 flex-1">{renderListContent()}</div>
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
          className="mobile-title-input"
          data-testid="note-title-input"
        />
        {inTrash && <span className="mobile-trash-chip">回收站</span>}
        <SyncBadge status={status} />
        {selectedNoteId && (
          <ActionMenu label="笔记操作" testId="mobile-note-actions" trigger={<MoreHorizontal size={19} />}>
            <MenuItem icon={<Download size={14} />} onClick={onExportNote}>
              导出当前笔记
            </MenuItem>
            {!inTrash && selectedNote && (
              <>
                <MenuItem icon={<Share2 size={14} />} onClick={onShareNote} testId="mobile-note-share">
                  分享笔记
                </MenuItem>
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
          <div className="mobile-empty h-full">
            <span className="mobile-empty-icon">
              <Sparkles size={22} />
            </span>
            <div className="mobile-empty-title">{loading ? '加载中…' : '选择或新建一篇笔记'}</div>
            {!loading && (
              <button
                type="button"
                className="button-primary mt-2"
                onClick={() => void handleCreateNote()}
                data-testid="mobile-empty-create"
              >
                <Plus size={15} />
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
          className="mobile-bar-action"
          onClick={() => setAiOpen(true)}
          data-testid="open-ai-mobile"
        >
          <Sparkles size={16} />
          AI
        </button>
        <button
          type="button"
          className="mobile-bar-action"
          onClick={() => setTagsOpen(true)}
          data-testid="open-tags"
        >
          <Tags size={16} />
          标签
        </button>
        <button
          type="button"
          className="mobile-bar-action"
          aria-label="设置"
          onClick={onOpenSettings}
          data-testid="open-settings"
        >
          <SettingsToolbarIcon size={18} />
        </button>
      </footer>
    </div>
  );

  const selectionActive = batch.selection.active;
  const orderedIds = notes.map((note) => note.id);

  const renderBottomDock = () => {
    if (view === 'editor') return null;
    if (selectionActive) {
      return (
        <SelectionToolbar
          variant="mobile"
          {...selectionToolbarProps({
            batch,
            notes,
            inTrash,
            orderedIds,
            onMove: onOpenMovePicker,
            onTags: onOpenBatchTags,
          })}
        />
      );
    }
    return (
      <MobileTabBar
        active={activeTab}
        favoritesBadge={favoritesPending}
        capturesBadge={captureCount}
        onChange={handleTabChange}
      />
    );
  };

  return (
    <div
      className={`mobile-shell flex flex-col bg-canvas text-foreground ${
        selectionActive ? 'is-selecting' : ''
      }`}
      data-testid="workspace"
      data-layout={layout}
      // Same contract as the desktop shell: exposes the active note without list-ordering
      // assumptions (the inbox note is pinned and always sorts first).
      data-active-note-id={selectedNoteId ?? ''}
    >
      {compact ? (
        view === 'editor' ? (
          renderEditorPane(false)
        ) : profileOpen ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <MobileProfilePage
              user={user}
              status={status}
              pendingCount={pendingCount}
              theme={settings.theme}
              serverUrl={serverUrl}
              trashCount={tree?.counts.trashed ?? 0}
              favoriteCount={favoriteCount}
              onBack={() => {
                // 我的 is a detour: leaving it always lands on the notes home, keeping the
                // trash/search context so the user does not lose their place.
                setProfileOpen(false);
                setView('list');
                onSelect({ ...EMPTY_SELECTION, archived: selection.archived, q: selection.q });
              }}
              onOpenSettings={onOpenSettings}
              onOpenTrash={onOpenTrash}
              onOpenFavorites={() => {
                setProfileOpen(false);
                onOpenFavorites();
              }}
              onImport={onImport}
              onExportVault={onExportVault}
              onThemeChange={(theme) => onSaveSettings({ theme })}
              onSyncNow={onSyncNow}
              onLogout={onLogout}
            />
            {renderBottomDock()}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {renderListPane(false)}
            {renderBottomDock()}
          </div>
        )
      ) : (
        <div className={`mobile-layout-wide mobile-layout-${layout} flex min-h-0 flex-1`}>
          {showNavPane && (
            <div className="mobile-nav-pane flex min-h-0 flex-col" data-testid="mobile-nav-pane">
              <div className="min-h-0 flex-1">{renderSidebar('rail', false)}</div>
              <div className="mobile-pane-footer">
                <span className="mobile-pane-avatar">
                  {Array.from(user.displayName.trim())[0]?.toUpperCase() ?? '?'}
                </span>
                <span className="mobile-pane-name">{user.displayName}</span>
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

      {!compact && selectionActive && view !== 'editor' && (
        <SelectionToolbar
          variant="desktop"
          {...selectionToolbarProps({
            batch,
            notes,
            inTrash,
            orderedIds,
            onMove: onOpenMovePicker,
            onTags: onOpenBatchTags,
          })}
        />
      )}

      <MobileFab action={fabAction} onClick={handleFab} />

      {/* filter sheet: the phone-width replacement for the navigation drawer */}
      {filterOpen && (
        <div
          className="mobile-backdrop"
          onClick={() => setFilterOpen(false)}
          data-testid="filter-backdrop"
        >
          <div
            className="mobile-sheet mobile-filter-sheet"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="筛选与目录"
            data-testid="filter-sheet"
          >
            <span className="sheet-grabber" aria-hidden />
            <div className="sheet-header">
              <span className="sheet-title">筛选与目录</span>
              <button
                type="button"
                className="icon-button"
                onClick={() => setFilterOpen(false)}
                aria-label="关闭筛选"
                data-testid="close-filter"
              >
                <X size={18} />
              </button>
            </div>
            <div className="min-h-0 flex-1">{renderSidebar('drawer', true)}</div>
          </div>
        </div>
      )}

      {/* slide-in navigation drawer (foldable / tablet widths only) */}
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
            <div className="mobile-pane-footer">
              <span className="mobile-pane-avatar">
                {Array.from(user.displayName.trim())[0]?.toUpperCase() ?? '?'}
              </span>
              <span className="mobile-pane-name">{user.displayName}</span>
              <button
                type="button"
                className="button-ghost !min-h-8 px-2 text-[11px]"
                onClick={() => setProfileOpen(true)}
                data-testid="drawer-open-profile"
              >
                我的
              </button>
            </div>
          </div>
        </div>
      )}

      {/* tag sheet for the open note */}
      {tagsOpen && (
        <div className="mobile-backdrop" onClick={() => setTagsOpen(false)}>
          <div
            className="mobile-sheet"
            onClick={(event) => event.stopPropagation()}
            data-testid="tag-sheet"
          >
            <span className="sheet-grabber" aria-hidden />
            <div className="sheet-header">
              <span className="sheet-title">标签</span>
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
            className="mobile-sheet mobile-sheet-tall"
            onClick={(event) => event.stopPropagation()}
            data-testid="ai-sheet"
          >
            <span className="sheet-grabber" aria-hidden />
            <div className="sheet-header">
              <span className="sheet-title">AI 助手</span>
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
