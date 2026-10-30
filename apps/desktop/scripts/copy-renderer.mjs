import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Stage the prebuilt web bundle as the desktop renderer.
 *
 * The desktop app deliberately does not rebuild the web app with its own bundler: one Vite build
 * serves the browser *and* Electron, so the editor cannot drift between the two surfaces.
 */
const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../../web/dist');
const target = resolve(here, '../renderer');

if (!existsSync(source)) {
  console.error(`[desktop] renderer bundle not found at ${source}`);
  console.error('[desktop] run `pnpm --filter @aimarkdown/web build` first.');
  process.exit(1);
}

mkdirSync(target, { recursive: true });
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
console.log(`[desktop] staged renderer: ${source} -> ${target}`);
