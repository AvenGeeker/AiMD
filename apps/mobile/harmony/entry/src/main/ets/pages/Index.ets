import { preferences } from '@kit.ArkData';
import { webview } from '@kit.ArkWeb';
import { common } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
// `SafeAreaType` / `SafeAreaEdge` are global ArkTS enums (component-common declarations); they
// are NOT exported by any kit, so importing them from '@kit.ArkUI' fails the ArkTS compile.
import { window } from '@kit.ArkUI';

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
  private initPromise: Promise<void> | null = null;
  private context: common.Context | null = null;

  init(context: common.Context): void {
    this.context = context;
    if (this.initPromise !== null) {
      return;
    }
    this.initPromise = preferences.getPreferences(context, { name: 'aimarkdown_tokens' })
      .then((store: preferences.Preferences) => {
        this.pref = store;
      })
      .catch((err: Error) => {
        hilog.error(0x0000, TAG, 'init preferences failed: %{public}s', err.message);
      });
  }

  private async ready(): Promise<preferences.Preferences> {
    if (this.initPromise !== null) {
      await this.initPromise;
    }
    if (this.pref === null) {
      throw new Error('preferences not initialized');
    }
    return this.pref;
  }

  async get(key: string): Promise<string> {
    const store = await this.ready();
    try {
      const value = await store.get(key, '');
      return typeof value === 'string' ? value : '';
    } catch (err) {
      const e = err as Error;
      hilog.error(0x0000, TAG, 'bridge get failed: %{public}s', e.message);
      throw e;
    }
  }

  async set(key: string, value: string): Promise<void> {
    const store = await this.ready();
    try {
      await store.put(key, value);
      await store.flush();
    } catch (err) {
      const e = err as Error;
      hilog.error(0x0000, TAG, 'bridge set failed: %{public}s', e.message);
      throw e;
    }
  }

  async remove(key: string): Promise<void> {
    const store = await this.ready();
    try {
      await store.delete(key);
      await store.flush();
    } catch (err) {
      const e = err as Error;
      hilog.error(0x0000, TAG, 'bridge remove failed: %{public}s', e.message);
      throw e;
    }
  }

  /**
   * Immersive bars: mirror the renderer's theme into the status/navigation icon colour so the
   * icons stay readable on both themes while the page draws edge-to-edge.
   */
  async setStatusBarDark(dark: boolean): Promise<void> {
    if (this.context === null) {
      return;
    }
    try {
      const win = await window.getLastWindow(this.context);
      const color = dark ? '#FFFFFF' : '#1F2229';
      await win.setWindowSystemBarProperties({
        statusBarContentColor: color,
        navigationBarContentColor: color,
      });
    } catch (err) {
      const e = err as Error;
      hilog.error(0x0000, TAG, 'status bar style failed: %{public}s', e.message);
    }
  }
}

@Entry
@Component
struct Index {
  @State private controller: webview.WebviewController = new webview.WebviewController();
  private bridge: TokenBridge = new TokenBridge();
  private abilityContext: common.UIAbilityContext | null = null;
  private wwwDir: string = '';
  @State private pageUrl: string = '';
  @StorageLink('aimdSharePayload') @Watch('onSharePayloadChange') private sharePayload: string = '';
  @StorageLink('aimdOpenFavorite') @Watch('onOpenFavoriteChange') private openFavoriteToken: string = '';

  onSharePayloadChange(): void {
    this.flushShare();
  }

  onOpenFavoriteChange(): void {
    this.flushOpenFavorite();
  }

  aboutToAppear(): void {
    const context = this.getUIContext().getHostContext();
    if (context !== undefined) {
      this.abilityContext = context as common.UIAbilityContext;
      this.bridge.init(context);
      this.wwwDir = `${context.resourceDir}/www`;
      this.pageUrl = `file://${this.wwwDir}/index.html`;
    }
  }

