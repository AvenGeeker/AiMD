import { useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { NOTE_KEYS, noteDocName, type NoteMetaMap } from '@aimarkdown/shared';
import { NOTE_META_DEFAULTS } from '@aimarkdown/shared';
import { syncManager, type SyncEntry, type SyncStatus } from '../lib/sync.js';

/**
 * Own the CRDT document for the currently open note.
 *
 * Lifted out of the editor so the title bar, outline and editor all observe one instance, and so
 * the reference is released exactly once when the selection changes.
 */
export function useNoteDocument(noteId: string | null): {
  entry: SyncEntry | null;
  doc: Y.Doc | null;
  awareness: Awareness | null;
  status: SyncStatus;
} {
  const [entry, setEntry] = useState<SyncEntry | null>(null);
  const [status, setStatus] = useState<SyncStatus>('disconnected');

  useEffect(() => {
    if (!noteId) {
      setEntry(null);
      setStatus('disconnected');
      return;
    }
    const acquired = syncManager.acquireNote(noteId, {
      onStatus: (next) => setStatus(next),
    });
    setEntry(acquired);
    setStatus(acquired.status);
    return () => {
      syncManager.release(noteDocName(noteId));
      setEntry(null);
    };
  }, [noteId]);

  return {
    entry,
    doc: entry?.doc ?? null,
    awareness: entry?.awareness ?? null,
    status,
  };
}

/** Observe a note document's `meta` map as reactive state. */
export function useNoteMeta(doc: Y.Doc | null): NoteMetaMap {
  // The version counter must be a memo dependency, not just a re-render trigger: the document
  // starts empty and is filled in when the server state arrives, so a memo keyed on `doc` alone
  // would cache the pre-sync values forever.
  const [version, bump] = useState(0);

  useEffect(() => {
    if (!doc) return;
    const meta = doc.getMap(NOTE_KEYS.meta);
    const observer = () => bump((value) => value + 1);
    meta.observeDeep(observer);
    // The map may already have been populated (local IndexedDB cache) before we subscribed.
    bump((value) => value + 1);
    return () => meta.unobserveDeep(observer);
  }, [doc]);

  return useMemo(() => {
    if (!doc) return { ...NOTE_META_DEFAULTS };
    const meta = doc.getMap(NOTE_KEYS.meta);
    const str = (key: string, fallback: string) => {
      const value = meta.get(key);
      return typeof value === 'string' ? value : fallback;
    };
    const bool = (key: string, fallback: boolean) => {
      const value = meta.get(key);
      return typeof value === 'boolean' ? value : fallback;
    };
    const strOrNull = (key: string) => {
      const value = meta.get(key);
      return typeof value === 'string' ? value : null;
    };
    return {
      title: str('title', NOTE_META_DEFAULTS.title),
      titleManual: meta.has('titleManual') ? bool('titleManual', false) : true,
      folderId: strOrNull('folderId'),
      pinned: bool('pinned', false),
      archived: bool('archived', false),
      deletedAt: strOrNull('deletedAt'),
      position: str('position', NOTE_META_DEFAULTS.position),
      createdAt: str('createdAt', NOTE_META_DEFAULTS.createdAt),
    };
    // `version` is not referenced in the body; it is the observation signal that forces a
    // recompute whenever the Y.Map changes.
  }, [doc, version]);
}

/** Write note metadata into the CRDT document. */
export function writeNoteMeta(doc: Y.Doc | null, patch: Partial<NoteMetaMap>): void {
  if (!doc) return;
  doc.transact(() => {
    const meta = doc.getMap(NOTE_KEYS.meta);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      meta.set(key, value as string | boolean | null);
    }
    // Renaming by hand pins the title so later body edits stop overriding it.
    if (typeof patch.title === 'string' && patch.titleManual === undefined) {
      meta.set('titleManual', true);
    }
  });
}

/** Observe a note document's `tagIds` Y.Array as reactive state. */
export function useNoteTagIds(doc: Y.Doc | null): string[] {
  // Same reasoning as useNoteMeta: the memo must depend on the observation counter.
  const [version, bump] = useState(0);

  useEffect(() => {
    if (!doc) return;
    const array = doc.getArray<string>(NOTE_KEYS.tagIds);
    const observer = () => bump((value) => value + 1);
    array.observe(observer);
    bump((value) => value + 1);
    return () => array.unobserve(observer);
  }, [doc]);

  return useMemo(() => {
    if (!doc) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of doc.getArray<string>(NOTE_KEYS.tagIds).toArray()) {
      if (typeof id !== 'string' || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
    // `version` is the observation signal, as in useNoteMeta.
  }, [doc, version]);
}

/** Replace the note's tag set in the CRDT document. */
export function writeNoteTagIds(doc: Y.Doc | null, nextTagIds: string[]): void {
  if (!doc) return;
  const array = doc.getArray<string>(NOTE_KEYS.tagIds);
  doc.transact(() => {
    // Minimal diff rather than clear-and-refill: refilling would destroy the CRDT identity of
    // untouched tags and make two devices adding different tags merge into duplicates.
    const next = [...new Set(nextTagIds.filter((id) => typeof id === 'string' && id.length > 0))];
    const current = array.toArray();
    const nextSet = new Set(next);
    for (let i = current.length - 1; i >= 0; i--) {
      if (!nextSet.has(current[i] as string)) array.delete(i, 1);
    }
    let index = 0;
    for (const id of next) {
      if (array.get(index) === id) {
        index++;
        continue;
      }
      if (array.toArray().indexOf(id) > index) {
        index++;
        continue;
      }
      array.insert(index, [id]);
      index++;
    }
    if (array.length > next.length) array.delete(next.length, array.length - next.length);
  });
}
