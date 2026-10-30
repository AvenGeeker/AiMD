import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { noteDocName, workspaceDocName } from '@aimarkdown/shared';
import {
  api,
  databaseAvailable,
  register,
  startTestServer,
  type AuthedClient,
  type TestServer,
} from './helpers.js';
import type { NoteDto } from '@aimarkdown/shared';

const dbUp = await databaseAvailable();
const describeDb = dbUp ? describe : describe.skip;

type Outcome = 'synced' | 'rejected' | 'timeout';

interface Client {
  provider: HocuspocusProvider;
  doc: Y.Doc;
  outcome: Outcome;
  close(): void;
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  { timeout = 8000, interval = 50, label = 'condition' } = {},
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`timed out after ${timeout}ms waiting for ${label}`);
}

/**
 * Open a collaboration client and wait for it to either sync or be refused.
 *
 * Provider v4 takes its callbacks in the constructor (there are no `provider.onSynced()`
 * methods), and `disconnect()` is synchronous.
 */
async function connect(
  server: TestServer,
  token: string | null,
  documentName: string,
): Promise<Client> {
  const doc = new Y.Doc();

  let settle!: (outcome: Outcome) => void;
  const settled = new Promise<Outcome>((resolve) => {
    settle = resolve;
  });
  let decided = false;
  const decide = (outcome: Outcome) => {
    if (decided) return;
    decided = true;
    settle(outcome);
  };

  const provider = new HocuspocusProvider({
    url: `ws://127.0.0.1:${server.collabPort()}`,
    name: documentName,
    document: doc,
    // `null` (not undefined) disables the token so the server sees an unauthenticated open.
    token,
    onSynced: () => decide('synced'),
    onAuthenticationFailed: () => decide('rejected'),
    onClose: () => decide('rejected'),
  });

  const timer = setTimeout(() => decide('timeout'), 6000);
  const outcome = await settled;
  clearTimeout(timer);

  return {
    provider,
    doc,
    outcome,
    close() {
      try {
        provider.disconnect();
      } catch {
        /* already closed */
      }
      doc.destroy();
    },
  };
}

