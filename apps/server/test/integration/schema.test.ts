import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAvailable, startTestServer, type TestServer } from './helpers.js';
import { EXPECTED_COLUMNS, TABLES } from '../../src/db/schema.js';

const dbUp = await databaseAvailable();
const describeDb = dbUp ? describe : describe.skip;

/**
 * Guards against drift between `migrations/0001_init.sql` and the row types in `db/schema.ts`.
 *
 * With no ORM in the loop, this is what keeps the hand-written DDL and the TypeScript shapes
 * honest with each other.
 */
describeDb('database schema', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer();
  });
  afterAll(async () => {
    await server?.stop();
  });

  it('creates every expected table', async () => {
    const rows = await server.handle.sql`
      select table_name from information_schema.tables
      where table_schema = 'public' order by table_name
    `;
    const actual = rows.map((row) => String(row.table_name));
    for (const table of TABLES) {
      expect(actual, `missing table ${table}`).toContain(table);
    }
  });

  it('gives every table the columns its row type declares', async () => {
    for (const table of TABLES) {
      const rows = await server.handle.sql`
        select column_name from information_schema.columns
        where table_schema = 'public' and table_name = ${table}
      `;
      const actual = rows.map((row) => String(row.column_name)).sort();
      const expected = [...EXPECTED_COLUMNS[table]].sort();
      expect(actual, `columns of ${table}`).toEqual(expected);
    }
  });

  it('installs pg_trgm and the trigram search index', async () => {
    const ext = await server.handle.sql`select extname from pg_extension where extname = 'pg_trgm'`;
    expect(ext).toHaveLength(1);

    const idx = await server.handle.sql`
      select indexdef from pg_indexes where indexname = 'idx_notes_search_trgm'
    `;
    expect(idx).toHaveLength(1);
    expect(String(idx[0]?.indexdef)).toContain('gin_trgm_ops');
  });

  it('records the applied migration exactly once', async () => {
    const rows = await server.handle.sql`select id from _migrations order by id`;
    expect(rows.map((row) => String(row.id))).toContain('0001_init');
    expect(new Set(rows.map((row) => String(row.id))).size).toBe(rows.length);
  });

  it('enforces the foreign keys that make hard deletes cascade', async () => {
    const fks = await server.handle.sql`
      select conname, confdeltype from pg_constraint
      where conrelid = 'note_documents'::regclass and contype = 'f'
    `;
    // 'c' = ON DELETE CASCADE
    expect(fks.some((row) => row.confdeltype === 'c')).toBe(true);
  });

  it('keeps user emails unique', async () => {
    const constraints = await server.handle.sql`
      select indexname from pg_indexes where tablename = 'users'
    `;
    expect(constraints.length).toBeGreaterThan(0);
    const unique = await server.handle.sql`
      select conname from pg_constraint
      where conrelid = 'users'::regclass and contype in ('u', 'p')
    `;
    expect(unique.length).toBeGreaterThanOrEqual(2); // primary key + unique email
  });
});
