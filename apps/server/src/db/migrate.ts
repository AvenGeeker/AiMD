import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Sql } from 'postgres';
import { toDateOr } from '../utils/dates.js';

export interface MigrationRecord {
  id: string;
  appliedAt: Date;
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

/** Resolve `apps/server/migrations` for both `src/` (tsx) and `dist/` (node) layouts. */
export function defaultMigrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/db -> ../../migrations ; dist/db -> ../../migrations
  return resolve(here, '../../migrations');
}

export function listMigrationFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

/**
 * Apply pending SQL migrations inside one transaction each.
 *
 * Runs at container start so `docker compose up` is genuinely one command. It is idempotent:
 * already-applied ids are recorded in `_migrations` and skipped.
 */
export async function migrate(sql: Sql, dir = defaultMigrationsDir()): Promise<MigrateResult> {
  const files = listMigrationFiles(dir);
  if (files.length === 0) {
    throw new Error(`No SQL migrations found in ${join(dir, '*.sql')}`);
  }

  await sql`
    create table if not exists _migrations (
      id         text primary key,
      applied_at timestamptz not null default now()
    )
  `;

  const existing = await sql`select id from _migrations`;
  const applied = new Set(existing.map((row) => String(row.id)));
  const result: MigrateResult = { applied: [], skipped: [] };

  for (const file of files) {
    const id = file.replace(/\.sql$/, '');
    if (applied.has(id)) {
      result.skipped.push(id);
      continue;
    }
    const statements = readFileSync(join(dir, file), 'utf8');
    await sql.begin(async (tx) => {
      // Simple query protocol: the file may contain multiple statements.
      await tx.unsafe(statements);
      await tx`insert into _migrations (id) values (${id})`;
    });
    result.applied.push(id);
  }
  return result;
}

export async function getAppliedMigrations(sql: Sql): Promise<MigrationRecord[]> {
  const rows = await sql`select id, applied_at from _migrations order by id`;
  return rows.map((row) => ({ id: String(row.id), appliedAt: toDateOr(row.applied_at, new Date(0)) }));
}
