import { useEffect, useMemo, useRef } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  rectangularSelection,
} from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { tags } from '@lezer/highlight';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { NOTE_KEYS } from '@aimarkdown/shared';
import { uploadAttachment } from '../lib/queries.js';
import { isImageMime } from '@aimarkdown/shared';
import { Preview, useYTextValue } from './Preview.js';
import {
  Bold,
  Code2,
  Heading2,
  Italic,
  Link2,
  List,
  ListChecks,
  type LucideIcon,
} from 'lucide-react';

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

function editorHighlightStyle(dark: boolean) {
  const c = dark
    ? {
        heading1: '#aeb8ff',
        heading: '#8fa2e8',
        strong: '#e4c27f',
        emphasis: '#d2a7ec',
        link: '#8ec1ff',
        code: '#91d8bd',
        punctuation: '#7c8390',
        quote: '#9aa1ad',
        keyword: '#c7a1ff',
        string: '#a8d89a',
        number: '#f0b184',
        name: '#c9cdd5',
        comment: '#7c828d',
      }
    : {
        heading1: '#3f54c4',
        heading: '#5668aa',
        strong: '#8a5216',
        emphasis: '#7b4c96',
        link: '#2d6cc0',
        code: '#1f7a5f',
        punctuation: '#8d95a2',
        quote: '#697180',
        keyword: '#8442b8',
        string: '#247650',
        number: '#a6521a',
        name: '#45505f',
        comment: '#8c929c',
      };

  return HighlightStyle.define([
    { tag: tags.heading1, color: c.heading1, fontWeight: '650' },
    { tag: [tags.heading2, tags.heading3, tags.heading4, tags.heading5, tags.heading6], color: c.heading, fontWeight: '600' },
    { tag: tags.strong, color: c.strong, fontWeight: '650' },
    { tag: tags.emphasis, color: c.emphasis, fontStyle: 'italic' },
    { tag: [tags.link, tags.url], color: c.link },
    { tag: tags.monospace, color: c.code },
    { tag: tags.quote, color: c.quote },
    { tag: [tags.punctuation, tags.meta], color: c.punctuation },
    { tag: [tags.keyword, tags.operator], color: c.keyword },
    { tag: [tags.string, tags.character], color: c.string },
    { tag: [tags.number, tags.bool, tags.null, tags.atom], color: c.number },
    { tag: [tags.variableName, tags.typeName, tags.className, tags.propertyName], color: c.name },
    { tag: tags.comment, color: c.comment, fontStyle: 'italic' },
    { tag: tags.invalid, color: 'var(--danger)' },
  ]);
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
      highlightSpecialChars(),
      drawSelection(),
      dropCursor(),
      rectangularSelection(),
      indentOnInput(),
      bracketMatching(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      syntaxHighlighting(editorHighlightStyle(dark)),
      markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: true }),
      keymap.of([...defaultKeymap, ...searchKeymap, indentWithTab]),
      EditorView.lineWrapping,
      EditorState.readOnly.of(false),
    ];

    // CRDT binding must come after the base extensions so its transaction handling wins.
    // `false` (not undefined) is what y-codemirror expects when there is no undo manager.
    const collab = yCollab(bodyText, awareness, { undoManager: undoManager ?? false });
    extensions.push(collab);
    extensions.push(keymap.of([...yUndoManagerKeymap]));


    // Keep the app's paper-like writing surface while the token palette stays muted.
    extensions.push(
      EditorView.theme(
        {
          '&': { height: '100%', fontSize: `${fontSize}px`, backgroundColor: 'transparent' },
          '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-editor)' },
          '.cm-activeLine': {
            backgroundColor: 'color-mix(in srgb, var(--accent) 4.5%, transparent)',
          },
          '.cm-selectionBackground, .cm-content ::selection': {
            backgroundColor: 'var(--selection) !important',
          },
          '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
          '&.cm-focused': { outline: 'none' },
        },
        { dark },
      ),
    );

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
            className="editor-host editor-pane min-h-0 flex-1 overflow-hidden"
            data-testid="editor-host"
            // Publishes which note the mounted CodeMirror instance is bound to. The view is torn
            // down and rebuilt when the selection changes, so without this a caller (or a test)
            // can type into the host while it is still showing the previous note's document.
            data-note-id={noteId}
          />
        )}
        {mode === 'split' && <div className="split-divider shrink-0" aria-hidden />}
        {showPreview && (
          <div ref={previewScrollRef} className="preview-scroll preview-pane min-h-0 flex-1 overflow-auto px-8 py-8">
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

const BUTTONS: { key: string; label: string; title: string; icon: LucideIcon }[] = [
  { key: 'heading', label: '标题', title: '标题（循环 1-6 级）', icon: Heading2 },
  { key: 'bold', label: '粗体', title: '粗体 ⌘B', icon: Bold },
  { key: 'italic', label: '斜体', title: '斜体 ⌘I', icon: Italic },
  { key: 'code', label: '行内代码', title: '行内代码', icon: Code2 },
  { key: 'link', label: '链接', title: '链接', icon: Link2 },
  { key: 'bullet', label: '无序列表', title: '无序列表', icon: List },
  { key: 'task', label: '任务列表', title: '任务列表', icon: ListChecks },
];

function Toolbar({ onCommand, disabled }: ToolbarProps) {
  return (
    <div className="editor-toolbar flex shrink-0 items-center gap-0.5 px-4" data-testid="editor-toolbar">
      {BUTTONS.map((button, index) => {
        const Icon = button.icon;
        return (
          <div key={button.key} className="flex items-center">
            {index === 4 && <span className="mx-1 h-4 w-px bg-border-subtle" aria-hidden />}
            <button
              type="button"
              title={button.title}
              aria-label={button.label}
              disabled={disabled}
              onClick={() => onCommand[button.key]?.()}
              className="toolbar-button"
            >
              <Icon size={15} />
            </button>
          </div>
        );
      })}
      <span className="toolbar-hint ml-auto text-[10.5px] text-muted/65">图片可直接粘贴或拖入</span>
    </div>
  );
}
