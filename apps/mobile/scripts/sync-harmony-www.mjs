import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Stage the staged mobile renderer (www/) into the HarmonyOS rawfile bundle so the ArkWeb
 * harness can load it fully offline: `entry/src/main/resources/rawfile/www/index.html`.
 */
const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../www');
const target = resolve(here, '../harmony/entry/src/main/resources/rawfile/www');

if (!existsSync(source)) {
  console.error(`[mobile] renderer bundle not found at ${source}`);
  console.error('[mobile] run `pnpm --filter @aimarkdown/mobile build:renderer` first.');
  process.exit(1);
}

mkdirSync(target, { recursive: true });
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
console.log(`[mobile] staged HarmonyOS rawfile: ${source} -> ${target}`);
