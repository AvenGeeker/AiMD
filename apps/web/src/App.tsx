import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { deriveTitle } from '@aimarkdown/markdown';
import type { NoteListDto, NoteSummaryDto, SettingsDto } from '@aimarkdown/shared';
import { DEFAULT_SETTINGS, MIN_SEARCH_QUERY_LENGTH } from '@aimarkdown/shared';
import { AuthProvider, useAuth } from './lib/auth.js';
import { request } from './lib/api.js';
import { isQuickCaptureWindow } from './lib/platform.js';
import { useIsMobile } from './hooks/useIsMobile.js';
import { syncManager } from './lib/sync.js';
import { applySettingsToShell, reportSyncStatus } from './lib/desktop.js';
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
import { Inspector, type InspectorTab } from './components/Inspector.js';
import { TitleBar } from './components/TitleBar.js';
import { SettingsDialog } from './components/SettingsDialog.js';
import { MobileShell } from './components/MobileShell.js';
import { AuthView } from './components/AuthView.js';
import { QuickCapture } from './components/QuickCapture.js';
import { useQuickCaptures, type QuickCaptureEntry } from './lib/quickCaptures.js';
import { useAppleNotes } from './hooks/useAppleNotes.js';
import { AppleNotesPreviewDialog } from './components/AppleNotesPreviewDialog.js';

/** Per-device UI preferences for the two desktop rails. */
const SIDEBAR_VISIBLE_KEY = 'aimarkdown.sidebar-visible';
const OUTLINE_VISIBLE_KEY = 'aimarkdown.outline-visible';

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
  const [banner, setBanner] = useState<string | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(readSidebarVisible);
  const [outlineVisible, setOutlineVisible] = useState(readOutlineVisible);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('outline');
  const [captureView, setCaptureView] = useState(false);
  const [captureReveal, setCaptureReveal] = useState<CaptureReveal | null>(null);
  const firstFilterEffect = useRef(true);
  const creatingNoteRef = useRef(false);
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
      sort: 'updated',
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
  const filterKey = `${selection.folderId ?? '*'}|${selection.rootOnly}|${selection.tagIds.join(',')}|${selection.q}|${selection.archived}`;
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

  // Keep the Electron tray honest about connectivity, and push synced settings into the shell so
  // the global hotkey follows changes made on any device. Both are no-ops in a browser tab.
  useEffect(() => {
    reportSyncStatus(status, syncManager.pendingCount);
  }, [status, notesQuery.dataUpdatedAt]);

  useEffect(() => {
    if (!settingsQuery.data) return;
    void applySettingsToShell(settingsQuery.data);
  }, [settingsQuery.data]);

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

  const handleCreateFolder = useCallback(
    async (parentId: string | null) => {
      const name = window.prompt('目录名称');
      if (!name?.trim()) return;
      await createFolder.mutateAsync({ name: name.trim(), parentId });
    },
    [createFolder],
  );

  const handleDeleteFolder = useCallback(
    async (id: string) => {
      if (!window.confirm('删除该目录？目录内的笔记会回到根层级（不会被删除）。')) return;
      await deleteFolder.mutateAsync(id);
      if (selection.folderId === id) setSelection({ ...EMPTY_SELECTION });
    },
    [deleteFolder, selection.folderId],
  );

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

  const handleQuickCapture = useCallback(async () => {
    const inboxId = settings.inboxNoteId;
    if (!inboxId) {
      flash('还没有收集箱笔记');
      return;
    }
    const text = window.prompt('速记内容');
    if (!text?.trim()) return;
    await quickCapture.mutateAsync({ noteId: inboxId, text: text.trim() });
    flash('已记录，可在左侧「速记」查看');
  }, [flash, quickCapture, settings.inboxNoteId]);

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
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleQuickCapture, handleCreateNote]);

  const displayTitle = useMemo(() => {
    if (!selectedNoteId) return '';
    return meta.titleManual ? meta.title : deriveTitle(source, meta.title);
  }, [meta.title, meta.titleManual, selectedNoteId, source]);

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
      void (async () => {
        if (inTrash && !window.confirm('彻底删除该笔记？此操作不可撤销。')) return;
        await deleteNote.mutateAsync({ id, permanent: inTrash });
        if (id === selectedNoteId) setSelectedNoteId(null);
      })();
    },
    [deleteNote, inTrash, selectedNoteId],
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

  if (mobile) {
    return (
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
        reveal={editorReveal}
        tagBusy={updateNote.isPending || upsertTag.isPending}
        onSelect={handleSidebarSelect}
        onOpenNote={handleOpenNote}
        onOpenCaptures={handleOpenCaptures}
        onOpenCapture={handleOpenCapture}
        onCapture={() => void handleQuickCapture()}
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
        onOpenSettings={() => setSettingsOpen(true)}
        onLogout={() => void logout()}
        onCreateTag={handleCreateTag}
        resolveWikilink={resolveWikilink}
        onNavigate={handleOpenNote}
      />
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
      <TitleBar
        syncStatus={status}
        pendingCount={syncManager.pendingCount}
        mode={settings.editorMode}
        onModeChange={handleModeChange}
        sidebarVisible={sidebarVisible}
        onToggleSidebar={handleToggleSidebar}
        outlineVisible={outlineVisible}
        onToggleOutline={handleToggleOutline}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenAi={handleOpenAi}
        onExportNote={handleExportNote}
        onExportVault={handleExportVault}
        onImport={(files) => void handleImport(files)}
        appleNotesAvailable={appleNotes.available}
        appleNotesStatus={appleNotes.status}
        onAppleNotesSync={() => {
          if (!appleNotes.status?.settings.enabled) setSettingsOpen(true);
          else void appleNotes.syncNow();
        }}
        userName={user.displayName}
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
          />
        )}

        {captureView ? (
          <CaptureList
            captures={captures}
            loading={Boolean(settings.inboxNoteId) && inboxDocument.status === 'connecting' && captures.length === 0}
            hasInbox={Boolean(settings.inboxNoteId)}
            onOpen={handleOpenCapture}
            onCapture={() => void handleQuickCapture()}
          />
        ) : (
          <NoteList
            notes={notes}
            selectedId={selectedNoteId}
            onOpen={handleOpenNote}
            inTrash={inTrash}
            loading={notesQuery.isFetching}
            onTogglePin={(note) => void updateNote.mutateAsync({ id: note.id, patch: { pinned: !note.pinned } })}
            onDelete={(id) =>
              void (async () => {
                if (inTrash && !window.confirm('彻底删除该笔记？此操作不可撤销。')) return;
                await deleteNote.mutateAsync({ id, permanent: inTrash });
                if (id === selectedNoteId) setSelectedNoteId(null);
              })()
            }
            onRestore={(id) =>
              void (async () => {
                await restoreNote.mutateAsync(id);
                if (id === selectedNoteId) setSelectedNoteId(null);
              })()
            }
          />
        )}

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {selectedNoteId && doc ? (
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
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted">
              {notesQuery.isFetching ? '加载中…' : '选择或新建一篇笔记'}
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
            onOpenSettings={() => setSettingsOpen(true)}
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

      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          onSave={async (patch) => updateSettings.mutateAsync(patch)}
          onClose={() => setSettingsOpen(false)}
          appleNotes={appleNotes}
        />
      )}

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
  if (isQuickCaptureWindow()) return <QuickCapture />;
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
