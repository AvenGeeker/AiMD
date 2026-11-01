import { preferences } from '@kit.ArkData';
import { webview } from '@kit.ArkWeb';
import { common } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';

const TAG = 'AiMD';

/**
 * Native ⇄ renderer token bridge.
 *
 * The renderer (apps/web/src/lib/mobile.ts) calls `window.aiMarkdownHarmony.get/set/remove`.
 * Storage is a private Preferences DB; switching to HUKS-encrypted storage is a documented
 * follow-up. If a bridge call throws, the renderer falls back to @capacitor/preferences and
 * finally localStorage, so a broken bridge can never lock the user out.
 */
class TokenBridge {
  private pref: preferences.Preferences | null = null;

  constructor(context: common.Context) {
    preferences.getPreferences(context, { name: 'aimarkdown_tokens' })
      .then((store) => {
        this.pref = store;
      })
      .catch((err: Error) => {
        hilog.error(0x0000, TAG, 'init preferences failed: %{public}s', err.message);
      });
  }

  private async ready(): Promise<preferences.Preferences> {
    // Preferences is initialised asynchronously; wait a bounded time for it.
    for (let i = 0; i < 100 && this.pref === null; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return this.pref as preferences.Preferences;
  }

  async get(key: string): Promise<string> {
    const store = await this.ready();
    const value = await store.get(key, '');
    return typeof value === 'string' ? value : '';
  }

  async set(key: string, value: string): Promise<void> {
    const store = await this.ready();
    await store.put(key, value);
    await store.flush();
  }

  async remove(key: string): Promise<void> {
    const store = await this.ready();
    await store.delete(key);
    await store.flush();
  }
}

@Entry
@Component
struct Index {
  @State private controller: webview.WebviewController = new webview.WebviewController();
  private bridge: TokenBridge | null = null;

  aboutToAppear(): void {
    this.bridge = new TokenBridge(getContext(this));
  }

  build() {
    Column() {
      Web({ src: $rawfile('www/index.html'), controller: this.controller })
        .javaScriptProxy({
          object: this.bridge as TokenBridge,
          name: 'aiMarkdownHarmony',
          methodList: [],
          asyncMethodList: ['get', 'set', 'remove'],
          controller: this.controller
        })
        .domStorageAccess(true)
        // The renderer stores its CRDT cache in IndexedDB (y-indexeddb), exactly like the
        // browser and the Electron shell.
        .databaseAccess(true)
        .allowFileAccess(true)
        .javaScriptAccess(true)
        .width('100%')
        .height('100%')
    }
    .width('100%')
    .height('100%')
  }
}
