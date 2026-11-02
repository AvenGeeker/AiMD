import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Stage the staged mobile renderer (www/) into the HarmonyOS resfile bundle so the ArkWeb
 * harness can load it fully offline: `entry/src/main/resources/resfile/www/index.html`.
 *
 * resfile (not rawfile) is deliberate: files under rawfile are addressed through
 * `resource://rawfile`, an origin ArkWeb treats as opaque, so its CORS rules reject the
 * renderer's ES module chunks. resfile lives on disk at `context.resourceDir`, which lets the
 * page load over `file://` after `setPathAllowingUniversalAccess([resourceDir + '/www'])`.
 */
const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../www');
const target = resolve(here, '../harmony/entry/src/main/resources/resfile/www');

if (!existsSync(source)) {
  console.error(`[mobile] renderer bundle not found at ${source}`);
  console.error('[mobile] run `pnpm --filter @aimarkdown/mobile build:renderer` first.');
  process.exit(1);
}

mkdirSync(target, { recursive: true });
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
console.log(`[mobile] staged HarmonyOS resfile: ${source} -> ${target}`);
