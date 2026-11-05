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
| < 600px | 单栏 | 底部 Tab Bar（笔记 / 收藏 / 速记 / 我的）+ 情境 FAB；大标题列表 ⇄ 全屏编辑器；目录与标签收进筛选 Sheet（折叠状态手机） |
| 600–839px | 双栏 | 左笔记列表 + 右编辑器；导航抽屉保留，列表头部用分段切换笔记/收藏/速记，左侧列表可隐藏 |
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


## 移动端交互（< 600px）

手机宽度是一套独立的触摸外壳，交互对齐 Apple Notes / Notion 移动端：

- **底部 Tab Bar + FAB**：四个 Tab（笔记 / 收藏 / 速记 / 我的），徽标显示待分类收藏数与速记条数；
  FAB 按 Tab 变形（新建笔记 / 收藏链接 / 记一条速记）。进入编辑器后两者都隐藏，底部换成
  编辑/预览 + AI/标签/设置的工具栏。
- **大标题列表**：作用域标题滚动 24px 后收缩成紧凑条；内联搜索（≥2 字符才发请求）、排序菜单
  （最近更新 / 最近创建 / 标题 / 手动排序，按设备记忆）、筛选 Sheet（目录树 + 标签 + 回收站）。
  列表按 置顶 / 今天 / 昨天 / 更早 分组成圆角卡片。
- **滑动手势**：左划露出「置顶 / 删除」，继续全划直接进回收站并弹出 5 秒「撤销」；右划快捷置顶；
  点按已展开的行或行外任意位置收回。行内左划从 26px 之后才开始识别，把 iOS 左边缘返回手势让出来。
- **长按多选**：按住 500ms 进入多选；底部批量工具栏提供 置顶 / 移动 / 标签 / 删除，回收站视图换成
  恢复 / 彻底删除 / 清空回收站（清空为服务端全量且需二次确认）。桌面端同一套状态机走
  Cmd/Ctrl 点选 + Shift 范围选。
- **批量写路径**：所有批量操作走 `POST /api/notes/batch`，服务端逐条经 Hocuspocus 直连写 Y.Doc
  再刷投影；响应带 per-item 结果，跨租户 id 返回 `NOT_FOUND` 而不影响同批其他笔记。
- **下拉刷新**：列表在顶部下拉 ≥56px 触发 notes/tree 重新拉取；多选或有展开行时禁用。
- **触感反馈**：Android / iOS 经 `@capacitor/haptics` 在选中、滑动提交、批量完成时给轻/中触感；
  HarmonyOS 与浏览器无插件，静默降级为无触感。
- **我的页**：账户卡片、同步状态与「立即同步」、主题分段（跟随系统/浅色/深色）、回收站与导入导出、
  设置入口、退出登录（二次确认）。

## 沉浸式状态栏 / 导航栏

三端窗口都是 edge-to-edge，系统栏透明、内容延伸到栏下，渲染层只靠
`env(safe-area-inset-*)`（`index.html` 的 `viewport-fit=cover` 是前提，不能删）让顶栏 / Tab Bar /
FAB 避开刘海与手势条：

- **Android**：`values/styles.xml` 把 `statusBarColor` / `navigationBarColor` 设为透明并关闭对比度
  强制，`windowLayoutInDisplayCutoutMode=shortEdges` 让横屏用满刘海屏；`MainActivity` 调
  `WindowCompat.setDecorFitsSystemWindows(window, false)`（Android 15+ 平台强制 edge-to-edge，
  这些标志保证 14 及以下一致）。
- **iOS**：WKWebView 天然延伸到状态栏与 Home 指示条下；`Info.plist` 已开
  `UIViewControllerBasedStatusBarAppearance`，图标颜色由插件切换。
- **HarmonyOS**：`EntryAbility.onWindowStageCreate` 调 `setWindowLayoutFullScreen(true)`，
  `Index.ets` 的 Web 组件 `.expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP,
  SafeAreaEdge.BOTTOM])`。注意这两个枚举是 ArkTS 全局枚举，不能从 `@kit.ArkUI` import。
- **图标颜色跟随 App 主题**：`apps/web/src/lib/statusBar.ts` 在主题变化时调用
  `@capacitor/status-bar`（Android / iOS）或 bridge 的 `setStatusBarDark`（HarmonyOS）；
  浏览器与 Electron 是 no-op。

构建 APK 需要 **JDK 17**（AGP 要求）；本机只有 JDK 11 时 `make mobile-apk` 会直接报
"Android Gradle plugin requires Java 17"。iOS 模拟器构建 `make mobile-ipa` 与 HarmonyOS
`make mobile-hap` 不依赖 JDK（后者用 DevEco 自带 hvigor + `~/Library/Huawei/Sdk`）。

## 分享到收藏

- 应用内：笔记列表标题栏常驻「收藏」按钮，可在一级页面直接粘贴链接；收藏列表和抽屉中也保留入口。
- **Android**：`MainActivity` 接收 `ACTION_SEND` / `ACTION_SEND_MULTIPLE`，把文本和文件写入缓存后注入 `window.__aimdReceiveShare`。可用 `adb shell am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT "https://..." com.aimarkdown.mobile` 冒烟。
- **iOS**：`AiMDShare` Share Extension 把 URL/文本/图片/视频写入 App Group `group.com.aimarkdown.mobile`，再通过 `aimarkdown://share` 拉起宿主 App。模拟器构建已验证；真机需要开发者团队签名并为宿主与扩展同时启用 App Group。
- **HarmonyOS**：`module.json5` 声明 `ohos.want.action.sendData`，`EntryAbility` 在冷/热启动时把分享内容写入 `AppStorage`，`Index.ets` 注入 WebView。ArkWeb 分享目录需要加入 `setPathAllowingUniversalAccess`。
- 未登录时分享内容会暂存在本机，登录后自动打开收藏预览；不会在用户确认前写入服务端。


桌面端「设置 → 速记与桌面」还可以录制「收藏链接」全局快捷键，默认 `CommandOrControl+Shift+F`；托盘菜单同样提供「收藏链接…」入口。


## 桌面卡片

三端都提供「收藏链接」快捷卡片，点按后打开同一个收藏输入框：

- **Android**：`FavoriteWidgetProvider` 注册 2×1 AppWidget；点击用显式 `PendingIntent` 拉起 `MainActivity`，再注入 `window.__aimdOpenFavorite()`。
- **iOS**：`AiMDWidgets` WidgetKit 扩展支持小号和中号卡片，通过 `aimarkdown://favorite` 深链唤起宿主；真机需要为 `com.aimarkdown.mobile.widget` 扩展单独签名。
- **HarmonyOS**：`FavoriteWidgetAbility` 注册 2×2 服务卡片；点击通过 `postCardAction` 路由到 `EntryAbility`，再注入同一个 JS 方法。

共享 renderer 在 React 挂载前安装 `window.__aimdOpenFavorite()`，并用 `localStorage` 暂存请求，因此冷启动、未登录或需要先登录时都不会丢失卡片动作。