  /**
   * System back (gesture or navigation bar).
   *
   * The renderer owns navigation state and exposes `window.__aimdHandleBack()`, which peels one
   * layer per press (overlay -> editor -> list) and answers `exit` only on the root list. ArkWeb
   * has no history entries to pop here, so the decision has to be made in JS; the callback is
   * async, hence we always consume the press and terminate the ability ourselves when needed.
   */
  onBackPress(): boolean {
    this.handleBackPress();
    return true;
  }

  private async handleBackPress(): Promise<void> {
    let action = 'exit';
    try {
      const result = await this.controller.runJavaScript(
        'window.__aimdHandleBack ? window.__aimdHandleBack() : "exit"');
      action = result.split('"').join('').trim();
    } catch (err) {
      const e = err as Error;
      hilog.error(0x0000, TAG, 'back dispatch failed: %{public}s', e.message);
    }
    if (action === 'exit') {
      this.exitApp();
    }
  }

  private flushShare(): void {
    if (this.sharePayload.length === 0) {
      return;
    }
    const payload = this.sharePayload;
    const script = `window.__aimdReceiveShare && window.__aimdReceiveShare(${payload})`;
    this.controller.runJavaScript(script).catch((err: Error) => {
      hilog.error(0x0000, TAG, 'share inject failed: %{public}s', err.message);
    }).finally(() => {
      this.sharePayload = '';
    });
  }

  private flushOpenFavorite(): void {
    if (this.openFavoriteToken.length === 0) {
      return;
    }
    const token = this.openFavoriteToken;
    this.openFavoriteToken = '';
    this.controller.runJavaScript('window.__aimdOpenFavorite && window.__aimdOpenFavorite();')
      .catch((err: Error) => {
        hilog.error(0x0000, TAG, 'favorite inject failed: %{public}s', err.message);
      })
      .finally(() => {
        this.openFavoriteToken = '';
        hilog.info(0x0000, TAG, 'favorite action consumed %{public}s', token);
      });
  }

  private exitApp(): void {
    if (this.abilityContext === null) {
      return;
    }
    try {
      this.abilityContext.terminateSelf();
    } catch (err) {
      const e = err as Error;
      hilog.error(0x0000, TAG, 'terminateSelf failed: %{public}s', e.message);
    }
  }

  build() {
    Column() {
      Web({ src: this.pageUrl, controller: this.controller })
        // ES modules and stylesheets are rejected when loaded from resource://rawfile, because
        // ArkWeb treats that origin as null and only allows CORS-capable schemes. Loading the
        // bundle over file:// with this directory whitelisted keeps the ESM chunks working.
        .onControllerAttached(() => {
          if (this.wwwDir.length === 0) {
            return;
          }
          try {
            this.controller.setPathAllowingUniversalAccess([this.wwwDir]);
          } catch (err) {
            const e = err as Error;
            hilog.error(0x0000, TAG, 'allow universal access failed: %{public}s', e.message);
          }
        })
        .onPageEnd(() => {
          this.flushShare();
          this.flushOpenFavorite();
        })
        .javaScriptProxy({
          object: this.bridge,
          name: 'aiMarkdownHarmony',
          methodList: [],
          asyncMethodList: ['get', 'set', 'remove', 'setStatusBarDark'],
          controller: this.controller
        })
        .domStorageAccess(true)
        // The renderer stores its CRDT cache in IndexedDB (y-indexeddb), exactly like the
        // browser and the Electron shell.
        .databaseAccess(true)
        .fileAccess(true)
        .javaScriptAccess(true)
        .onConsole((event) => {
          if (event) {
            hilog.debug(0x0000, TAG, 'console: %{public}s', event.message.getMessage());
          }
          return false;
        })
        .onErrorReceive((event) => {
          if (event) {
            hilog.error(0x0000, TAG, 'load error: %{public}s %{public}s',
              event.request.getRequestUrl(), event.error.getErrorInfo());
          }
        })
        // Immersive: draw under the status and navigation bars; the renderer reports them as
        // env(safe-area-inset-top/bottom) because index.html sets viewport-fit=cover.
        .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
        .width('100%')
        .height('100%')
    }
    .width('100%')
    .height('100%')
  }
}