describeDb('collaboration server (real WebSocket + real Postgres)', () => {
  let server: TestServer;
  let alice: AuthedClient;
  let bob: AuthedClient;
  const openClients: Client[] = [];

  async function tracked(promise: Promise<Client>): Promise<Client> {
    const client = await promise;
    openClients.push(client);
    return client;
  }

  /**
   * Take a device offline: drop the WebSocket but **keep the Y.Doc**, which is what a real
   * client does (its document survives in memory and in IndexedDB).
   */
  function goOffline(client: Client): void {
    client.provider.disconnect();
  }

  /**
   * Bring an offline device back by attaching a fresh provider to the *same* Y.Doc.
   *
   * This mirrors the real client lifecycle (SyncManager re-creates a provider around the
   * persisted document) and avoids depending on provider retry timing, so a rejection surfaces
   * through `onAuthenticationFailed`/`onClose` immediately.
   */
  async function goOnline(
    srv: TestServer,
    token: string,
    documentName: string,
    client: Client,
  ): Promise<Client> {
    const doc = client.doc;
    let settle!: (outcome: Outcome) => void;
    const settled = new Promise<Outcome>((resolve) => {
      settle = resolve;
    });
    let decided = false;
    const decide = (outcome: Outcome) => {
      if (!decided) {
        decided = true;
        settle(outcome);
      }
    };

    const provider = new HocuspocusProvider({
      url: `ws://127.0.0.1:${srv.collabPort()}`,
      name: documentName,
      document: doc,
      token,
      onSynced: () => decide('synced'),
      onAuthenticationFailed: () => decide('rejected'),
    });
    const timer = setTimeout(() => decide('timeout'), 8000);
    const outcome = await settled;
    clearTimeout(timer);
    expect(outcome).toBe('synced');

    const next: Client = {
      provider,
      doc,
      outcome,
      close() {
        try {
          provider.disconnect();
        } catch {
          /* already closed */
        }
      },
    };
    openClients.push(next);
    return next;
  }

  beforeAll(async () => {
    server = await startTestServer();
    alice = await register(server);
    bob = await register(server);
  });

  afterAll(async () => {
    for (const client of openClients.splice(0)) client.close();
    await server?.stop();
  });

  async function createNote(client: AuthedClient, body: string): Promise<string> {
    const created = await api<NoteDto>(server, client, 'POST', '/api/notes', { body });
    expect(created.status).toBe(201);
    return created.body.id;
  }

  describe('authentication and tenancy', () => {
    it('rejects a connection with no token', async () => {
      const noteId = await createNote(alice, 'secret');
      const client = await connect(server, null, noteDocName(noteId));
      expect(client.outcome).toBe('rejected');
      await client.close();
    });

    it('rejects an invalid token', async () => {
      const noteId = await createNote(alice, 'secret');
      const client = await connect(server, 'not-a-jwt', noteDocName(noteId));
      expect(client.outcome).toBe('rejected');
      await client.close();
    });

    it('rejects an expired token', async () => {
      const noteId = await createNote(alice, 'secret');
      const expired = await server.verifier.signAccessToken(alice.userId, alice.email, {
        accessSeconds: -10,
        refreshSeconds: 60,
      });
      const client = await connect(server, expired, noteDocName(noteId));
      expect(client.outcome).toBe('rejected');
      await client.close();
    });

    it('rejects a user opening someone else\'s note', async () => {
      const noteId = await createNote(alice, 'alice private');
      const client = await connect(server, bob.accessToken, noteDocName(noteId));
      expect(client.outcome).toBe('rejected');
      await client.close();
    });

    it('rejects a user opening someone else\'s workspace document', async () => {
      const client = await connect(server, bob.accessToken, workspaceDocName(alice.userId));
      expect(client.outcome).toBe('rejected');
      await client.close();
    });

    it('rejects a malformed document name even for a valid token', async () => {
      const client = await connect(server, alice.accessToken, 'note-../../etc/passwd');
      expect(client.outcome).toBe('rejected');
      await client.close();
    });

    it('rejects a document name for a note that does not exist', async () => {
      const client = await connect(server, alice.accessToken, noteDocName('nonexistentnote1'));
      expect(client.outcome).toBe('rejected');
      await client.close();
    });

    it('accepts the owner', async () => {
      const noteId = await createNote(alice, 'mine');
      const client = await tracked(connect(server, alice.accessToken, noteDocName(noteId)));
      expect(client.outcome).toBe('synced');
      expect(client.doc.getText('body').toString()).toContain('mine');
    });
  });

  describe('persistence round trip', () => {
    it('restores a document from bytea after every client disconnects', async () => {
      const noteId = await createNote(alice, 'original');

      const first = await connect(server, alice.accessToken, noteDocName(noteId));
      expect(first.outcome).toBe('synced');
      expect(first.doc.getText('body').toString()).toContain('original');
      first.doc.getText('body').insert(first.doc.getText('body').length, ' + edited online');
      // Wait for the debounced store hook to land.
      await waitFor(
        async () => {
          const rows = await server.handle.sql`select body_text from notes where id = ${noteId}`;
          return String(rows[0]?.body_text ?? '').includes('edited online');
        },
        { label: 'mirror to receive the online edit' },
      );
      first.close();

      // Fresh document, fresh connection: must be rebuilt from the stored CRDT state.
      const second = await connect(server, alice.accessToken, noteDocName(noteId));
      expect(second.doc.getText('body').toString()).toContain('edited online');
      second.close();
    });

    it('projects body changes into the searchable mirror', async () => {
      const noteId = await createNote(alice, 'before');
      const client = await connect(server, alice.accessToken, noteDocName(noteId));
      const body = client.doc.getText('body');
      body.insert(body.length, ' 独特检索词汇XYZ');

      await waitFor(
        async () => {
          const found = await api<{ items: { id: string }[] }>(
            server,
            alice,
            'GET',
            `/api/notes?q=${encodeURIComponent('独特检索词汇XYZ')}`,
          );
          return found.body.items.some((note) => note.id === noteId);
        },
        { label: 'the trgm search index to see the new text' },
      );
      client.close();
    });

    it('advances content_updated_at when the body changes', async () => {
      const noteId = await createNote(alice, 'v1');
      const before = await api<NoteDto>(server, alice, 'GET', `/api/notes/${noteId}`);

      const client = await connect(server, alice.accessToken, noteDocName(noteId));
      const body = client.doc.getText('body');
      body.insert(body.length, ' v2');
      await waitFor(
        async () => {
          const after = await api<NoteDto>(server, alice, 'GET', `/api/notes/${noteId}`);
          return after.body.contentUpdatedAt !== before.body.contentUpdatedAt;
        },
        { label: 'content_updated_at to advance' },
      );
      client.close();
    });
  });

  describe('multi-device sync', () => {
    it('propagates a keystroke to a second connected device', async () => {
      const noteId = await createNote(alice, 'shared');
      const a = await tracked(connect(server, alice.accessToken, noteDocName(noteId)));
      const b = await tracked(connect(server, alice.accessToken, noteDocName(noteId)));

      const bodyA = a.doc.getText('body');
      bodyA.insert(bodyA.length, ' — typed on device A');

      await waitFor(
        () => b.doc.getText('body').toString().includes('typed on device A'),
        { label: 'device B to receive the update' },
      );
      expect(b.doc.getText('body').toString()).toBe(a.doc.getText('body').toString());
    });

    it('merges concurrent offline edits from two devices without losing either', async () => {
      const noteId = await createNote(alice, '# 标题\n\n中间段落\n');
      const a = await tracked(connect(server, alice.accessToken, noteDocName(noteId)));

      // B connects, syncs, then goes offline.
      const b = await tracked(connect(server, alice.accessToken, noteDocName(noteId)));
      expect(b.doc.getText('body').toString()).toContain('中间段落');
      goOffline(b);

      // Both edit while B is disconnected.
      const bodyA = a.doc.getText('body');
      bodyA.insert(0, 'A端新增\n');
      const bodyB = b.doc.getText('body');
      bodyB.insert(bodyB.length, '\nB端离线新增');

      expect(a.doc.getText('body').toString()).not.toContain('B端离线新增');

      // B comes back online and must merge rather than overwrite.
      await goOnline(server, alice.accessToken, noteDocName(noteId), b);
      await waitFor(
        () =>
          a.doc.getText('body').toString().includes('B端离线新增') &&
          b.doc.getText('body').toString().includes('A端新增'),
        { label: 'offline edits to merge in both directions' },
      );

      const merged = a.doc.getText('body').toString();
      expect(merged).toBe(b.doc.getText('body').toString());
      expect(merged).toContain('# 标题');
      expect(merged).toContain('中间段落');
      expect(merged).toContain('A端新增');
      expect(merged).toContain('B端离线新增');
      // No duplication from the merge.
      expect(merged.split('A端新增').length - 1).toBe(1);
      expect(merged.split('B端离线新增').length - 1).toBe(1);
      // Ordering: A edited the head, B the tail, so both survive in their original places.
      expect(merged.indexOf('A端新增')).toBeLessThan(merged.indexOf('中间段落'));
      expect(merged.indexOf('中间段落')).toBeLessThan(merged.indexOf('B端离线新增'));
    });

    it('persists the merged result so a third device sees both edits', async () => {
      const noteId = await createNote(alice, 'base');
      const a = await tracked(connect(server, alice.accessToken, noteDocName(noteId)));
      const b = await tracked(connect(server, alice.accessToken, noteDocName(noteId)));

      a.doc.getText('body').insert(0, 'AAA');
      b.doc.getText('body').insert(b.doc.getText('body').length, 'BBB');

      await waitFor(
        () => a.doc.getText('body').toString().includes('BBB'),
        { label: 'A to receive B\'s edit' },
      );
      const expected = a.doc.getText('body').toString();

      await waitFor(
        async () => {
          const rows = await server.handle.sql`select body_text from notes where id = ${noteId}`;
          return String(rows[0]?.body_text ?? '') === expected;
        },
        { label: 'the mirror to hold the merged text' },
      );

      const c = await tracked(connect(server, alice.accessToken, noteDocName(noteId)));
      expect(c.doc.getText('body').toString()).toBe(expected);
    });
  });

  describe('graceful shutdown', () => {
    it('flushes pending debounced stores so a restart cannot lose writes', async () => {
      // A dedicated server with a long debounce, so the store can only reach the database via
      // the shutdown flush — that is what makes this assertion meaningful.
      const dedicated = await startTestServer({
        COLLAB_DEBOUNCE: '5000',
        COLLAB_MAX_DEBOUNCE: '10000',
      });
      let writer: Client | null = null;
      let witness: Client | null = null;
      try {
        const client = await register(dedicated);
        const created = await api<NoteDto>(dedicated, client, 'POST', '/api/notes', { body: 'pre' });
        const noteId = created.body.id;
        const docName = noteDocName(noteId);

        writer = await connect(dedicated, client.accessToken, docName);
        expect(writer.outcome).toBe('synced');
        // A second connection acts as the delivery witness: once it sees the edit, the server
        // has definitely received and broadcast it.
        witness = await connect(dedicated, client.accessToken, docName);
        expect(witness.outcome).toBe('synced');

        const marker = `flush-probe-${Date.now()}`;
        const body = writer.doc.getText('body');
        body.insert(body.length, ` ${marker}`);

        await waitFor(() => witness!.doc.getText('body').toString().includes(marker), {
          label: 'the server to receive and broadcast the write',
        });

        // Still inside the 5s debounce window: nothing has been persisted yet.
        const beforeStop = await dedicated.handle.sql`select body_text from notes where id = ${noteId}`;
        expect(String(beforeStop[0]?.body_text ?? '')).not.toContain(marker);

        // Stop inside the debounce window; the flush is the only thing that can save the write.
        const report = await dedicated.collab.stop();
        expect(report.drained).toBe(true);
        expect(report.pendingDocuments).toBe(0);

        const afterStop = await dedicated.handle.sql`select body_text from notes where id = ${noteId}`;
        expect(String(afterStop[0]?.body_text ?? '')).toContain(marker);

        // The CRDT document itself must also be on disk, not just the text mirror.
        const docRows = await dedicated.handle.sql`
          select ydoc from note_documents where note_id = ${noteId}
        `;
        expect(docRows).toHaveLength(1);

        writer.close();
        writer = null;
        witness.close();
        witness = null;
      } finally {
        writer?.close();
        witness?.close();
        await dedicated.app.close().catch(() => undefined);
        await dedicated.collab.stop().catch(() => undefined);
        await dedicated.handle.close().catch(() => undefined);
      }
    });
  });
});
