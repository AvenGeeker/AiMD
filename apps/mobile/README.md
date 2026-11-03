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

## 折叠屏与横竖屏

三端共用 `apps/web` 的同一套响应式移动壳，原生壳只负责方向、窗口尺寸和安全区，不各自实现布局。
判定使用 CSS 像素宽度，折叠、展开、旋转和 Android 分屏都会实时重新计算，无需重启或重新加载：

| 可用宽度 | 布局 | 交互 |
| --- | --- | --- |
| < 600px | 单栏 | 笔记列表 ⇄ 编辑器，左侧导航从抽屉打开（折叠状态手机） |
| 600–839px | 双栏 | 左笔记列表 + 右编辑器；导航抽屉保留，左侧列表可隐藏 |
| ≥ 840px | 三栏 | 导航栏 + 笔记列表 + 编辑器，接近桌面端；左侧导航可隐藏 |

因此典型折叠屏：折叠竖持是单栏；展开竖持是双栏；展开横持或平板宽度是三栏。布局偏好按设备保存在
`localStorage`，折叠后再展开不会把用户主动隐藏的侧栏重新弹出来。

- Android：`MainActivity` 已声明 `orientation|screenSize|smallestScreenSize|screenLayout|density`
  等 `configChanges`，WebView 不会因旋转/折叠重建。
- iOS：`Info.plist` 同时允许 iPhone/iPad 的横竖屏，根视图使用 `100dvh` 和
  `safe-area-inset-*`，横屏刘海/圆角不会压住工具栏。
- HarmonyOS：`Web` 组件宽高均为 `100%`，设备方向沿用系统自动旋转；`phone`/`tablet` 都声明为
  支持的 deviceType。

回归用例在 `apps/web/e2e/mobile-foldable.spec.ts`，覆盖 700px 展开双栏、折叠回 390px 单栏，
以及 900px 三栏左侧导航的隐藏/恢复。

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


## 分享到收藏

- **Android**：`MainActivity` 接收 `ACTION_SEND` / `ACTION_SEND_MULTIPLE`，把文本和文件写入缓存后注入 `window.__aimdReceiveShare`。可用 `adb shell am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT "https://..." com.aimarkdown.mobile` 冒烟。
- **iOS**：`AiMDShare` Share Extension 把 URL/文本/图片/视频写入 App Group `group.com.aimarkdown.mobile`，再通过 `aimarkdown://share` 拉起宿主 App。模拟器构建已验证；真机需要开发者团队签名并为宿主与扩展同时启用 App Group。
- **HarmonyOS**：`module.json5` 声明 `ohos.want.action.sendData`，`EntryAbility` 在冷/热启动时把分享内容写入 `AppStorage`，`Index.ets` 注入 WebView。ArkWeb 分享目录需要加入 `setPathAllowingUniversalAccess`。
- 未登录时分享内容会暂存在本机，登录后自动打开收藏预览；不会在用户确认前写入服务端。


桌面端「设置 → 速记与桌面」还可以录制「收藏链接」全局快捷键，默认 `CommandOrControl+Shift+F`；托盘菜单同样提供「收藏链接…」入口。
