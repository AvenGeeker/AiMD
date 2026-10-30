import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { MarkdownEditor, type EditorMode } from './components/MarkdownEditor.js';
import { Outline } from './components/Outline.js';
import { TagEditor } from './components/TagEditor.js';
import { TitleBar } from './components/TitleBar.js';
import { SettingsDialog } from './components/SettingsDialog.js';
import { MobileShell } from './components/MobileShell.js';
import { AuthView } from './components/AuthView.js';
import { QuickCapture } from './components/QuickCapture.js';

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
  const inTrash = selection.archived === 'only';

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
  const meta = useNoteMeta(doc);
  const tagIds = useNoteTagIds(doc);

  /* ------------------------------- selection ------------------------------ */

  // Changing the filter clears the selection; the effect below then picks the first note of the
  // *settled* result set.
  const filterKey = `${selection.folderId ?? '*'}|${selection.rootOnly}|${selection.tagIds.join(',')}|${selection.q}|${selection.archived}`;
  useEffect(() => {
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

  const handleCreateNote = useCallback(async () => {
    const created = await createNote.mutateAsync({
      folderId: selection.folderId ?? null,
      tagIds: selection.tagIds,
    });
    setSelectedNoteId(created.id);
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
    flash('已追加到收集箱');
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
        awareness={awareness}
        status={status}
        tagIds={tagIds}
        displayTitle={displayTitle}
        user={user}
        banner={banner}
        inboxNoteId={settings.inboxNoteId}
        tagBusy={updateNote.isPending || upsertTag.isPending}
        onSelect={setSelection}
        onOpenNote={setSelectedNoteId}
        onCreateNote={handleCreateNote}
        onCreateFolder={(parentId) => void handleCreateFolder(parentId)}
        onDeleteFolder={(id) => void handleDeleteFolder(id)}
        onRenameFolder={(id, name) => void handleRenameFolder(id, name)}
        onDropNote={(noteId, folderId) => void handleDropNote(noteId, folderId)}
        onTogglePin={handleTogglePin}
        onDeleteNote={handleDeleteNote}
        onRestoreNote={handleRestoreNote}
        onTitleChange={handleTitleChange}
        onModeChange={handleModeChange}
        onOpenSettings={() => setSettingsOpen(true)}
        onLogout={() => void logout()}
        onCreateTag={handleCreateTag}
        resolveWikilink={resolveWikilink}
        onNavigate={setSelectedNoteId}
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
        title={displayTitle}
        onTitleChange={handleTitleChange}
        titleEditable={Boolean(selectedNoteId) && !inTrash}
        syncStatus={status}
        pendingCount={syncManager.pendingCount}
        mode={settings.editorMode}
        onModeChange={handleModeChange}
        onOpenSettings={() => setSettingsOpen(true)}
        onExportNote={handleExportNote}
        onExportVault={handleExportVault}
        onImport={(files) => void handleImport(files)}
        userName={user.displayName}
        onLogout={() => void logout()}
      />

      {banner && (
        <div className="border-b border-border bg-accent/10 px-3 py-1.5 text-xs text-accent" data-testid="banner">
          {banner}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <Sidebar
          tree={treeQuery.data}
          selection={selection}
          onSelect={setSelection}
          onOpenNote={(id) => {
            setSelection((prev) => ({ ...prev, archived: 'false' }));
            setSelectedNoteId(id);
          }}
          onCreateNote={() => void handleCreateNote()}
          onCreateFolder={(parentId) => void handleCreateFolder(parentId)}
          onDeleteFolder={(id) => void handleDeleteFolder(id)}
          onRenameFolder={(id, name) => void handleRenameFolder(id, name)}
          onDropNote={(noteId, folderId) => void handleDropNote(noteId, folderId)}
          inboxNoteId={settings.inboxNoteId}
        />

        <NoteList
          notes={notes}
          selectedId={selectedNoteId}
          onOpen={setSelectedNoteId}
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
              onNavigate={setSelectedNoteId}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted">
              {notesQuery.isFetching ? '加载中…' : '选择或新建一篇笔记'}
            </div>
          )}
        </main>

        <Outline
          source={source}
          createdAt={notes.find((note) => note.id === selectedNoteId)?.createdAt}
          updatedAt={notes.find((note) => note.id === selectedNoteId)?.contentUpdatedAt}
          onJump={(anchorId) => {
            const target = document.querySelector(`.markdown-preview #${CSS.escape(anchorId)}`);
            target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
        >
          {selectedNoteId && !inTrash && (
            <TagEditor
              allTags={treeQuery.data?.tags ?? []}
              selectedIds={tagIds}
              busy={updateNote.isPending || upsertTag.isPending}
              onCreate={async (name) => {
                try {
                  return await upsertTag.mutateAsync({ name });
                } catch (error) {
                  flash(`创建标签失败：${error instanceof Error ? error.message : String(error)}`);
                  return undefined;
                }
              }}
              onToggle={(_tagId, nextSelected) => {
                // Written straight into the CRDT so it works offline and merges across devices.
                writeNoteTagIds(doc, nextSelected);
              }}
            />
          )}
        </Outline>
      </div>

      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          onSave={async (patch) => updateSettings.mutateAsync(patch)}
          onClose={() => setSettingsOpen(false)}
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
