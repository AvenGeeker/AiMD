import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Stage the prebuilt web bundle as the desktop renderer.
 *
 * The desktop app deliberately does not rebuild the web app with its own bundler: one Vite build
 * serves the browser *and* Electron, so the editor cannot drift between the two surfaces.
 */
function countFiles(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    total += entry.isDirectory() ? countFiles(resolve(dir, entry.name)) : 1;
  }
  return total;
}

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../../web/dist');
const target = resolve(here, '../renderer');

if (!existsSync(source)) {
  console.error(`[desktop] renderer bundle not found at ${source}`);
  console.error('[desktop] run `pnpm --filter @aimarkdown/web build` first.');
  process.exit(1);
}

// Warn when the source bundle is older than a previous staging: that usually means the web app
// was never rebuilt, and silently packaging a stale bundle is a confusing failure.
const stagedIndex = resolve(target, 'index.html');
const sourceIndex = resolve(source, 'index.html');
if (existsSync(stagedIndex) && existsSync(sourceIndex)) {
  const stagedAt = statSync(stagedIndex).mtimeMs;
  const sourceAt = statSync(sourceIndex).mtimeMs;
  if (sourceAt < stagedAt - 1000) {
    console.warn(
      `[desktop] warning: ${source} looks older than the previously staged bundle.\n` +
        '[desktop]          run `pnpm --filter @aimarkdown/web build` if you expected a fresh build.',
    );
  }
}

mkdirSync(target, { recursive: true });
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });

const stagedCount = countFiles(target);
if (stagedCount === 0) {
  console.error('[desktop] staged renderer is empty — the web build produced no files');
  process.exit(1);
}
console.log(`[desktop] staged renderer: ${source} -> ${target} (${stagedCount} files)`);
