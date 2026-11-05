import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  BookmarkPlus,
  Columns2,
  Download,
  Eye,
  FilePlus2,
  FileText,
  Import,
  NotebookPen,
  PanelLeft,
  PanelRight,
  PencilLine,
  Settings2,
  Trash2,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { deriveTitle } from '@aimarkdown/markdown';
import type { NoteListDto, NoteSort, NoteSummaryDto, SettingsDto } from '@aimarkdown/shared';
import { DEFAULT_SETTINGS, MIN_SEARCH_QUERY_LENGTH } from '@aimarkdown/shared';
import { AuthProvider, useAuth } from './lib/auth.js';
import { currentBaseUrl, request } from './lib/api.js';
import { isQuickCaptureWindow } from './lib/platform.js';
import { consumeOpenFavoriteRequest, subscribeOpenFavorite } from './lib/nativeActions.js';
import { applyStatusBarStyle } from './lib/statusBar.js';
import { consumeNextShare, subscribeShares } from './lib/shareInbox.js';
import { useIsMobile } from './hooks/useIsMobile.js';
import { syncManager } from './lib/sync.js';
import {
  applySettingsToShell,
  markMenuReady,
  reportMenuState,
  reportSyncStatus,
  subscribeMenuCommands,
} from './lib/desktop.js';
import {
  downloadNote,
  downloadVault,
  importFiles,
  invalidateStructure,
  useCreateFolder,
  useCreateNote,
  useUpsertTag,
  useDeleteFolder,
  useDeleteNote,
  useNotes,
  useQuickCapture,
  useRestoreNote,
  useSettings,
  useTree,
  useUpdateFolder,
  useUpdateNote,
  useUpdateSettings,
} from './lib/queries.js';
import {
  useNoteDocument,
  useNoteMeta,
  useNoteTagIds,
  writeNoteMeta,
  writeNoteTagIds,
} from './hooks/useNoteDocument.js';
import { Sidebar, EMPTY_SELECTION, type SidebarSelection } from './components/Sidebar.js';
import { NoteList } from './components/NoteList.js';
import { CaptureList } from './components/CaptureList.js';
import { MarkdownEditor, type EditorMode, type EditorReveal } from './components/MarkdownEditor.js';
import { NoteHeader } from './components/NoteHeader.js';
import { Inspector, type InspectorTab } from './components/Inspector.js';
import { TitleBar } from './components/TitleBar.js';
import { SettingsDialog, type SettingsTab } from './components/SettingsDialog.js';
import { MobileShell } from './components/MobileShell.js';
import { AuthView } from './components/AuthView.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { QuickCapture } from './components/QuickCapture.js';
import { useQuickCaptures, type QuickCaptureEntry } from './lib/quickCaptures.js';
import { useAppleNotes } from './hooks/useAppleNotes.js';
import { AppleNotesPreviewDialog } from './components/AppleNotesPreviewDialog.js';
import { FavoriteList } from './components/FavoriteList.js';
import { FavoriteCaptureDialog } from './components/FavoriteCaptureDialog.js';
import type { SharedCapture } from './lib/shareInbox.js';
import { FolderAiPanel } from './components/FolderAiPanel.js';
import { FavoriteNoteBar } from './components/FavoriteNoteBar.js';
import { CommandPalette, type PaletteCommand } from './components/CommandPalette.js';
import { ConfirmDialog } from './components/ui/ConfirmDialog.js';
import { PromptDialog } from './components/ui/PromptDialog.js';
import { useNoteBatch } from './hooks/useNoteBatch.js';
import { UndoToast } from './components/UndoToast.js';
import { FolderPickerSheet } from './components/FolderPickerSheet.js';
import { BatchTagSheet } from './components/BatchTagSheet.js';

/** Per-device UI preferences for the two desktop rails. */
const SIDEBAR_VISIBLE_KEY = 'aimarkdown.sidebar-visible';
const OUTLINE_VISIBLE_KEY = 'aimarkdown.outline-visible';
/** Per-device note list ordering, shared by the phone shell and the desktop rail. */
const NOTE_SORT_KEY = 'aimarkdown.note-sort';

const NOTE_SORT_VALUES: NoteSort[] = ['updated', 'created', 'title', 'position', 'collected'];

function readNoteSort(): NoteSort {
  try {
    const raw = window.localStorage.getItem(NOTE_SORT_KEY) as NoteSort | null;
    // `collected` is reserved for the favourites surface and is never a manual choice.
    if (raw && NOTE_SORT_VALUES.includes(raw) && raw !== 'collected') return raw;
  } catch {
    /* storage blocked: fall back to the default */
  }
  return 'updated';
}

interface CaptureReveal extends EditorReveal {
  noteId: string;
}

function readSidebarVisible(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(SIDEBAR_VISIBLE_KEY) !== '0';
  } catch {
    return true;
  }
}

