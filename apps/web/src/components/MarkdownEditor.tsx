import { useEffect, useMemo, useRef } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { oneDark } from '@codemirror/theme-one-dark';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { NOTE_KEYS } from '@aimarkdown/shared';
import { uploadAttachment } from '../lib/queries.js';
import { isImageMime } from '@aimarkdown/shared';
import { Preview, useYTextValue } from './Preview.js';

/**
 * The markdown editor.
 *
 * CodeMirror is bound directly to the note's `Y.Text` through `y-codemirror.next`, so there is
 * no local copy of the document to reconcile: keystrokes become CRDT operations, remote
 * operations become editor transactions, and undo/redo runs through a Yjs `UndoManager` rather
 * than CodeMirror's own history (which would not understand remote changes).
 */

export type EditorMode = 'split' | 'edit' | 'preview';

/** A request to reveal one capture that was opened from the quick-capture list. */
export interface EditorReveal {
  /** Zero-based markdown line. */
  line: number;
  /** Heading text for preview-mode anchors; null for stamp-less captures. */
  stampLabel: string | null;
  /** Changes on every click so selecting the same capture twice reveals it again. */
  nonce: number;
}

export interface MarkdownEditorProps {
  /** Note id, used only for scoping attachment uploads. */
  noteId: string;
  /**
   * The note's CRDT document and awareness, owned by the app shell so the title bar, outline and
   * editor all observe one document instance.
   */
  doc: Y.Doc | null;
  awareness: Awareness | null;
  mode: EditorMode;
  fontSize: number;
  dark: boolean;
  /** Called with the debounced body text so the parent can render the outline and stats. */
  onSourceChange?(source: string): void;
  /** Resolves a wikilink target to a note id so the preview can navigate. */
  resolveWikilink?(target: string): Promise<string | null>;
  onNavigate?(noteId: string): void;
  reveal?: EditorReveal | null;
}

/** Insert markdown at the cursor, wrapping a selection when one exists. */
function surroundSelection(view: EditorView, before: string, after: string, placeholder: string): void {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  const text = selected.length > 0 ? `${before}${selected}${after}` : `${before}${placeholder}${after}`;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: {
      anchor: from + before.length,
      head: from + before.length + (selected.length > 0 ? selected.length : placeholder.length),
    },
  });
  view.focus();
}

