import postgres from 'postgres';
import type { FullConfig } from '@playwright/test';

/**
 * Ensure the `aimarkdown_e2e` database exists.
 *
 * Connecting to the target database fails if it has not been created, so we connect to the
 * maintenance database `postgres` on the same server and issue `CREATE DATABASE` from there.
 * The dev Postgres container is expected to be running (`make db-up`).
 */

const TARGET = process.env.E2E_DATABASE_URL
  ?? 'postgres://aimarkdown:aimarkdown_dev@127.0.0.1:5433/aimarkdown_e2e';

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const url = new URL(TARGET);
  const dbName = url.pathname.replace(/^\//, '') || 'aimarkdown_e2e';
  const maintenanceUrl = new URL(TARGET);
  maintenanceUrl.pathname = '/postgres';

  const sql = postgres(maintenanceUrl.toString(), { max: 1, connect_timeout: 5 });
  try {
    const existing = await sql`select 1 from pg_database where datname = ${dbName}`;
    if (existing.length === 0) {
      // CREATE DATABASE cannot run inside a transaction block.
      // CREATE DATABASE cannot run inside a transaction, so it goes through `unsafe`. The name is
      // validated rather than interpolated blindly, then quoted as an identifier.
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(dbName)) {
        throw new Error(`[e2e] refusing to create a database with an unusual name: ${dbName}`);
      }
      await sql.unsafe(`create database "${dbName}"`);
      console.log(`[e2e] created database ${dbName}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ECONNREFUSED|timeout/i.test(message)) {
      throw new Error(
        `[e2e] cannot reach Postgres at ${maintenanceUrl.host}. Start it with \`make db-up\`.\n  ${message}`,
      );
    }
    throw error;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
