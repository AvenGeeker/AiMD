/**
 * HarmonyOS build launcher.
 *
 * The hvigor toolchain ships inside DevEco Studio (e.g. 6.0.1 bundles hvigor + the ohos plugin
 * at Contents/tools/hvigor). It is NOT an ohpm package, so it must never be declared in
 * oh-package.json5 — ohpm would 404 against repo.harmonyos.com. This script:
 *
 *   1. locates the DevEco-bundled hvigorw and its Node/ohpm,
 *   2. locates an installed HarmonyOS SDK (API >= 12) and exports DEVECO_SDK_HOME,
 *   3. runs `hvigorw --mode module -p product=default assembleHap`.
 *
 * If the SDK is missing it fails with setup guidance instead of an opaque hvigor error.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const harmonyDir = resolve(here, '../harmony');

/* ------------------------------ toolchain ------------------------------ */

const CANDIDATES = [
  '/Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw',
  process.env.DEVECO_HVIGORW,
];

const hvigorw = CANDIDATES.find(() => true) && CANDIDATES.find(existsSync);
if (!hvigorw) {
  console.error('[mobile] DevEco Studio not found.');
  console.error('[mobile] 1) Install DevEco Studio, then open apps/mobile/harmony in it (Build → HAP).');
  console.error('[mobile] 2) Or set DEVECO_HVIGORW to the hvigorw binary under Contents/tools/hvigor/bin.');
  process.exit(1);
}

const devEcoContents = resolve(dirname(dirname(dirname(dirname(hvigorw))))); // .../tools/hvigor/bin -> .../Contents
const nodeBin = resolve(devEcoContents, 'tools/node/bin');
const ohpmBin = resolve(devEcoContents, 'tools/ohpm/bin');
if (!existsSync(nodeBin) || !existsSync(ohpmBin)) {
  console.error(`[mobile] DevEco toolchain incomplete under ${devEcoContents}/tools (node/ohpm missing).`);
  process.exit(1);
}

/* -------------------------------- SDK -------------------------------- */

/**
 * A HarmonyOS NEXT SDK version dir must be *API 12+* (the scaffold targets 5.0.0(12)).
 * DevEco installs them under ~/Library/Huawei/Sdk (or the DEVECO_SDK_HOME root), either as
 * `openharmony/<api>` or directly as `<api>`. Only numeric dirs named >= 12 qualify: an old
 * `openharmony/9` SDK is NOT interchangeable with the HarmonyOS NEXT SDK and must not be picked.
 */
function findNextSdk() {
  const roots = [
    process.env.DEVECO_SDK_HOME,
    join(homedir(), 'Library', 'Huawei', 'Sdk'),
  ].filter(Boolean);
  const candidates = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const outer of readdirSync(root, { withFileTypes: true })) {
      if (!outer.isDirectory()) continue;
      if (/^\d+$/.test(outer.name) && Number(outer.name) >= 12) {
        candidates.push(join(root, outer.name));
        continue;
      }
      // Nested layout such as <root>/openharmony/<api>.
      const outerDir = join(root, outer.name);
      if (!existsSync(outerDir)) continue;
      for (const inner of readdirSync(outerDir, { withFileTypes: true })) {
        if (inner.isDirectory() && /^\d+$/.test(inner.name) && Number(inner.name) >= 12) {
          candidates.push(join(outerDir, inner.name));
        }
      }
    }
  }
  return candidates[0] ?? null;
}

const sdkHome = process.env.DEVECO_SDK_HOME && existsSync(process.env.DEVECO_SDK_HOME)
  ? process.env.DEVECO_SDK_HOME
  : findNextSdk();

if (!sdkHome) {
  console.error('[mobile] HarmonyOS NEXT SDK (API >= 12) not found under ~/Library/Huawei/Sdk.');
  console.error('[mobile] Open DevEco Studio → Settings → SDK Manager → install the HarmonyOS SDK');
  console.error('[mobile] (API 12 / 5.0.0(12) or newer), then re-run make mobile-hap.');
  console.error('[mobile] If your SDK lives elsewhere, export DEVECO_SDK_HOME=/path/to/sdk first.');
  process.exit(1);
}

console.log(`[mobile] hvigorw : ${hvigorw}`);
console.log(`[mobile] SDK     : ${sdkHome}`);
console.log(`[mobile] project : ${harmonyDir}`);

const env = {
  ...process.env,
  NODE_HOME: nodeBin,
  DEVECO_SDK_HOME: sdkHome,
  PATH: `${nodeBin}:${ohpmBin}:${process.env.PATH ?? ''}`,
};

/* -------------------------------- build -------------------------------- */

for (const dir of [harmonyDir, resolve(harmonyDir, 'entry')]) {
  if (!existsSync(resolve(dir, 'oh-package.json5'))) continue;
  console.log(`[mobile] ohpm install (${dir})`);
  try {
    execFileSync(resolve(ohpmBin, 'ohpm'), ['install', '--all'], { cwd: dir, env, stdio: 'inherit' });
  } catch {
    console.warn('[mobile] ohpm install reported an error (ignored — the app has no third-party deps).');
  }
}

console.log('[mobile] hvigorw assembleHap …');
execFileSync(hvigorw, ['--mode', 'module', '-p', 'product=default', 'assembleHap'], {
  cwd: harmonyDir,
  env,
  stdio: 'inherit',
});
console.log('[mobile] HAP built → apps/mobile/harmony/entry/build/default/outputs/default/');