/** The outline rail starts hidden so the editor gets the width. */
function readOutlineVisible(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(OUTLINE_VISIBLE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Resolve the effective theme, following the OS when set to `system`. */
function useResolvedDark(theme: SettingsDto['theme']): boolean {
  const [systemDark, setSystemDark] = useState(() =>
    typeof window === 'undefined'
      ? false
      : window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener('change', listener);
    setSystemDark(query.matches);
    return () => query.removeEventListener('change', listener);
  }, []);
  return theme === 'dark' || (theme === 'system' && systemDark);
}

function Workspace() {
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();

  const [selection, setSelection] = useState<SidebarSelection>(EMPTY_SELECTION);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [source, setSource] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>('appearance');
  const [banner, setBanner] = useState<string | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(readSidebarVisible);
  const [outlineVisible, setOutlineVisible] = useState(readOutlineVisible);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('outline');
  const [captureView, setCaptureView] = useState(false);
  const [captureReveal, setCaptureReveal] = useState<CaptureReveal | null>(null);
  const [favoriteDialogOpen, setFavoriteDialogOpen] = useState(false);
  const [sharedCapture, setSharedCapture] = useState<SharedCapture | null>(null);
  const [folderAiOpen, setFolderAiOpen] = useState(false);
  const [favoritePlatform, setFavoritePlatform] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [composerSignal, setComposerSignal] = useState(0);
  const [folderPrompt, setFolderPrompt] = useState<{ open: boolean; parentId: string | null }>({
    open: false,
    parentId: null,
  });
  const [folderConfirm, setFolderConfirm] = useState<string | null>(null);
  const [noteConfirm, setNoteConfirm] = useState<string | null>(null);
  const [noteSort, setNoteSort] = useState<NoteSort>(readNoteSort);
  /** The one list row currently revealing its swipe actions (phone shell). */
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [movePickerOpen, setMovePickerOpen] = useState(false);
  const [batchTagOpen, setBatchTagOpen] = useState(false);
  const firstFilterEffect = useRef(true);
  const creatingNoteRef = useRef(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const appleNotes = useAppleNotes();

  // Renders the mobile single-pane shell instead of the three-pane desktop layout.
  const mobile = useIsMobile();

  const treeQuery = useTree();
  const settingsQuery = useSettings();
  const settings = settingsQuery.data ?? { ...DEFAULT_SETTINGS };
  const dark = useResolvedDark(settings.theme);

  const notesQuery = useNotes(
    {
      folderId: selection.folderId,
      rootOnly: selection.rootOnly,
      tagIds: selection.tagIds,
      q: selection.q || undefined,
      archived: selection.archived,
      sort: selection.favorites ? 'collected' : noteSort,
      recursive: selection.recursive,
      sourcePlatform: selection.favorites ? favoritePlatform || undefined : undefined,
    },
    Boolean(user),
  );
  const notes = notesQuery.data?.items ?? [];
  // The capture view always shows the inbox, even when the note-list filter currently says trash.
  const inTrash = selection.archived === 'only' && !captureView;

  const createNote = useCreateNote();
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();
  const restoreNote = useRestoreNote();
  const createFolder = useCreateFolder();
  const updateFolder = useUpdateFolder();
  const deleteFolder = useDeleteFolder();
  const updateSettings = useUpdateSettings();
  const upsertTag = useUpsertTag();
  const quickCapture = useQuickCapture();

  const { doc, awareness, status } = useNoteDocument(selectedNoteId);
  // Keep the inbox document warm so the capture count and list are live even when another note is
  // open. This is the same ref-counted document the editor uses when the inbox itself is selected.
  const inboxDocument = useNoteDocument(settings.inboxNoteId);
  const captures = useQuickCaptures(inboxDocument.doc);
  const meta = useNoteMeta(doc);
  const tagIds = useNoteTagIds(doc);

  /* ------------------------------- selection ------------------------------ */

  // Changing the filter clears the selection; the effect below then picks the first note of the
  // *settled* result set.
  const filterKey = `${selection.folderId ?? '*'}|${selection.rootOnly}|${selection.tagIds.join(',')}|${selection.q}|${selection.archived}|${selection.favorites}|${selection.recursive}|${favoritePlatform}`;
  useEffect(() => {
    // The initial selection is already null; clearing it again after a fast "new note" click
    // can race the create mutation and send the editor back to the inbox.
    if (firstFilterEffect.current) {
      firstFilterEffect.current = false;
      return;
    }
    if (creatingNoteRef.current) return;
    setSelectedNoteId(null);
  }, [filterKey]);

  /**
   * Auto-select the first note when nothing is selected.
   *
   * Two guards matter here. Waiting for `isFetching` to settle stops us picking from a partial
   * list — otherwise a newly created note loses the selection race to whatever was already cached
   * (the pinned inbox note sorts first). And never overriding an explicit `selectedNoteId` keeps
   * the editor on the note the user actually opened, even if the current filter would hide it.
   */
  useEffect(() => {
    if (creatingNoteRef.current) return;
    if (inTrash) return;
    if (selectedNoteId !== null) return;
    if (notesQuery.isFetching) return;
    setSelectedNoteId(notes[0]?.id ?? null);
  }, [notes, selectedNoteId, inTrash, notesQuery.isFetching]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);

  // Immersive system bars: the native shells draw edge-to-edge, so the bar icon colour has to
  // follow the resolved theme. A no-op in browsers and the Electron shell.
  useEffect(() => {
    applyStatusBarStyle(dark);
  }, [dark]);

  useEffect(() => {
    if (!user || !settings.favoritesInboxFolderId) return;
    const openShared = () => {
      void consumeNextShare().then((shared) => {
        if (!shared) return;
        setSharedCapture(shared);
        setFavoriteDialogOpen(true);
      });
    };
    openShared();
    return subscribeShares(openShared);
  }, [user, settings.favoritesInboxFolderId]);

  useEffect(() => {
    const openFavorite = () => {
      if (!consumeOpenFavoriteRequest()) return;
      setSharedCapture(null);
      setFavoriteDialogOpen(true);
    };
    openFavorite();
    return subscribeOpenFavorite(openFavorite);
  }, []);

  // Keep the Electron tray honest about connectivity, and push synced settings into the shell so
  // the global hotkey follows changes made on any device. Both are no-ops in a browser tab.
  useEffect(() => {
    reportSyncStatus(status, syncManager.pendingCount);
  }, [status, notesQuery.dataUpdatedAt]);

  useEffect(() => {
    if (!settingsQuery.data) return;
    void applySettingsToShell(settingsQuery.data);
  }, [settingsQuery.data]);

  // The native menu is a second surface for the same TitleBar controls. Report the values it
  // needs to stay truthful: radio mode, rail checkboxes, sync label and account details.
  useEffect(() => {
    if (!user) return;
    reportMenuState({
      authenticated: true,
      syncStatus: status,
      pendingCount: syncManager.pendingCount,
      mode: settings.editorMode,
      sidebarVisible,
      outlineVisible,
      hasSelectedNote: selectedNoteId !== null,
      user: {
        displayName: user.displayName,
        email: user.email,
        createdAt: user.createdAt,
      },
      appleNotesAvailable: appleNotes.available,
      appleNotesEnabled: appleNotes.status?.settings.enabled ?? false,
      appleNotesRunning: appleNotes.status?.running ?? false,
      appleNotesPhase: appleNotes.status?.phase ?? 'disabled',
      appleNotesLastSyncAt: appleNotes.status?.lastSyncAt ?? null,
      appleNotesAttention:
        (appleNotes.status?.conflictCount ?? 0) + (appleNotes.status?.readOnlyCount ?? 0),
    });
  }, [
    user,
    status,
    notesQuery.dataUpdatedAt,
    settings.editorMode,
    sidebarVisible,
    outlineVisible,
    selectedNoteId,
    appleNotes.available,
    appleNotes.status,
  ]);

  // Flush pending CRDT writes before the tab is hidden or closed.
  useEffect(() => {
    const flush = () => syncManager.flush();
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', flush);
    };
  }, []);

  /* -------------------------------- actions ------------------------------- */

  const flash = useCallback((message: string) => {
    setBanner(message);
    window.setTimeout(() => setBanner(null), 3000);
  }, []);

  /* ------------------------- multi-select batch actions ------------------------ */

  const availableNoteIds = useMemo(() => notes.map((note) => note.id), [notes]);

  const noteBatch = useNoteBatch({
    availableIds: availableNoteIds,
    selectedNoteId,
    onSelectedNoteGone: () => setSelectedNoteId(null),
    flash,
  });

  const handleSortChange = useCallback((sort: NoteSort) => {
    setNoteSort(sort);
    try {
      window.localStorage.setItem(NOTE_SORT_KEY, sort);
    } catch {
      // A blocked storage partition only loses the preference.
    }
  }, []);

  /** Inline phone search: only the query changes, so the capture/favourite view stays put. */
  const handleSearchChange = useCallback((q: string) => {
    setSelection((prev) => (prev.q === q ? prev : { ...prev, q }));
  }, []);

  const refreshNotes = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['notes'] });
    await queryClient.invalidateQueries({ queryKey: ['tree'] });
    await queryClient.refetchQueries({ queryKey: ['notes'] });
  }, [queryClient]);

  const handleSyncNow = useCallback(() => {
    syncManager.flush();
  }, []);

  const handleSaveSettings = useCallback(
    (patch: Partial<SettingsDto>) => {
      void updateSettings.mutateAsync(patch);
    },
    [updateSettings],
  );

  const openSettings = useCallback((tab: SettingsTab = 'appearance') => {
    setSettingsInitialTab(tab);
    setSettingsOpen(true);
  }, []);

  const handleSidebarSelect = useCallback(
    (next: SidebarSelection) => {
      setCaptureView(false);
      setCaptureReveal(null);
      // Leaving the capture view can land on a filter that was already selected (for example
      // clicking 回收站 while it was active). The filter key would not change then, so clear the
      // inbox selection explicitly to let the normal auto-selection pick a note in that filter.
      if (captureView) setSelectedNoteId(null);
      setSelection(next);
    },
    [captureView],
  );

  const handleOpenNote = useCallback((id: string) => {
    setCaptureView(false);
    setCaptureReveal(null);
    setSelection((prev) => ({ ...prev, archived: 'false' }));
    setSelectedNoteId(id);
  }, []);

  const handleOpenCaptures = useCallback(() => {
    setCaptureView(true);
    setCaptureReveal(null);
    if (settings.inboxNoteId) setSelectedNoteId(settings.inboxNoteId);
  }, [settings.inboxNoteId]);

  const handleOpenFavorites = useCallback(() => {
    if (!settings.favoritesFolderId) return;
    setCaptureView(false);
    setCaptureReveal(null);
    setSelectedNoteId(null);
    setFolderAiOpen(false);
    setSelection({
      ...EMPTY_SELECTION,
      folderId: settings.favoritesFolderId,
      favorites: true,
      recursive: true,
    });
  }, [settings.favoritesFolderId]);

  const handleOpenFavoriteFolder = useCallback((folderId: string) => {
    setCaptureView(false);
    setCaptureReveal(null);
    setSelectedNoteId(null);
    setFolderAiOpen(false);
    setSelection({
      ...EMPTY_SELECTION,
      folderId,
      favorites: true,
      recursive: true,
    });
  }, []);

  const handleCreateFavorite = useCallback(() => {
    setSharedCapture(null);
    setFavoriteDialogOpen(true);
  }, []);

  const folderName = useMemo(() => {
    if (!selection.folderId) return '收藏';
    return treeQuery.data?.folders.find((folder) => folder.id === selection.folderId)?.name ?? '收藏';
  }, [selection.folderId, treeQuery.data?.folders]);

  const handleOpenCapture = useCallback(
    (entry: QuickCaptureEntry) => {
      const inboxId = settings.inboxNoteId;
      if (!inboxId) return;
      setCaptureView(true);
      setSelectedNoteId(inboxId);
      setCaptureReveal({
        noteId: inboxId,
        line: entry.line,
        stampLabel: entry.stampLabel,
        nonce: Date.now(),
      });
    },
    [settings.inboxNoteId],
  );

  const handleCreateNote = useCallback(async () => {
    creatingNoteRef.current = true;
    setCaptureView(false);
    setCaptureReveal(null);
    try {
      const created = await createNote.mutateAsync({
        folderId: selection.folderId ?? null,
        tagIds: selection.tagIds,
      });
      setSelectedNoteId(created.id);
    } finally {
      // Let the selection commit first, then release the guard for genuine filter changes.
      window.setTimeout(() => {
        creatingNoteRef.current = false;
      }, 0);
    }
  }, [createNote, selection.folderId, selection.tagIds]);

  const handleSaveAiNote = useCallback(
    async (input: { title: string; body: string }) => {
      const created = await createNote.mutateAsync({
        title: input.title,
        body: input.body,
        folderId: selection.folderId ?? null,
      });
      setFolderAiOpen(false);
      handleOpenNote(created.id);
      flash('已保存为笔记');
    },
    [createNote, flash, handleOpenNote, selection.folderId],
  );

  const handleCreateFolder = useCallback((parentId: string | null) => {
    setFolderPrompt({ open: true, parentId });
  }, []);

  const handleCreateFolderSubmit = useCallback(
    async (name: string) => {
      await createFolder.mutateAsync({ name, parentId: folderPrompt.parentId });
      setFolderPrompt({ open: false, parentId: null });
    },
    [createFolder, folderPrompt.parentId],
  );

  const handleDeleteFolder = useCallback((id: string) => setFolderConfirm(id), []);

  const confirmDeleteFolder = useCallback(async () => {
    const id = folderConfirm;
    setFolderConfirm(null);
    if (!id) return;
    await deleteFolder.mutateAsync(id);
    if (selection.folderId === id) setSelection({ ...EMPTY_SELECTION });
  }, [deleteFolder, folderConfirm, selection.folderId]);

  const handleRenameFolder = useCallback(
    async (id: string, name: string) => {
      await updateFolder.mutateAsync({ id, patch: { name } });
    },
    [updateFolder],
  );

  const handleDropNote = useCallback(
    async (noteId: string, folderId: string | null) => {
      await updateNote.mutateAsync({ id: noteId, patch: { folderId } });
    },
    [updateNote],
  );

  const handleTitleChange = useCallback(
    (value: string) => {
      // Title edits go straight into the CRDT so they merge with other devices immediately.
      writeNoteMeta(doc, { title: value });
    },
    [doc],
  );

  const handleModeChange = useCallback(
    (mode: EditorMode) => {
      void updateSettings.mutateAsync({ editorMode: mode });
    },
    [updateSettings],
  );

  const handleToggleSidebar = useCallback(() => {
    setSidebarVisible((visible) => {
      const next = !visible;
      try {
        window.localStorage.setItem(SIDEBAR_VISIBLE_KEY, next ? '1' : '0');
      } catch {
        // A blocked storage partition only loses the preference; the toggle still works.
      }
      return next;
    });
  }, []);

  const handleOpenAi = useCallback(() => {
    setOutlineVisible(true);
    setInspectorTab('ai');
  }, []);

  const handleToggleOutline = useCallback(() => {
    setOutlineVisible((visible) => {
      const next = !visible;
      try {
        window.localStorage.setItem(OUTLINE_VISIBLE_KEY, next ? '1' : '0');
      } catch {
        // A blocked storage partition only loses the preference; the toggle still works.
      }
      return next;
    });
  }, []);

  const handleImport = useCallback(
    async (files: File[]) => {
      try {
        const result = await importFiles(files);
        flash(
          `导入完成：${result.createdNotes} 篇笔记，${result.createdFolders} 个目录` +
            (result.errors.length > 0 ? `，${result.errors.length} 个失败` : ''),
        );
        invalidateStructure(queryClient);
      } catch (error) {
        flash(`导入失败：${error instanceof Error ? error.message : String(error)}`);
      }
    },
    [flash, queryClient],
  );

  const handleExportVault = useCallback(async () => {
    try {
      await downloadVault();
    } catch (error) {
      flash(`导出失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [flash]);

  const handleExportNote = useCallback(async () => {
    if (!selectedNoteId) return;
    try {
      await downloadNote(selectedNoteId, displayTitle);
    } catch (error) {
      flash(`导出失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [selectedNoteId, flash]);

  /** Wikilinks resolve by title; the server search gives us the match. */
  const resolveWikilink = useCallback(async (target: string): Promise<string | null> => {
    if (target.trim().length < MIN_SEARCH_QUERY_LENGTH) return null;
    try {
      const result = await request<NoteListDto>('/notes', { query: { q: target, limit: 5 } });
      const exact = result.items.find((note) => note.title.toLowerCase() === target.toLowerCase());
      return (exact ?? result.items[0])?.id ?? null;
    } catch {
      return null;
    }
  }, []);

  // Quick capture no longer uses `window.prompt`: summoning it opens the capture view with the
  // inline composer expanded and focused, so typing starts immediately.
  const handleQuickCapture = useCallback(() => {
    const inboxId = settings.inboxNoteId;
    if (!inboxId) {
      flash('还没有收集箱笔记');
      return;
    }
    setCaptureView(true);
    setCaptureReveal(null);
    setSelectedNoteId(inboxId);
    setComposerSignal((value) => value + 1);
  }, [flash, settings.inboxNoteId]);

  const handleSubmitCapture = useCallback(
    async (text: string) => {
      const inboxId = settings.inboxNoteId;
      if (!inboxId) throw new Error('还没有收集箱笔记');
      await quickCapture.mutateAsync({ noteId: inboxId, text });
    },
    [quickCapture, settings.inboxNoteId],
  );

  const handleAppleNotesSync = useCallback(() => {
    if (!appleNotes.status?.settings.enabled) openSettings('apple');
    else void appleNotes.syncNow();
  }, [appleNotes, openSettings]);

  /* ------------------------------ command palette ----------------------------- */

  const paletteRecents = useNotes({ sort: 'updated', limit: 6 }, Boolean(user));

  const searchPaletteNotes = useCallback(async (q: string) => {
    const result = await request<NoteListDto>('/notes', { query: { q, limit: 8 } });
    return result.items;
  }, []);

  const paletteCommands = useMemo<PaletteCommand[]>(() => {
    const commands: PaletteCommand[] = [
      {
        id: 'new-note',
        label: '新建笔记',
        icon: FilePlus2,
        keywords: 'new note 新建 笔记',
        run: () => void handleCreateNote(),
      },
      {
        id: 'capture',
        label: '记一条速记',
        icon: NotebookPen,
        keywords: 'capture quick 速记 快速笔记',
        run: handleQuickCapture,
      },
      {
        id: 'favorite-new',
        label: '收藏链接',
        icon: BookmarkPlus,
        keywords: 'favorite save 收藏 链接',
        run: handleCreateFavorite,
      },
      {
        id: 'favorites-open',
        label: '打开收藏',
        icon: Bookmark,
        keywords: 'favorites 收藏 列表',
        run: handleOpenFavorites,
      },
      {
        id: 'trash',
        label: '打开回收站',
        icon: Trash2,
        keywords: 'trash 回收站',
        run: () => handleSidebarSelect({ ...EMPTY_SELECTION, archived: 'only' }),
      },
      { id: 'mode-split', label: '视图：分栏', icon: Columns2, keywords: 'split view 分栏', run: () => handleModeChange('split') },
      { id: 'mode-edit', label: '视图：编辑', icon: PencilLine, keywords: 'edit view 编辑', run: () => handleModeChange('edit') },
      { id: 'mode-preview', label: '视图：预览', icon: Eye, keywords: 'preview view 预览', run: () => handleModeChange('preview') },
      { id: 'import', label: '导入 Markdown / ZIP', icon: Import, keywords: 'import 导入', run: () => importInputRef.current?.click() },
      { id: 'export-vault', label: '导出整个笔记库', icon: Download, keywords: 'export 导出 zip', run: () => void handleExportVault() },
      {
        id: 'settings-appearance',
        label: '设置：外观',
        icon: Settings2,
        keywords: 'settings theme 设置 外观 主题',
        run: () => openSettings('appearance'),
      },
      {
        id: 'settings-editor',
        label: '设置：编辑',
        icon: Settings2,
        keywords: 'settings editor 设置 编辑 字号',
        run: () => openSettings('editor'),
      },
      {
        id: 'settings-capture',
        label: '设置：速记与桌面',
        icon: Settings2,
        keywords: 'settings hotkey 设置 速记 快捷键 窗口',
        run: () => openSettings('capture'),
      },
      {
        id: 'settings-ai',
        label: '设置：AI 助手',
        icon: Settings2,
        keywords: 'settings ai 设置 助手',
        run: () => openSettings('ai'),
      },
    ];
    if (!mobile) {
      commands.splice(
        5,
        0,
        {
          id: 'toggle-sidebar',
          label: sidebarVisible ? '隐藏左侧栏' : '显示左侧栏',
          icon: PanelLeft,
          keywords: 'sidebar 侧栏 左侧',
          run: handleToggleSidebar,
        },
        {
          id: 'toggle-outline',
          label: outlineVisible ? '隐藏大纲' : '显示大纲',
          icon: PanelRight,
          keywords: 'outline 大纲 右侧',
          run: handleToggleOutline,
        },
      );
    }
    if (appleNotes.available) {
      commands.push({
        id: 'settings-apple',
        label: '设置：macOS 备忘录',
        icon: Settings2,
        keywords: 'apple notes 备忘录 同步',
        run: () => openSettings('apple'),
      });
    }
    return commands;
  }, [
    appleNotes.available,
    handleCreateFavorite,
    handleCreateNote,
    handleExportVault,
    handleModeChange,
    handleOpenFavorites,
    handleQuickCapture,
    handleSidebarSelect,
    handleToggleOutline,
    handleToggleSidebar,
    mobile,
    openSettings,
    outlineVisible,
    sidebarVisible,
  ]);

  const paletteElement = (
    <CommandPalette
      open={paletteOpen}
      onClose={() => setPaletteOpen(false)}
      commands={paletteCommands}
      recents={paletteRecents.data?.items ?? []}
      folders={treeQuery.data?.folders ?? []}
      onOpenNote={handleOpenNote}
      onSelectFolder={(folderId) => handleSidebarSelect({ ...EMPTY_SELECTION, folderId })}
      searchNotes={searchPaletteNotes}
    />
  );



  // One handler for every native menu action, routed into the exact same code the TitleBar uses.
  // The listener is installed before `markMenuReady()` so clicks queued during window creation are
  // delivered instead of lost.
  useEffect(() => {
    const unsubscribe = subscribeMenuCommands((command) => {
      switch (command) {
        case 'new-note':
          void handleCreateNote();
          break;
        case 'quick-capture':
          void handleQuickCapture();
          break;
        case 'open-favorite':
          handleCreateFavorite();
          break;
        case 'import':
          importInputRef.current?.click();
          break;
        case 'export-note':
          void handleExportNote();
          break;
        case 'export-vault':
          void handleExportVault();
          break;
        case 'open-ai':
          handleOpenAi();
          break;
        case 'open-settings':
          openSettings();
          break;
        case 'mode-split':
          handleModeChange('split');
          break;
        case 'mode-edit':
          handleModeChange('edit');
          break;
        case 'mode-preview':
          handleModeChange('preview');
          break;
        case 'toggle-sidebar':
          handleToggleSidebar();
          break;
        case 'toggle-outline':
          handleToggleOutline();
          break;
        case 'logout':
          void logout();
          break;
        case 'apple-notes-sync':
          handleAppleNotesSync();
          break;
        case 'apple-notes-settings':
          openSettings('apple');
          break;
      }
    });
    markMenuReady();
    return unsubscribe;
  }, [
    handleCreateNote,
    handleQuickCapture,
    handleExportNote,
    handleExportVault,
    handleOpenAi,
    handleModeChange,
    handleToggleSidebar,
    handleToggleOutline,
    logout,
    handleAppleNotesSync,
  ]);

  // ⌘/Ctrl+Shift+Q captures from the browser too; the OS-level hotkey is the desktop shell's job.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.shiftKey && event.key.toLowerCase() === 'q') {
        event.preventDefault();
        void handleQuickCapture();
      }
      if (mod && event.key.toLowerCase() === 'n' && event.shiftKey) {
        event.preventDefault();
        void handleCreateNote();
      }
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleQuickCapture, handleCreateNote]);

  const displayTitle = useMemo(() => {
    if (!selectedNoteId) return '';
    return meta.titleManual ? meta.title : deriveTitle(source, meta.title);
  }, [meta.title, meta.titleManual, selectedNoteId, source]);

  const selectedNote = useMemo(
    () => notes.find((note) => note.id === selectedNoteId),
    [notes, selectedNoteId],
  );

  /**
   * Refresh the list and tree after the derived title settles.
   *
   * Titles live in the CRDT document, and the sidebar reads them from the Postgres mirror, which
   * the server only updates on the debounced store hook. Without this, renaming a note (or typing
   * the first heading of a new one) leaves the sidebar showing the stale title until something
   * else happens to invalidate the query. Debounced so it does not refetch on every keystroke.
   */
  useEffect(() => {
    if (!selectedNoteId || !displayTitle) return;
    const timer = window.setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: ['notes'] });
      void queryClient.invalidateQueries({ queryKey: ['tree'] });
    }, 1_500);
    return () => window.clearTimeout(timer);
  }, [selectedNoteId, displayTitle, queryClient]);

  const editorReveal =
    captureReveal && captureReveal.noteId === selectedNoteId ? captureReveal : null;

  if (!user) return null;

  /* --------------------------- mobile-only handlers --------------------------- */

  const handleTogglePin = useCallback(
    (note: NoteSummaryDto) => {
      void updateNote.mutateAsync({ id: note.id, patch: { pinned: !note.pinned } });
    },
    [updateNote],
  );

  const handleDeleteNote = useCallback(
    (id: string) => {
      if (inTrash) {
        setNoteConfirm(id);
        return;
      }
      void (async () => {
        await deleteNote.mutateAsync({ id, permanent: false });
        if (id === selectedNoteId) setSelectedNoteId(null);
      })();
    },
    [deleteNote, inTrash, selectedNoteId],
  );

  const confirmDeleteNote = useCallback(async () => {
    const id = noteConfirm;
    setNoteConfirm(null);
    if (!id) return;
    await deleteNote.mutateAsync({ id, permanent: true });
    if (id === selectedNoteId) setSelectedNoteId(null);
  }, [deleteNote, noteConfirm, selectedNoteId]);

  const folderPromptParent = folderPrompt.parentId
    ? treeQuery.data?.folders.find((folder) => folder.id === folderPrompt.parentId)?.name
    : undefined;

  const dialogElements = (
    <>
      <PromptDialog
        open={folderPrompt.open}
        title={folderPromptParent ? `在「${folderPromptParent}」下新建目录` : '新建目录'}
        placeholder="目录名称"
        submitLabel="创建"
        busy={createFolder.isPending}
        onSubmit={handleCreateFolderSubmit}
        onClose={() => setFolderPrompt({ open: false, parentId: null })}
      />
      <ConfirmDialog
        open={folderConfirm !== null}
        title="删除该目录？"
        body="目录内的笔记会回到根层级（不会被删除）。"
        confirmLabel="删除"
        danger
        busy={deleteFolder.isPending}
        onConfirm={confirmDeleteFolder}
        onClose={() => setFolderConfirm(null)}
      />
      <ConfirmDialog
        open={noteConfirm !== null}
        title="彻底删除该笔记？"
        body="此操作不可撤销。"
        confirmLabel="彻底删除"
        danger
        busy={deleteNote.isPending}
        onConfirm={confirmDeleteNote}
        onClose={() => setNoteConfirm(null)}
      />
    </>
  );

  const handleRestoreNote = useCallback(
    (id: string) => {
      void (async () => {
        await restoreNote.mutateAsync(id);
        if (id === selectedNoteId) setSelectedNoteId(null);
      })();
    },
    [restoreNote, selectedNoteId],
  );

  const handleCreateTag = useCallback(
    async (name: string) => {
      try {
        return await upsertTag.mutateAsync({ name });
      } catch (error) {
        flash(`创建标签失败：${error instanceof Error ? error.message : String(error)}`);
        return undefined;
      }
    },
    [flash, upsertTag],
  );

  const importInput = (
    <input
      ref={importInputRef}
      type="file"
      multiple
      accept=".md,.markdown,.txt,.zip"
      className="hidden"
      data-testid="import-input"
      onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        if (files.length > 0) void handleImport(files);
        event.target.value = '';
      }}
    />
  );

  const favoriteDialog = (
    <FavoriteCaptureDialog
      open={favoriteDialogOpen}
      initial={sharedCapture}
      onClose={() => {
        setFavoriteDialogOpen(false);
        setSharedCapture(null);
      }}
      onSaved={(noteId, folderId) => {
        setFavoriteDialogOpen(false);
        setSharedCapture(null);
        // Open the category the note actually landed in. Jumping to 待分类 made a successfully
        // classified favourite look like it had fallen into the wrong place.
        setSelection({
          ...EMPTY_SELECTION,
          folderId: folderId ?? settings.favoritesFolderId,
          favorites: true,
          recursive: true,
        });
        setSelectedNoteId(noteId);
        setFavoritePlatform('');
        invalidateStructure(queryClient);
        flash(folderId ? '已保存收藏，已自动选择分类' : '已保存收藏');
      }}
    />
  );

  const folderAiPanel = (
    <FolderAiPanel
      open={folderAiOpen}
      folderId={selection.folderId ?? null}
      folderName={folderName}
      onClose={() => setFolderAiOpen(false)}
      onOpenNote={handleOpenNote}
      onSaveNote={handleSaveAiNote}
    />
  );

  const batchSheets = (
    <>
      <FolderPickerSheet
        open={movePickerOpen}
        count={noteBatch.selection.ids.length}
        folders={treeQuery.data?.folders ?? []}
        busy={noteBatch.busy}
        onClose={() => setMovePickerOpen(false)}
        onPick={(folderId) => {
          setMovePickerOpen(false);
          noteBatch.move(folderId);
        }}
        onCreateFolder={(parentId) => {
          setMovePickerOpen(false);
          handleCreateFolder(parentId);
        }}
      />
      <BatchTagSheet
        open={batchTagOpen}
        count={noteBatch.selection.ids.length}
        tags={treeQuery.data?.tags ?? []}
        busy={noteBatch.busy}
        onCreate={handleCreateTag}
        onClose={() => setBatchTagOpen(false)}
        onApply={(tagIds) => {
          setBatchTagOpen(false);
          noteBatch.addTags(tagIds);
        }}
      />
      <UndoToast
        state={noteBatch.undo}
        onUndo={noteBatch.runUndo}
        onDismiss={noteBatch.dismissUndo}
      />
      <ConfirmDialog
        open={noteBatch.confirm !== null}
        title={noteBatch.confirm?.title ?? ''}
        body={noteBatch.confirm?.body}
        confirmLabel={noteBatch.confirm?.confirmLabel ?? '确认'}
        danger
        busy={noteBatch.busy}
        onConfirm={() => noteBatch.confirm?.onConfirm()}
        onClose={noteBatch.dismissConfirm}
      />
    </>
  );

  if (mobile) {
    return (
      <>
        {importInput}
        <MobileShell
          tree={treeQuery.data}
          settings={settings}
          dark={dark}
          notes={notes}
          loading={notesQuery.isFetching}
          inTrash={inTrash}
          selection={selection}
          selectedNoteId={selectedNoteId}
          doc={doc}
          source={source}
          awareness={awareness}
          status={status}
          tagIds={tagIds}
          displayTitle={displayTitle}
          user={user}
          banner={banner}
          inboxNoteId={settings.inboxNoteId}
          captures={captures}
          capturesLoading={Boolean(settings.inboxNoteId) && inboxDocument.status === 'connecting' && captures.length === 0}
          captureView={captureView}
          captureCount={captures.length}
          composerSignal={composerSignal}
          onSubmitCapture={handleSubmitCapture}
          onOpenPalette={() => setPaletteOpen(true)}
          reveal={editorReveal}
          settingsOpen={settingsOpen}
          tagBusy={updateNote.isPending || upsertTag.isPending}
          onSelect={handleSidebarSelect}
          onOpenNote={handleOpenNote}
          onOpenCaptures={handleOpenCaptures}
          onOpenCapture={handleOpenCapture}
          onCreateNote={handleCreateNote}
          onCreateFolder={(parentId) => void handleCreateFolder(parentId)}
          onDeleteFolder={(id) => void handleDeleteFolder(id)}
          onRenameFolder={(id, name) => void handleRenameFolder(id, name)}
          onDropNote={(noteId, folderId) => void handleDropNote(noteId, folderId)}
          onTogglePin={handleTogglePin}
          onDeleteNote={handleDeleteNote}
          onRestoreNote={handleRestoreNote}
          onTitleChange={handleTitleChange}
          onSourceChange={setSource}
          onModeChange={handleModeChange}
          onOpenSettings={() => openSettings()}
          onCloseSettings={() => setSettingsOpen(false)}
          onExportNote={() => void handleExportNote()}
          onLogout={() => void logout()}
          onCreateTag={handleCreateTag}
          resolveWikilink={resolveWikilink}
          onNavigate={handleOpenNote}
          favoritesFolderId={settings.favoritesFolderId}
          favoritesInboxFolderId={settings.favoritesInboxFolderId}
          favoriteCount={treeQuery.data?.counts.favorites ?? 0}
          favoritesPending={treeQuery.data?.counts.favoritesPending ?? 0}
          favoritePlatform={favoritePlatform}
          onFavoritePlatformChange={setFavoritePlatform}
          onOpenFavorites={handleOpenFavorites}
          onOpenFavoriteFolder={handleOpenFavoriteFolder}
          onCreateFavorite={handleCreateFavorite}
          onAskFolderAi={() => setFolderAiOpen(true)}
          batch={noteBatch}
          sort={noteSort}
          onSortChange={handleSortChange}
          openRowId={openRowId}
          onOpenRowIdChange={setOpenRowId}
          movePickerOpen={movePickerOpen}
          onOpenMovePicker={() => setMovePickerOpen(true)}
          onCloseMovePicker={() => setMovePickerOpen(false)}
          batchTagOpen={batchTagOpen}
          onOpenBatchTags={() => setBatchTagOpen(true)}
          onCloseBatchTag={() => setBatchTagOpen(false)}
          serverUrl={currentBaseUrl()}
          pendingCount={syncManager.pendingCount}
          onSaveSettings={handleSaveSettings}
          onSyncNow={handleSyncNow}
          onImport={() => importInputRef.current?.click()}
          onExportVault={() => void handleExportVault()}
          onOpenTrash={() => handleSidebarSelect({ ...EMPTY_SELECTION, archived: 'only' })}
          onSearchChange={handleSearchChange}
          onRequestCapture={handleQuickCapture}
          refreshNotes={refreshNotes}
        />
        {settingsOpen && (
          <SettingsDialog
            settings={settings}
            onSave={async (patch) => updateSettings.mutateAsync(patch)}
            onClose={() => setSettingsOpen(false)}
            appleNotes={appleNotes}
            initialTab={settingsInitialTab}
          />
        )}
        {paletteElement}
        {dialogElements}
        {favoriteDialog}
        {folderAiPanel}
        {batchSheets}
      </>
    );
  }

  return (
    <div
      className="flex h-screen flex-col bg-background text-foreground"
      data-testid="workspace"
      // Exposes the selection so tests do not have to infer it from list ordering (the inbox note
      // is pinned and always sorts first, which makes `.first()` misleading).
      data-active-note-id={selectedNoteId ?? ''}
    >
      {importInput}
      <TitleBar
        onOpenPalette={() => setPaletteOpen(true)}
        syncStatus={status}
        pendingCount={syncManager.pendingCount}
        mode={settings.editorMode}
        onModeChange={handleModeChange}
        sidebarVisible={sidebarVisible}
        onToggleSidebar={handleToggleSidebar}
        outlineVisible={outlineVisible}
        onToggleOutline={handleToggleOutline}
        onOpenSettings={() => openSettings()}
        onOpenAi={handleOpenAi}
        onExportVault={handleExportVault}
        onImport={() => importInputRef.current?.click()}
        appleNotesAvailable={appleNotes.available}
        appleNotesStatus={appleNotes.status}
        onAppleNotesSync={handleAppleNotesSync}
        user={user}
        onLogout={() => void logout()}
      />

      {banner && (
        <div className="border-b border-border bg-accent/10 px-3 py-1.5 text-xs text-accent" data-testid="banner">
          {banner}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {sidebarVisible && (
          <Sidebar
            tree={treeQuery.data}
            selection={selection}
            onSelect={handleSidebarSelect}
            onOpenNote={handleOpenNote}
            onCreateNote={() => void handleCreateNote()}
            onCreateFolder={(parentId) => void handleCreateFolder(parentId)}
            onDeleteFolder={(id) => void handleDeleteFolder(id)}
            onRenameFolder={(id, name) => void handleRenameFolder(id, name)}
            onDropNote={(noteId, folderId) => void handleDropNote(noteId, folderId)}
            inboxNoteId={settings.inboxNoteId}
            captureCount={captures.length}
            capturesActive={captureView}
            onOpenCaptures={handleOpenCaptures}
            favoritesFolderId={settings.favoritesFolderId}
            favoritesInboxFolderId={settings.favoritesInboxFolderId}
            favoriteCount={treeQuery.data?.counts.favorites ?? 0}
            favoritesPending={treeQuery.data?.counts.favoritesPending ?? 0}
            onOpenFavorites={handleOpenFavorites}
            onOpenFavoriteFolder={handleOpenFavoriteFolder}
            onCreateFavorite={handleCreateFavorite}
          />
        )}

        {captureView ? (
          <CaptureList
            captures={captures}
            loading={Boolean(settings.inboxNoteId) && inboxDocument.status === 'connecting' && captures.length === 0}
            hasInbox={Boolean(settings.inboxNoteId)}
            onOpen={handleOpenCapture}
            composerSignal={composerSignal}
            onSubmitCapture={handleSubmitCapture}
          />
        ) : selection.favorites ? (
          <FavoriteList
            notes={notes}
            selectedId={selectedNoteId}
            onOpen={handleOpenNote}
            loading={notesQuery.isFetching}
            platform={favoritePlatform}
            onPlatformChange={setFavoritePlatform}
            onCreateFavorite={handleCreateFavorite}
            onAskAi={() => setFolderAiOpen(true)}
          />
        ) : (
          <NoteList
            notes={notes}
            selectedId={selectedNoteId}
            onOpen={handleOpenNote}
            inTrash={inTrash}
            loading={notesQuery.isFetching}
            onCreateNote={() => void handleCreateNote()}
            onAskAi={selection.folderId ? () => setFolderAiOpen(true) : undefined}
            onTogglePin={(note) => void updateNote.mutateAsync({ id: note.id, patch: { pinned: !note.pinned } })}
            onDelete={handleDeleteNote}
            onRestore={handleRestoreNote}
            batch={noteBatch}
            onOpenMovePicker={() => setMovePickerOpen(true)}
            onOpenBatchTags={() => setBatchTagOpen(true)}
          />
        )}

        <main className="editor-main flex min-h-0 min-w-0 flex-1 flex-col">
          {selectedNoteId && doc ? (
            <>
              <NoteHeader
                title={displayTitle}
                updatedAt={selectedNote?.contentUpdatedAt}
                pinned={selectedNote?.pinned ?? false}
                inTrash={inTrash}
                onTitleChange={handleTitleChange}
                onTogglePin={() => {
                  if (selectedNote) {
                    void updateNote.mutateAsync({ id: selectedNote.id, patch: { pinned: !selectedNote.pinned } });
                  }
                }}
                onExport={() => void handleExportNote()}
                onDelete={() => handleDeleteNote(selectedNoteId)}
                onRestore={() => handleRestoreNote(selectedNoteId)}
              />
              {selectedNote?.source ? (
                <FavoriteNoteBar note={selectedNote} tree={treeQuery.data} />
              ) : null}
              <MarkdownEditor
                noteId={selectedNoteId}
                doc={doc}
                awareness={awareness}
                mode={inTrash ? 'preview' : settings.editorMode}
                fontSize={settings.fontSize}
                dark={dark}
                onSourceChange={setSource}
                resolveWikilink={resolveWikilink}
                onNavigate={handleOpenNote}
                reveal={editorReveal}
              />
            </>
          ) : (
            <div className="empty-state flex-1">
              <span className="empty-state-icon">
                <FileText size={20} />
              </span>
              <div className="text-sm">{notesQuery.isFetching ? '正在加载…' : '选择或新建一篇笔记'}</div>
              {!notesQuery.isFetching && (
                <button type="button" className="button-secondary mt-1" onClick={() => void handleCreateNote()}>
                  新建笔记
                </button>
              )}
            </div>
          )}
        </main>

        {outlineVisible && (
          <Inspector
            activeTab={inspectorTab}
            onTabChange={setInspectorTab}
            noteId={selectedNoteId}
            doc={doc}
            source={source}
            createdAt={notes.find((note) => note.id === selectedNoteId)?.createdAt}
            updatedAt={notes.find((note) => note.id === selectedNoteId)?.contentUpdatedAt}
            inTrash={inTrash}
            onJump={(anchorId) => {
              const target = document.querySelector(`.markdown-preview #${CSS.escape(anchorId)}`);
              target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            onOpenSettings={() => openSettings('ai')}
            allTags={treeQuery.data?.tags ?? []}
            selectedTagIds={tagIds}
            tagBusy={updateNote.isPending || upsertTag.isPending}
            onCreateTag={async (name) => {
              try {
                return await upsertTag.mutateAsync({ name });
              } catch (error) {
                flash(`创建标签失败：${error instanceof Error ? error.message : String(error)}`);
                return undefined;
              }
            }}
            onToggleTags={(nextSelected) => {
              // Written straight into the CRDT so it works offline and merges across devices.
              writeNoteTagIds(doc, nextSelected);
            }}
          />
        )}
      </div>

      {paletteElement}
      {dialogElements}
      {batchSheets}

      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          onSave={async (patch) => updateSettings.mutateAsync(patch)}
          onClose={() => setSettingsOpen(false)}
          appleNotes={appleNotes}
          initialTab={settingsInitialTab}
        />
      )}

      {favoriteDialog}
      {folderAiPanel}

      {appleNotes.preview && (
        <AppleNotesPreviewDialog
          controller={appleNotes}
          onClose={appleNotes.clearPreview}
        />
      )}
    </div>
  );
}

function Gate() {
  const { status } = useAuth();

  // Signed-out windows keep the native menu installed but must not expose workspace actions.
  useEffect(() => {
    if (status !== 'authenticated') reportMenuState({ authenticated: false, user: null });
  }, [status]);

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted">
        正在连接…
      </div>
    );
  }
  if (status === 'anonymous') return <AuthView />;
  return <Workspace />;
}

export default function App() {
  // The Electron quick-capture window loads the same bundle but renders only the capture UI.
  if (isQuickCaptureWindow()) {
    return (
      <ErrorBoundary>
        <QuickCapture />
      </ErrorBoundary>
    );
  }
  return (
    <AuthProvider>
      <ErrorBoundary>
        <Gate />
      </ErrorBoundary>
    </AuthProvider>
  );
}
