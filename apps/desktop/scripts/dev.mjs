import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Desktop dev runner.
 *
 * Loads the renderer from the Vite dev server when one is up (so the editor hot-reloads), and
 * falls back to the staged production bundle otherwise. Expects the API server to be running via
 * `make dev`.
 */
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const env = { ...process.env };
if (!env.AIMARKDOWN_SERVER_URL) env.AIMARKDOWN_SERVER_URL = 'http://127.0.0.1:3000';

// Probe the Vite dev server; if it answers, point the shell at it.
const viteUrl = 'http://127.0.0.1:5173';
let devServerUrl = '';
try {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  const response = await fetch(viteUrl, { signal: controller.signal });
  clearTimeout(timer);
  if (response.ok) devServerUrl = viteUrl;
} catch {
  devServerUrl = '';
}

if (!devServerUrl && !existsSync(resolve(root, 'renderer/index.html'))) {
  console.error('[desktop] no Vite dev server and no staged renderer bundle.');
  console.error('[desktop] run `pnpm --filter @aimarkdown/web build && node scripts/copy-renderer.mjs`.');
  process.exit(1);
}

if (devServerUrl) env.AIMARKDOWN_RENDERER_URL = devServerUrl;
console.log(`[desktop] renderer: ${devServerUrl || 'staged bundle'}`);
console.log(`[desktop] server:   ${env.AIMARKDOWN_SERVER_URL}`);

const electron = resolve(root, 'node_modules/.bin/electron');
const child = spawn(existsSync(electron) ? electron : 'electron', ['.'], {
  cwd: root,
  env,
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 0));
