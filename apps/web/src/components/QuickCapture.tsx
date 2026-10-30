import { useEffect, useRef, useState } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';
import { yCollab } from 'y-codemirror.next';
import { NOTE_KEYS, noteDocName, type StampFormat } from '@aimarkdown/shared';
import { collabUrl } from '../lib/config.js';
import { getBridge } from '../lib/platform.js';

/**
 * Renderer for the Electron quick-capture window.
 *
 * It binds a stripped-down CodeMirror to the same inbox `Y.Doc` the main window uses, so a
 * capture taken while the main window is open on that very note merges through CRDT instead of
 * racing it. Appending at the end of the body is what makes that safe.
 *
 * Everything else is deliberately absent — no sidebar, no preview, no menus — because the window
 * exists to be summoned, typed into and dismissed without breaking flow.
 */

interface CaptureContext {
  noteId: string | null;
  accessToken: string | null;
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

export function QuickCapture() {
  const bridge = getBridge()?.quickCapture;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [context, setContext] = useState<CaptureContext | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void bridge
      ?.getContext()
      .then((value) => {
        if (cancelled) return;
        setContext({
          noteId: value.noteId,
          accessToken: value.accessToken,
          serverUrl: value.serverUrl,
          stampFormat: (value.stampFormat as StampFormat) ?? 'heading',
        });
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('error');
          setMessage('无法读取速记上下文');
        }
      });
    return () => {
      cancelled = true;
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

    // Local cache first: a capture must survive even when the server is unreachable.
    let persistence: IndexeddbPersistence | null = null;
    try {
      persistence = new IndexeddbPersistence(noteDocName(context.noteId), doc);
    } catch {
      persistence = null;
    }

    const provider = context.accessToken
      ? new HocuspocusProvider({
          url: collabUrl(context.serverUrl),
          name: noteDocName(context.noteId),
          document: doc,
          token: context.accessToken,
          onAuthenticationFailed: () => {
            setStatus('error');
            setMessage('登录已过期，请重新打开主窗口登录');
          },
        })
      : null;

    const dismiss = () => {
      void bridge?.dismiss().catch(() => undefined);
    };

    const submit = () => {
      const view = viewRef.current;
      if (!view) return;
      const text = view.state.doc.toString().trim();
      // An empty capture is a plain dismiss rather than an error.
      if (text.length === 0) {
        dismiss();
        return;
      }
      setStatus('saving');

      const stamp = formatStamp(context.stampFormat);
      const current = body.toString();
      const separator = current.length === 0 || current.endsWith('\n\n') ? '' : '\n\n';
      const payload = `${separator}${stamp ? `${stamp}\n\n` : ''}${text}`;

      // Append at the document end: the CRDT-safe insertion point for a capture, so writing here
      // while another device edits the middle of the same note merges without losing either.
      doc.transact(() => {
        body.insert(body.length, payload);
      });

      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '' } });
      setStatus('saved');
      setMessage(null);
      // The window is hidden rather than destroyed, so the provider stays alive and flushes the
      // update in the background; IndexedDB already holds it if we are offline.
      window.setTimeout(dismiss, 120);
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
            submit();
            return true;
          },
        },
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      history(),
      markdown({ base: markdownLanguage }),
      EditorView.lineWrapping,
      yCollab(body, provider?.awareness ?? null, { undoManager: false }),
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
