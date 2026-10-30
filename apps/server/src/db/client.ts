import postgres, { type Sql } from 'postgres';

/**
 * Database handle.
 *
 * Deliberately **no ORM**. `drizzle-orm/postgres-js` mutates the passed `postgres()` handle —
 * it replaces the driver's built-in serializers, after which binding a JS `Date` throws
 * `ERR_INVALID_ARG_TYPE` instead of being written as `timestamptz`. Every query in this service
 * is raw SQL anyway (bytea columns, the `pg_trgm` expression index, the projection upserts), so
 * the ORM bought nothing and cost correctness.
 *
 * Row shapes are declared in `db/schema.ts` and an integration test asserts they match the live
 * database, which is the drift guard the ORM would otherwise have provided.
 */

export interface DbHandle {
  /** postgres.js client. Accepts `Date` (timestamptz) and `Uint8Array`-as-bytea parameters. */
  sql: Sql;
  close(): Promise<void>;
}

export interface DbOptions {
  databaseUrl: string;
  /** Max pooled connections. Keep modest: one app container serves one instance. */
  max?: number;
  /** Fail fast at boot when the database is not reachable yet. */
  connectTimeout?: number;
}

export function createDb(options: DbOptions): DbHandle {
  const sql = postgres(options.databaseUrl, {
    max: options.max ?? 10,
    connect_timeout: options.connectTimeout ?? 10,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    prepare: false,
    // `create table if not exists` in the migration runner emits a benign 42P07 NOTICE on every
    // boot after the first; dropping just that one keeps the log signal-to-noise usable.
    onnotice: (notice) => {
      if (notice?.code === '42P07') return;
    },
  });
  return {
    sql,
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };
}

/** Round-trip a Postgres connection: throws when the server is unreachable. */
export async function ping(sql: Sql): Promise<boolean> {
  try {
    await sql`select 1 as ok`;
    return true;
  } catch {
    return false;
  }
}
