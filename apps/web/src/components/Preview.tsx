import { useEffect, useRef, useState } from 'react';
import { enhancePreview, renderSafeMarkdown } from '@aimarkdown/markdown/browser';
import type * as Y from 'yjs';

/**
 * Rendered markdown preview.
 *
 * Re-renders on a debounce rather than on every keystroke: the pipeline is synchronous and
 * cheap, but shiki highlighting and mermaid layout are not, and both are idempotent so they can
 * simply be re-run over the freshly replaced subtree.
 */

export interface PreviewProps {
  /** Source text to render. Usually derived from the note's Y.Text. */
  source: string;
  dark: boolean;
  /** Called with the rendered root so the parent can wire up wikilink clicks and scroll sync. */
  onRendered?(root: HTMLElement): void;
  className?: string;
  /** Render delay in ms; 0 renders synchronously after the source changes. */
  debounceMs?: number;
}

export function Preview({ source, dark, onRendered, className, debounceMs = 120 }: PreviewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Keep the latest callback without re-running the effect on every render.
  const renderedRef = useRef(onRendered);
  renderedRef.current = onRendered;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const paint = () => {
      if (cancelled) return;
      const html = renderSafeMarkdown(source);
      host.innerHTML = html;
      renderedRef.current?.(host);
      // Async enhancements (shiki, mermaid) run after paint so text appears immediately.
      void enhancePreview(host, { theme: dark ? 'dark' : 'light' }).catch(() => undefined);
    };

    if (debounceMs <= 0) {
      paint();
    } else {
      timer = setTimeout(paint, debounceMs);
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [source, dark, debounceMs]);

  return <div ref={hostRef} className={`markdown-preview${className ? ` ${className}` : ''}`} />;
}

/**
 * Subscribe to a `Y.Text` and expose its current value as React state.
 *
 * Debounced so holding down a key does not re-render the preview on every character. The value
 * is read synchronously on mount, so an offline document loaded from IndexedDB paints at once
 * without waiting for the server.
 */
export function useYTextValue(text: Y.Text | null, debounceMs = 120): string {
  const [value, setValue] = useState(() => text?.toString() ?? '');

  useEffect(() => {
    if (!text) {
      setValue('');
      return;
    }
    setValue(text.toString());

    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = () => {
      if (debounceMs <= 0) {
        setValue(text.toString());
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setValue(text.toString()), debounceMs);
    };
    text.observe(observer);
    return () => {
      text.unobserve(observer);
      if (timer) clearTimeout(timer);
    };
  }, [text, debounceMs]);

  return value;
}
