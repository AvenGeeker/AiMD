import { HocuspocusProvider } from '@hocuspocus/provider';
import { IndexeddbPersistence } from 'y-indexeddb';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { noteDocName, workspaceDocName } from '@aimarkdown/shared';
import { collabUrl } from './config.js';
import { getAccessToken } from './api.js';

/**
 * Client-side CRDT sync.
 *
 * Each document gets one `Y.Doc`, one `HocuspocusProvider` (server sync) and one
 * `IndexeddbPersistence` (local cache). The IndexedDB layer is what makes the app usable
 * offline: edits land locally first, and Yjs merges them with the server state on reconnect.
 *
 * Documents are reference-counted so switching between notes reuses an existing connection
 * instead of tearing down and rebuilding it on every click.
 */

export type SyncStatus = 'connecting' | 'connected' | 'disconnected' | 'denied';

export interface SyncEvents {
  onStatus?(status: SyncStatus): void;
  /** Called after the first successful sync of a document. */
  onSynced?(documentName: string): void;
}

interface Entry {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  /** Null when IndexedDB is unavailable (some sandboxed webviews), in which case the app is
   *  online-only for that document rather than silently pretending to cache. */
  persistence: IndexeddbPersistence | null;
  awareness: Awareness;
  refs: number;
  status: SyncStatus;
  synced: boolean;
}

export class SyncManager {
  private readonly entries = new Map<string, Entry>();
  private listeners = new Set<(status: SyncStatus, documentName: string) => void>();
  private baseUrl = '';

  configure(baseUrl: string): void {
    this.baseUrl = baseUrl;
  }

  /** Overall connectivity, for the status pill in the title bar. */
  get status(): SyncStatus {
    if (this.entries.size === 0) return 'disconnected';
    const statuses = [...this.entries.values()].map((entry) => entry.status);
    if (statuses.some((s) => s === 'denied')) return 'denied';
    if (statuses.every((s) => s === 'connected')) return 'connected';
    if (statuses.some((s) => s === 'connected')) return 'connected';
    if (statuses.every((s) => s === 'disconnected')) return 'disconnected';
    return 'connecting';
  }

  /** Number of documents with changes that have not reached the server yet. */
  get pendingCount(): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.provider.hasUnsyncedChanges) count++;
    }
    return count;
  }

  onStatusChange(listener: (status: SyncStatus, documentName: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(status: SyncStatus, documentName: string): void {
    for (const listener of this.listeners) listener(status, documentName);
  }

  /** True when IndexedDB is usable. Electron `file://` pages and private mode may not have it. */
  private static localCacheAvailable(): boolean {
    try {
      return typeof indexedDB !== 'undefined';
    } catch {
      return false;
    }
  }

  /**
   * Acquire a document, creating its provider and local cache on first use.
   * Callers must pair every `acquire` with a `release`.
   */
  acquire(documentName: string, events: SyncEvents = {}): Entry {
    const existing = this.entries.get(documentName);
    if (existing) {
      existing.refs++;
      return existing;
    }

    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    awareness.setLocalStateField('user', { name: 'me', color: '#4f8cff' });

    const persistence = SyncManager.localCacheAvailable()
      ? new IndexeddbPersistence(documentName, doc)
      : null;

    const provider = new HocuspocusProvider({
      url: collabUrl(this.baseUrl),
      name: documentName,
      document: doc,
      awareness,
      // Read the token lazily so a refreshed access token is picked up on reconnect.
      token: () => getAccessToken() ?? '',
      onStatus: ({ status }) => {
        const mapped: SyncStatus = status === 'connected' ? 'connected' : 'connecting';
        const entry = this.entries.get(documentName);
        if (entry) entry.status = mapped;
        this.emit(mapped, documentName);
        events.onStatus?.(mapped);
      },
      onSynced: () => {
        const entry = this.entries.get(documentName);
        if (entry) {
          entry.synced = true;
          entry.status = 'connected';
        }
        this.emit('connected', documentName);
        events.onSynced?.(documentName);
      },
      onAuthenticationFailed: () => {
        const entry = this.entries.get(documentName);
        if (entry) entry.status = 'denied';
        this.emit('denied', documentName);
        events.onStatus?.('denied');
      },
      onClose: () => {
        const entry = this.entries.get(documentName);
        if (entry && entry.status !== 'denied') entry.status = 'disconnected';
        this.emit(entry?.status ?? 'disconnected', documentName);
      },
    });

    const entry: Entry = {
      doc,
      provider,
      persistence,
      awareness,
      refs: 1,
      status: 'connecting',
      synced: false,
    };
    this.entries.set(documentName, entry);
    return entry;
  }

  /** Drop a reference; the document is torn down when the last one goes away. */
  release(documentName: string): void {
    const entry = this.entries.get(documentName);
    if (!entry) return;
    entry.refs--;
    if (entry.refs > 0) return;

    this.entries.delete(documentName);
    try {
      entry.provider.disconnect();
      entry.provider.destroy();
    } catch {
      /* already torn down */
    }
    // Destroying the IndexedDB cache would delete locally-held offline edits, so the database
    // is left in place; only the handle is dropped.
    void Promise.resolve(entry.persistence?.destroy()).catch(() => undefined);
    entry.awareness.destroy();
    entry.doc.destroy();
  }

  getDocument(documentName: string): Y.Doc | undefined {
    return this.entries.get(documentName)?.doc;
  }

  isSynced(documentName: string): boolean {
    return this.entries.get(documentName)?.synced ?? false;
  }

  acquireNote(noteId: string, events?: SyncEvents): Entry {
    return this.acquire(noteDocName(noteId), events);
  }

  acquireWorkspace(userId: string, events?: SyncEvents): Entry {
    return this.acquire(workspaceDocName(userId), events);
  }

  /** Force an immediate push of local changes (used before the app is hidden or quit). */
  flush(): void {
    for (const entry of this.entries.values()) {
      try {
        entry.provider.flushPendingUpdates();
        entry.provider.forceSync();
      } catch {
        /* provider already closed */
      }
    }
  }

  destroy(): void {
    for (const name of [...this.entries.keys()]) {
      const entry = this.entries.get(name);
      if (entry) entry.refs = 1;
      this.release(name);
    }
    this.listeners.clear();
  }
}

export const syncManager = new SyncManager();
export type { Entry as SyncEntry };
