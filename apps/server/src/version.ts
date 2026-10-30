import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Application version, read from this package's `package.json` at boot.
 *
 * `import ... with { type: 'json' }` would be tidier but ties the build to a specific Node/Bundler
 * combination; reading the file works identically from `src/` (tsx) and `dist/` (node), which is
 * what the `/api/health` probe and the deploy script rely on.
 */
export const APP_VERSION: string = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const manifest = resolve(here, '../package.json');
    const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { version?: string };
    return parsed.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();
