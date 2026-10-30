import { loadConfig } from '../config.js';
import { createDb, ping } from '../db/client.js';
import { defaultMigrationsDir, migrate } from '../db/migrate.js';
import { createConsoleLogger } from '../utils/logger.js';

/** Standalone migration runner (`pnpm migrate`). Boot also migrates; this is for CI and repair. */
async function main(): Promise<void> {
  const config = loadConfig();
  const log = createConsoleLogger('info');
  const dbHandle = createDb({ databaseUrl: config.DATABASE_URL });

  if (!(await ping(dbHandle.sql))) {
    log.error({}, 'database unreachable');
    process.exitCode = 1;
    await dbHandle.close();
    return;
  }

  const dir = config.MIGRATIONS_DIR ?? defaultMigrationsDir();
  const result = await migrate(dbHandle.sql, dir);
  log.info({ applied: result.applied, skipped: result.skipped, dir }, 'migration complete');
  await dbHandle.close();
}

main().catch((error) => {
  console.error('[migrate] failed:', error);
  process.exit(1);
});
