import type { Hocuspocus } from '@hocuspocus/server';
import * as Y from 'yjs';
import { COLLAB_TIMEOUT_FALLBACK } from './constants.js';

/**
 * Server-side document mutation.
 *
 * REST handlers must not write CRDT state by hand — that would fork the source of truth.
 * Instead they open a Hocuspocus *direct connection*, which loads the real document, applies
 * the mutation, and broadcasts it to every connected client exactly as if a browser had made
 * the change.
 */

export interface MutationOutcome<T> {
  /** Whatever the mutation callback returned (read back from the document). */
  result: T;
  /** Full document state after the mutation, so the caller can refresh the mirror inline. */
  snapshot: Uint8Array;
}

/**
 * Run `mutate` against the live document called `documentName`.
 *
 * The snapshot is taken *inside* the transaction because Hocuspocus may destroy the document
 * on disconnect. `unloadImmediately: true` forces the pending store to run before the promise
 * resolves, so the mirror is up to date when the HTTP response is written.
 */
export async function mutateDocument<T>(
  hocuspocus: Hocuspocus,
  documentName: string,
  mutate: (doc: Y.Doc) => T,
): Promise<MutationOutcome<T>> {
  const connection = await hocuspocus.openDirectConnection(documentName, {});
  let result: T;
  let snapshot: Uint8Array = new Uint8Array(0);
  let ran = false;

  try {
    await connection.transact((document) => {
      result = mutate(document);
      snapshot = Y.encodeStateAsUpdate(document);
      ran = true;
    });
  } finally {
    try {
      await connection.disconnect({ unloadImmediately: true });
    } catch {
      // A failed disconnect must not mask a successful mutation; the debounced store hook
      // will still persist the document, and clients re-sync from IndexedDB on reconnect.
    }
  }

  if (!ran) {
    throw new Error(`direct connection transaction did not run for "${documentName}"`);
  }
  return { result: result!, snapshot };
}

/** Rebuild a detached Y.Doc from a snapshot taken inside a direct-connection transaction. */
export function docFromSnapshot(snapshot: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  if (snapshot.byteLength > 0) Y.applyUpdate(doc, snapshot);
  return doc;
}

/** Default wait used when a caller does not supply its own timeout. */
export const DIRECT_CONNECTION_TIMEOUT_MS = COLLAB_TIMEOUT_FALLBACK;
