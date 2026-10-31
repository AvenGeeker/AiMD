import { useEffect, useRef, useState } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';
import { NOTE_KEYS, noteDocName, type StampFormat } from '@aimarkdown/shared';
import { collabUrl } from '../lib/config.js';
import { getBridge } from '../lib/platform.js';

/**
 * Renderer for the Electron quick-capture window.
 *
 * The input editor is deliberately a *local buffer*, not a CodeMirror binding to the inbox
 * `Y.Text`. On submit we append the buffer to the CRDT document and clear only the local editor.
 * Binding the editor directly to the body looks tempting, but it makes the editor share CRDT
 * ranges with the whole inbox: clearing the capture box then deletes note content, and typing
 * before the document has synced writes at the wrong offsets.
 *
 * Everything else is deliberately absent — no sidebar, no preview, no menus — because the window
 * exists to be summoned, typed into and dismissed without breaking flow.
 */

interface CaptureContext {
  noteId: string | null;
  serverUrl: string;
  stampFormat: StampFormat;
}

type Status = 'idle' | 'saving' | 'saved' | 'error';

/** Mirrors the server's `formatStamp` so an offline capture looks identical. */
export function formatStamp(format: StampFormat, at: Date = new Date()): string {
  if (format === 'none') return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = at.getFullYear();
  const mo = pad(at.getMonth() + 1);
  const d = pad(at.getDate());
  const hh = pad(at.getHours());
  const mm = pad(at.getMinutes());
  if (format === 'heading') return `## ${y}-${mo}-${d} ${hh}:${mm}`;
  return `- [${hh}:${mm}]`;
}

/**
 * Append one capture to the end of the inbox body.
 *
 * The document end is the CRDT-safe insertion point: a simultaneous edit in the middle of the
 * note merges without either side losing content. The editor buffer is never part of this
 * transaction, so clearing it cannot delete existing notes.
 */
export function appendQuickCapture(
  body: Y.Text,
  text: string,
  format: StampFormat,
  at: Date = new Date(),
): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return '';

  const stamp = formatStamp(format, at);
  const current = body.toString();
  const separator =
    current.length === 0
      ? ''
      : current.endsWith('\n\n')
        ? ''
        : current.endsWith('\n')
          ? '\n'
          : '\n\n';
  const payload = `${separator}${stamp ? `${stamp}\n\n` : ''}${trimmed}`;

  body.doc?.transact(() => {
    body.insert(body.length, payload);
  });
  return payload;
}

