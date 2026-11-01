import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Mobile shell configuration.
 *
 * The renderer is the same `@aimarkdown/web` bundle that serves the browser and the Electron
 * desktop app; `scripts/copy-renderer.mjs` stages it into `www/` before every `cap sync`, so the
 * editor and CRDT sync cannot drift between surfaces.
 */

const config: CapacitorConfig = {
  appId: 'com.aimarkdown.mobile',
  appName: 'AiMD',
  webDir: 'www',
  backgroundColor: '#ffffff',
  android: {
    // The webview origin uses https:// scheme so a self-hosted http server is reachable as a
    // cross-origin endpoint; cleartext to that server is granted in AndroidManifest.xml
    // (sideload builds only, see AndroidManifest comment).
    allowMixedContent: false,
  },
  ios: {
    contentInset: 'automatic',
  },
};

export default config;