export function MarkdownEditor(props: MarkdownEditorProps) {
  const { noteId, doc, awareness, mode, fontSize, dark, onSourceChange, resolveWikilink, onNavigate, reveal } =
    props;

  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const previewScrollRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  const bodyText = useMemo(() => (doc ? doc.getText(NOTE_KEYS.body) : null), [doc]);
  const undoManager = useMemo(
    () => (bodyText ? new Y.UndoManager(bodyText, { trackedOrigins: new Set([null]) }) : null),
    [bodyText],
  );
  useEffect(() => () => undoManager?.destroy(), [undoManager]);

  const source = useYTextValue(bodyText, 120);

  // Keep a stable ref so the effect below does not re-run on every source change.
  const sourceChangeRef = useRef(onSourceChange);
  sourceChangeRef.current = onSourceChange;
  useEffect(() => {
    sourceChangeRef.current?.(source);
  }, [source]);

  /* ------------------------------ CodeMirror ------------------------------ */

  useEffect(() => {
    const host = editorHostRef.current;
    if (!host || !bodyText || mode === 'preview') return;

    const uploadAndInsert = async (file: File): Promise<void> => {
      try {
        const uploaded = await uploadAttachment(file, noteId);
        const view = viewRef.current;
        if (!view) return;
        const snippet = isImageMime(file.type)
          ? `![${uploaded.filename}](${uploaded.url})`
          : `[${uploaded.filename}](${uploaded.url})`;
        const { from } = view.state.selection.main;
        view.dispatch({ changes: { from, insert: snippet } });
      } catch (error) {
        console.error('[editor] attachment upload failed', error);
      }
    };

    const extensions: Extension[] = [
      lineNumbers(),
      highlightSpecialChars(),
      foldGutter(),
      drawSelection(),
      dropCursor(),
      rectangularSelection(),
      indentOnInput(),
      bracketMatching(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      highlightSelectionMatches(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: true }),
      keymap.of([...defaultKeymap, ...searchKeymap, indentWithTab]),
      EditorView.lineWrapping,
      EditorState.readOnly.of(false),
      EditorView.theme({
        '&': { height: '100%', fontSize: `${fontSize}px` },
        '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-mono)' },
        '.cm-content': { padding: '16px 0' },
      }),
    ];

    // CRDT binding must come after the base extensions so its transaction handling wins.
    // `false` (not undefined) is what y-codemirror expects when there is no undo manager.
    const collab = yCollab(bodyText, awareness, { undoManager: undoManager ?? false });
    extensions.push(collab);
    extensions.push(keymap.of([...yUndoManagerKeymap]));

    if (dark) extensions.push(oneDark);

    extensions.push(
      EditorView.domEventHandlers({
        paste(event) {
          const files = Array.from(event.clipboardData?.files ?? []);
          if (files.length === 0) return false;
          event.preventDefault();
          void Promise.all(files.map(uploadAndInsert));
          return true;
        },
        drop(event) {
          const files = Array.from(event.dataTransfer?.files ?? []);
          if (files.length === 0) return false;
          event.preventDefault();
          void Promise.all(files.map(uploadAndInsert));
          return true;
        },
      }),
    );

    const state = EditorState.create({ doc: bodyText.toString(), extensions });
    const view = new EditorView({ state, parent: host });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Rebuilding the view on a font-size, theme or *mode* change is cheap and far simpler than
    // reconfiguring compartments; the document itself is untouched because it lives in Yjs.
    //
    // `mode` must be a dependency: preview-only unmounts the host element, so returning to
    // split/edit mounts a *new* div that has no EditorView attached. Without it the editor pane
    // comes back empty.
  }, [bodyText, awareness, undoManager, dark, fontSize, noteId, mode]);

  /* ------------------------------ scroll sync ----------------------------- */

  useEffect(() => {
    if (mode !== 'split') return;
    const view = viewRef.current;
    const preview = previewScrollRef.current;
    if (!view || !preview) return;

    let suppress = false;
    const onEditorScroll = () => {
      if (suppress) return;
      const scroller = view.scrollDOM;
      const ratio = scroller.scrollTop / Math.max(1, scroller.scrollHeight - scroller.clientHeight);
      suppress = true;
      preview.scrollTop = ratio * Math.max(1, preview.scrollHeight - preview.clientHeight);
      requestAnimationFrame(() => {
        suppress = false;
      });
    };
    view.scrollDOM.addEventListener('scroll', onEditorScroll, { passive: true });
    return () => view.scrollDOM.removeEventListener('scroll', onEditorScroll);
  }, [mode, source]);

  /* ------------------------------- commands ------------------------------- */

  const command = {
    bold: () => viewRef.current && surroundSelection(viewRef.current, '**', '**', '粗体'),
    italic: () => viewRef.current && surroundSelection(viewRef.current, '*', '*', '斜体'),
    code: () => viewRef.current && surroundSelection(viewRef.current, '`', '`', 'code'),
    link: () => viewRef.current && surroundSelection(viewRef.current, '[', '](https://)', '链接'),
    heading: () => {
      const view = viewRef.current;
      if (!view) return;
      const { from } = view.state.selection.main;
      const line = view.state.doc.lineAt(from);
      const text = line.text;
      const match = /^(#{1,6})\s/.exec(text);
      const nextLevel = match ? Math.min(6, (match[1] ?? '#').length + 1) : 1;
      const stripped = text.replace(/^#{1,6}\s/, '');
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: `${'#'.repeat(nextLevel)} ${stripped}` },
      });
      view.focus();
    },
    bullet: () => {
      const view = viewRef.current;
      if (!view) return;
      const { from } = view.state.selection.main;
      view.dispatch({ changes: { from, insert: '- ' } });
      view.focus();
    },
    task: () => {
      const view = viewRef.current;
      if (!view) return;
      const { from } = view.state.selection.main;
      view.dispatch({ changes: { from, insert: '- [ ] ' } });
      view.focus();
    },
  };

  /* ------------------------------- wikilinks ------------------------------ */

  const handlePreviewRendered = (root: HTMLElement) => {
    root.querySelectorAll<HTMLAnchorElement>('a.wikilink').forEach((anchor) => {
      anchor.onclick = async (event) => {
        event.preventDefault();
        const target = anchor.dataset.wikilink;
        if (!target || !resolveWikilink || !onNavigate) return;
        const id = await resolveWikilink(target);
        if (id) onNavigate(id);
        else anchor.classList.add('wikilink-missing');
      };
    });
  };

  /* ---------------------------- capture reveal ---------------------------- */

  useEffect(() => {
    if (!reveal) return;
    // In preview-only mode there is no CodeMirror instance; use the timestamp heading instead.
    if (mode === 'preview') {
      const preview = previewScrollRef.current;
      if (!preview) return;
      const heading = reveal.stampLabel
        ? Array.from(preview.querySelectorAll('h2')).find(
            (element) => element.textContent?.trim() === reveal.stampLabel,
          )
        : null;
      const target = heading ?? preview;
      const top =
        target === preview
          ? 0
          : target.getBoundingClientRect().top - preview.getBoundingClientRect().top + preview.scrollTop;
      preview.scrollTo({ top, behavior: 'smooth' });
      return;
    }

    const view = viewRef.current;
    if (!view) return;
    const lineNumber = Math.min(Math.max(reveal.line + 1, 1), view.state.doc.lines);
    const line = view.state.doc.line(lineNumber);
    view.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    });
    view.focus();
  }, [reveal, mode, bodyText]);

  const showEditor = mode !== 'preview';
  const showPreview = mode !== 'edit';

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <Toolbar onCommand={command} disabled={!showEditor} />
      <div className="flex min-h-0 flex-1">
        {showEditor && (
          <div
            ref={editorHostRef}
            className="editor-host min-h-0 flex-1 overflow-hidden"
            data-testid="editor-host"
            // Publishes which note the mounted CodeMirror instance is bound to. The view is torn
            // down and rebuilt when the selection changes, so without this a caller (or a test)
            // can type into the host while it is still showing the previous note's document.
            data-note-id={noteId}
          />
        )}
        {mode === 'split' && <div className="w-px shrink-0 bg-border" />}
        {showPreview && (
          <div ref={previewScrollRef} className="preview-scroll min-h-0 flex-1 overflow-auto p-6">
            <Preview source={source} dark={dark} onRendered={handlePreviewRendered} />
          </div>
        )}
      </div>
    </div>
  );
}

