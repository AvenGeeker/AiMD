import postgres from 'postgres';

/**
 * Make sure the E2E database exists before Playwright launches the server.
 *
 * This has to be a pre-step rather than a `globalSetup` hook: Playwright starts `webServer` first,
 * so by the time globalSetup runs the app has already failed its boot-time connectivity check.
 */

const TARGET =
  process.env.E2E_DATABASE_URL ??
  'postgres://aimarkdown:aimarkdown_dev@127.0.0.1:5433/aimarkdown_e2e';

const url = new URL(TARGET);
const dbName = url.pathname.replace(/^\//, '') || 'aimarkdown_e2e';
const maintenance = new URL(TARGET);
maintenance.pathname = '/postgres';

if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(dbName)) {
  console.error(`[e2e] refusing to create a database with an unusual name: ${dbName}`);
  process.exit(1);
}

const sql = postgres(maintenance.toString(), { max: 1, connect_timeout: 5 });
try {
  const existing = await sql`select 1 from pg_database where datname = ${dbName}`;
  if (existing.length === 0) {
    // CREATE DATABASE cannot run inside a transaction block.
    await sql.unsafe(`create database "${dbName}"`);
    console.log(`[e2e] created database ${dbName}`);
  } else {
    console.log(`[e2e] database ${dbName} already exists`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/ECONNREFUSED|timeout|connect/i.test(message)) {
    console.error(`[e2e] cannot reach Postgres at ${maintenance.host}. Start it with \`make db-up\`.`);
    console.error(`[e2e]   ${message}`);
    process.exit(1);
  }
  throw error;
} finally {
  await sql.end({ timeout: 5 });
}