export function QuickCapture() {
  const bridge = getBridge()?.quickCapture;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [context, setContext] = useState<CaptureContext | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadContext = () => {
      void bridge
        ?.getContext()
        .then((value) => {
          if (cancelled) return;
          const next: CaptureContext = {
            noteId: value.noteId,
            serverUrl: value.serverUrl,
            stampFormat: (value.stampFormat as StampFormat) ?? 'heading',
          };
          // The shell stores the account's inbox id; logging in or switching accounts updates it.
          // Keep the same object when nothing changed so showing the window does not rebuild the
          // document/provider on every hotkey press.
          setContext((prev) =>
            prev &&
            prev.noteId === next.noteId &&
            prev.serverUrl === next.serverUrl &&
            prev.stampFormat === next.stampFormat
              ? prev
              : next,
          );
        })
        .catch(() => {
          if (!cancelled) {
            setStatus('error');
            setMessage('无法读取速记上下文');
          }
        });
    };
    loadContext();
    const stopShown = bridge?.onShown?.(loadContext);
    return () => {
      cancelled = true;
      stopShown?.();
    };
  }, [bridge]);

  // Escape must work even before the editor exists (e.g. while context is still loading).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void bridge?.dismiss().catch(() => undefined);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bridge]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !context?.noteId) return;

    const doc = new Y.Doc();
    const body = doc.getText(NOTE_KEYS.body);

    // Local cache first: a capture must survive even when the server is unreachable. Wait for the
    // cache before accepting input so an early save never appends to a half-loaded document.
    let persistence: IndexeddbPersistence | null = null;
    try {
      persistence = new IndexeddbPersistence(noteDocName(context.noteId), doc);
    } catch {
      persistence = null;
    }

    let provider: HocuspocusProvider | null = null;
    let disposed = false;

    const flush = () => {
      try {
        provider?.flushPendingUpdates();
        provider?.forceSync();
      } catch {
        // The provider may already be closed during app shutdown.
      }
    };

    const connectProvider = () => {
      if (disposed) return;
      provider = new HocuspocusProvider({
        url: collabUrl(context.serverUrl),
        name: noteDocName(context.noteId!),
        document: doc,
        // Read the token on every (re)connect: the main window may have refreshed it since this
        // hidden window first loaded, and the capture window stays alive in the tray.
        token: async () => (await getBridge()?.getTokens())?.accessToken ?? '',
        onAuthenticationFailed: () => {
          // Never rotate the refresh token from this hidden second window: the main window may be
          // rotating the same token at the same time, and refresh-token replay detection would
          // revoke the whole session. The capture is already written to IndexedDB; showing the
          // main window refreshes the token, and the next capture/onShown reconnect picks it up.
          setStatus('error');
          setMessage('登录已过期，速记已本地保存，请打开主窗口重新登录');
        },
      });
    };

    connectProvider();

    const stopFlush = bridge?.onFlush?.(flush);
    const stopShown = bridge?.onShown?.(() => {
      viewRef.current?.focus();
      flush();
      void provider?.connect();
    });

    const dismiss = () => {
      void bridge?.dismiss().catch(() => undefined);
    };

    const submit = async () => {
      const view = viewRef.current;
      if (!view) return;
      const text = view.state.doc.toString().trim();
      // An empty capture is a plain dismiss rather than an error.
      if (text.length === 0) {
        dismiss();
        return;
      }
      setStatus('saving');

      try {
        // If the window was just opened, give IndexedDB a brief chance to load the existing body
        // first. Yjs would merge either way, but waiting avoids a needless local rebase.
        if (persistence && !persistence.synced) {
          await Promise.race([
            persistence.whenSynced,
            new Promise((resolve) => window.setTimeout(resolve, 1_000)),
          ]);
        }
        if (disposed) return;

        appendQuickCapture(body, text, context.stampFormat);
        // Clear only the local input buffer. The Y.Text body is untouched.
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '' } });
        setStatus('saved');
        setMessage(null);
        flush();
      } catch (error) {
        setStatus('error');
        setMessage(`保存失败：${error instanceof Error ? error.message : String(error)}`);
        return;
      }

      // The window is hidden rather than destroyed, so the provider stays alive and flushes the
      // update in the background; IndexedDB already holds it if we are offline.
      window.setTimeout(dismiss, 150);
    };

    const extensions: Extension[] = [
      keymap.of([
        {
          key: 'Escape',
          run: () => {
            dismiss();
            return true;
          },
        },
        {
          key: 'Mod-Enter',
          run: () => {
            void submit();
            return true;
          },
        },
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      history(),
      markdown({ base: markdownLanguage }),
      EditorView.lineWrapping,
      EditorView.theme({
        '&': { height: '100%', fontSize: '14px', backgroundColor: 'transparent' },
        '.cm-scroller': { fontFamily: 'var(--font-mono)', padding: '8px 0' },
        '&.cm-focused': { outline: 'none' },
      }),
    ];

    const view = new EditorView({ state: EditorState.create({ doc: '', extensions }), parent: host });
    viewRef.current = view;
    view.focus();

    return () => {
      disposed = true;
      stopFlush?.();
      stopShown?.();
      view.destroy();
      viewRef.current = null;
      provider?.disconnect();
      provider?.destroy();
      // Keep the IndexedDB database itself: it is the offline cache for the inbox note.
      if (persistence) void Promise.resolve(persistence.destroy()).catch(() => undefined);
      doc.destroy();
    };
  }, [bridge, context]);

  if (!context) {
    return <div className="p-4 text-xs text-muted">正在加载…</div>;
  }

  if (!context.noteId) {
    return (
      <div className="p-4 text-xs text-danger" data-testid="capture-missing-inbox">
        还没有收集箱笔记。请先在主窗口登录一次，系统会自动创建。
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-surface" data-testid="quick-capture">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-[11px] font-medium text-muted">速记 → 收集箱</span>
        <span
          className={`text-[11px] ${
            status === 'error' ? 'text-danger' : status === 'saved' ? 'text-success' : 'text-muted'
          }`}
          data-testid="capture-status"
        >
          {status === 'saving'
            ? '保存中…'
            : status === 'saved'
              ? '已保存'
              : status === 'error'
                ? (message ?? '同步失败')
                : '离线也会保存'}
        </span>
      </div>
      <div ref={hostRef} className="min-h-0 flex-1" data-testid="capture-editor" />
      <div className="border-t border-border px-3 py-1.5 text-[11px] text-muted">
        ⌘/Ctrl + Enter 保存 · Esc 关闭
      </div>
    </div>
  );
}