/* --------------------------------- toolbar -------------------------------- */

interface ToolbarProps {
  onCommand: Record<string, () => void>;
  disabled: boolean;
}

const BUTTONS: { key: string; label: string; title: string }[] = [
  { key: 'heading', label: 'H', title: '标题（循环 1-6 级）' },
  { key: 'bold', label: 'B', title: '粗体 ⌘B' },
  { key: 'italic', label: 'I', title: '斜体 ⌘I' },
  { key: 'code', label: '</>', title: '行内代码' },
  { key: 'link', label: '🔗', title: '链接' },
  { key: 'bullet', label: '•', title: '无序列表' },
  { key: 'task', label: '☑', title: '任务列表' },
];

function Toolbar({ onCommand, disabled }: ToolbarProps) {
  return (
    <div className="flex items-center gap-1 border-b border-border bg-surface px-3 py-1.5" data-testid="editor-toolbar">
      {BUTTONS.map((button) => (
        <button
          key={button.key}
          type="button"
          title={button.title}
          disabled={disabled}
          onClick={() => onCommand[button.key]?.()}
          className="rounded px-2 py-1 text-xs text-muted hover:bg-hover disabled:opacity-40"
        >
          {button.label}
        </button>
      ))}
      <span className="ml-auto text-[11px] text-muted/70">图片可直接粘贴或拖入</span>
    </div>
  );
}
