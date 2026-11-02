# apps/mobile — Android / iOS / HarmonyOS shell

Capacitor 工程，渲染层复用 `apps/web` 的构建产物（与 desktop 的 `renderer/` 同一套契约：一份 Vite 构建同时服务浏览器、Electron、三端移动 App）。

## 首次准备

```bash
make dev               # 已有服务端（也可以连接任意自托管实例）
pnpm install           # 安装 @capacitor/* 依赖
pnpm --filter @aimarkdown/mobile add:android
pnpm --filter @aimarkdown/mobile add:ios
```

`add:*` 会生成 `android/`（Gradle 工程）与 `ios/`（Xcode 工程），首次需要本机已装
Android SDK 与 Xcode。生成后目录提交进仓库，之后不需要再 add。

## 构建

```bash
pnpm --filter @aimarkdown/mobile build:renderer   # web build + stage 到 www/
pnpm --filter @aimarkdown/mobile build:apk        # Android debug APK → android/app/build/outputs/apk/debug/
pnpm --filter @aimarkdown/mobile build:ipa        # iOS 模拟器构建（不签名）
pnpm --filter @aimarkdown/mobile build:hap        # HarmonyOS —— 需要 DevEco Studio（见下）
```

真机调试：`pnpm --filter @aimarkdown/mobile open:android` / `open:ios` 打开原生 IDE。
App 内首次启动会引导填写自托管服务器地址（与桌面端一致），之后走既有 bearer 鉴权 +
Hocuspocus WebSocket 同步，离线依赖 WebView 的 IndexedDB（y-indexeddb），与浏览器一致。

## Android / iOS 明文 HTTP（自用侧载专用）

自托管服务若未上 HTTPS，移动端 WebView 默认会拦截 http 请求。v1 自用侧载构建在：

- Android：`android/app/src/main/AndroidManifest.xml` 已设 `android:usesCleartextTraffic="true"`
- iOS：`ios/App/App/Info.plist` 已加 `NSAppTransportSecurity` 例外

上架/公开分发前必须移除这两处并强制 HTTPS。

## HarmonyOS

`harmony/` 是**最小自写 ArkWeb harness**（Stage 模型 + Web 组件 + javaScriptProxy 桥接），原生面只有
「token 安全存储」一项，与 `apps/web/src/lib/mobile.ts` 的 `window.aiMarkdownHarmony` 桥对应。

```bash
make mobile-hap        # copy-renderer → 同步 resfile → ohpm install → hvigorw assembleHap
# HAP 输出：apps/mobile/harmony/entry/build/default/outputs/default/
```

`build:hap` 会自动定位 DevEco Studio 自带的 hvigor 工具链（`Contents/tools/hvigor/bin/hvigorw`）。

**两个容易踩的坑：**

1. **不要**在 `oh-package.json5` 的 devDependencies 里声明 `@ohos/hvigor-ohos-plugin`——它不属于 ohpm
   仓库（`ohpm install` 会 404，错误形如 `FetchPackageInfo @ohos/hvigor-ohos-plugin failed`），hvigor
   插件由 DevEco 自带的工具链按 `hvigor/hvigor-config.json5` 解析。
2. 构建需要 **HarmonyOS NEXT SDK（API 12 / 5.0.0(12) 或更新）**，不是老的 OpenHarmony API 9 SDK。
   缺 SDK 时脚本会给出指引：DevEco Studio → Settings → SDK Manager → 安装 HarmonyOS SDK。
   若 SDK 装在其他位置，先 `export DEVECO_SDK_HOME=/path/to/sdk`。

拿到 SDK 后也可以直接在 DevEco Studio 打开 `apps/mobile/harmony`：File → Sync，然后 Build → HAP。

