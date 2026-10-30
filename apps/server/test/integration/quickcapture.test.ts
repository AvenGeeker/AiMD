import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { noteDocName } from '@aimarkdown/shared';
import type { NoteDto, TreeDto } from '@aimarkdown/shared';
import { api, databaseAvailable, register, startTestServer, type AuthedClient, type TestServer } from './helpers.js';
import { formatStamp } from '../../src/services/notes.js';

const dbUp = await databaseAvailable();
const describeDb = dbUp ? describe : describe.skip;

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

describeDb('quick capture', () => {
  let server: TestServer;
  let client: AuthedClient;
  let inboxId: string;

  beforeAll(async () => {
    server = await startTestServer();
    client = await register(server);
    const tree = await api<TreeDto>(server, client, 'GET', '/api/tree');
    inboxId = tree.body.settings.inboxNoteId!;
    expect(inboxId).toBeTruthy();
  });

  afterAll(async () => {
    await server?.stop();
  });

  it('formats stamps for every supported style', () => {
    const at = new Date('2026-10-30T14:05:00');
    expect(formatStamp('heading', at)).toBe('## 2026-10-30 14:05');
    expect(formatStamp('bullet', at)).toBe('- [14:05]');
    expect(formatStamp('none', at)).toBe('');
  });

  it('appends a capture to the inbox note', async () => {
    const result = await api<{ ok: boolean; appendedChars: number }>(
      server,
      client,
      'POST',
      `/api/notes/${inboxId}/capture`,
      { text: '第一条速记' },
    );
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(result.body.appendedChars).toBeGreaterThan(0);

    const note = await api<NoteDto>(server, client, 'GET', `/api/notes/${inboxId}`);
    expect(note.body.body).toContain('第一条速记');
    expect(note.body.body).toContain('## '); // default heading stamp
  });

  it('keeps earlier captures and appends in order', async () => {
    await api(server, client, 'POST', `/api/notes/${inboxId}/capture`, { text: 'capture A' });
    await api(server, client, 'POST', `/api/notes/${inboxId}/capture`, { text: 'capture B' });

    const note = await api<NoteDto>(server, client, 'GET', `/api/notes/${inboxId}`);
    const body = note.body.body;
    expect(body.indexOf('capture A')).toBeLessThan(body.indexOf('capture B'));
  });

  it('honours an explicit stamp format', async () => {
    await api(server, client, 'POST', `/api/notes/${inboxId}/capture`, {
      text: 'bullet stamped',
      stampFormat: 'bullet',
    });
    const note = await api<NoteDto>(server, client, 'GET', `/api/notes/${inboxId}`);
    expect(note.body.body).toMatch(/- \[\d{2}:\d{2}\]\n\nbullet stamped/);
  });

  it('rejects an empty capture', async () => {
    const result = await api(server, client, 'POST', `/api/notes/${inboxId}/capture`, { text: '   ' });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('rejects a capture to a note the user does not own', async () => {
    const other = await register(server);
    const result = await api(server, other, 'POST', `/api/notes/${inboxId}/capture`, { text: 'intruder' });
    expect(result.status).toBe(404);
  });

  it('trims surrounding whitespace but keeps interior newlines', async () => {
    await api(server, client, 'POST', `/api/notes/${inboxId}/capture`, {
      text: '  multi\nline capture  ',
      stampFormat: 'none',
    });
    const note = await api<NoteDto>(server, client, 'GET', `/api/notes/${inboxId}`);
    expect(note.body.body).toContain('multi\nline capture');
  });

  it('merges with a concurrent edit made by a connected editor', async () => {
    // A live editor session on the inbox note, as if the main window were open.
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `ws://127.0.0.1:${server.collabPort()}`,
      name: noteDocName(inboxId),
      document: doc,
      token: client.accessToken,
      onSynced: () => undefined,
    });
    await waitFor(() => provider.synced, { label: 'the editor to sync' });

    const before = doc.getText('body').toString();
    expect(before.length).toBeGreaterThan(0);

    // The editor edits the middle of the note...
    const mid = Math.floor(before.length / 2);
    doc.getText('body').insert(mid, '【编辑器插入】');

    // ...while a capture lands at the end through the REST path.
    const captureText = `并发速记-${Date.now()}`;
    await api(server, client, 'POST', `/api/notes/${inboxId}/capture`, {
      text: captureText,
      stampFormat: 'none',
    });

    // The connected editor must receive the capture, and both edits must survive.
    await waitFor(() => doc.getText('body').toString().includes(captureText), {
      label: 'the live editor to receive the capture',
    });

    const merged = doc.getText('body').toString();
    expect(merged).toContain('【编辑器插入】');
    expect(merged).toContain(captureText);
    expect(merged.split(captureText).length - 1).toBe(1);
    // The capture stays at the end even though the other edit was in the middle.
    expect(merged.trimEnd().endsWith(captureText)).toBe(true);

    provider.disconnect();
    doc.destroy();
  });
});
