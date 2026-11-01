# AiMD

自托管的多端同步 Markdown 笔记本。一套 React 代码同时作为**浏览器端**和 **Electron 桌面端**（macOS / Windows）的界面，服务端是 **Fastify + Hocuspocus + Postgres**，用 **Docker Compose 一键部署**。

- **多端同步**：基于 **Yjs CRDT**，离线可写，联网后字符级自动合并，不会互相覆盖
- **Markdown 编辑与预览**：CodeMirror 6 源码编辑 + 实时预览，支持分栏 / 纯编辑 / 纯预览三态
- **全局快捷键速记**：可分别设置「打开主窗口」和「打开数据窗口」的全局热键，设置页录制按键组合；速记内容以 CRDT 追加写入「收集箱」
- **AI 总结与自动标签**：服务端调用 OpenAI 兼容接口，为笔记生成摘要、要点、可勾选待办和最多 3 个标签；支持首次回填

---

## 一键部署

需要一台服务器，装好 Docker Engine + Compose v2 插件。部署脚本交互式询问部署地址，支持两种模式：

| 模式 | 场景 | 访问方式 |
| --- | --- | --- |
| **域名模式**（推荐） | 有域名（及 DNS 指向服务器） | `https://你的域名/`，Caddy 自动申请 / 续期 Let's Encrypt 证书 |
| **无域名 / IP 直连** | 没有域名，只想先跑起来 | `http://服务器IP:端口/`，纯 HTTP，浏览器会提示“不安全”，忽略即可 |

```bash
git clone <your-repo> AiMD && cd AiMD
./scripts/deploy.sh
```

脚本会依次完成：

1. 检查 Docker 与端口占用
2. 首次运行时交互式生成 `deploy/.env`：询问域名（或公网 IP + 端口），用 `openssl rand` 填充 `JWT_SECRET` 与 `POSTGRES_PASSWORD`，并推导 Caddy 的站点地址 `CADDY_SITE_ADDR`
3. `docker compose up -d --build` 构建并启动 **Caddy + app + Postgres**
4. 数据库迁移在容器启动时自动执行（幂等），无需手动步骤
5. 轮询 `/api/health`，成功后打印访问地址

部署完成后访问脚本打印的地址注册第一个账号。**注册默认开放**，创建好自己的账号后，把 `deploy/.env` 里的 `ALLOW_REGISTRATION=false` 并重新执行 `./scripts/deploy.sh` 关闭注册。

### 域名模式（自动 HTTPS）

`deploy/.env` 里 `PUBLIC_URL=https://你的域名`（带协议），`CADDY_SITE_ADDR` 由脚本自动推导。Caddy 绑定 80（跳转）与 443（TLS），自动申请并续期 Let's Encrypt 证书。若 80/443 被别的服务占用，可改 `HTTP_PORT` / `HTTPS_PORT`。

### 无域名 / IP 直连（纯 HTTP 试用）

脚本提示输入公网 IP 与端口（默认 `8080`）。`PUBLIC_URL=http://IP:端口`，`CADDY_SITE_ADDR=http://IP`（**不带端口**，Caddy 在容器内绑定 80，宿主机对外端口由 `HTTP_PORT` 决定）。

- **大陆区 ECS 未备案时，80/443 会被运营商拦截**，所以必须用非标端口（这就是默认 8080 的原因）；境外区（如香港）可留 80。
- 纯 HTTP 下登录 cookie 不带 `Secure` 标志（服务端按请求协议判断，Caddy 透传 `X-Forwarded-Proto`），功能与 HTTPS 一致。
- 之后配好域名：改 `deploy/.env` 的 `PUBLIC_URL` / `CADDY_SITE_ADDR` / `HTTP_PORT`，重新执行 `./scripts/deploy.sh` 即可平滑切到 HTTPS。

如果拉取镜像失败（国内网络常见），脚本会提示配置镜像加速，详见[国内网络](#国内网络注意事项)。

### 常用运维命令

```bash
make logs            # 跟踪应用日志
make ps              # 查看容器状态
make backup          # 备份数据库 + 附件到 ./backups/
make deploy-rebuild  # 重新构建并部署
make down            # 停止（保留数据卷）
```

备份脚本导出 `pg_dump`（custom 格式）与附件卷，并快照 `deploy/.env`。定时备份示例：

```cron
30 3 * * * cd /path/to/AiMD && ./scripts/backup.sh --keep 14 >> /var/log/aimarkdown-backup.log 2>&1
```

---

## 在 Mac 上编译运行

### 前置

```bash
node -v      # 需要 >= 22（实测 v24.13.0）
pnpm -v      # 需要 10.x（实测 10.6.5）
docker -v    # 需要 Compose v2 插件
```

首次准备：

```bash
pnpm install     # 会自动批准 esbuild / @node-rs/argon2 / electron 的构建脚本
make db-up       # 启动开发库(:5433) 与测试库(:5434)
```

### 方式 A：浏览器里跑（最快，改代码即时热更新）

```bash
make dev
# → API  http://127.0.0.1:3000
# → Web  http://127.0.0.1:5173   ← 打开这个
```

Vite 会把 `/api` 与 `/collab` 代理到本地服务端，所以浏览器只连 5173 一个源。

### 方式 B：Electron 桌面端（含全局快捷键速记窗）

保持方式 A 在跑，另开一个终端：

```bash
pnpm --filter @aimarkdown/desktop dev
```

脚本会自动探测 `http://127.0.0.1:5173`：探测到就用 Vite（编辑器热更新），否则加载已构建产物并提示你先 `pnpm --filter @aimarkdown/web build`。首次启动会让你填服务器地址，本地开发填 `http://127.0.0.1:3000`。

启动后按 **⌥Space** 唤出数据/速记窗，`⌘Enter` 写入收集箱，`Esc` 关闭；按 **⌘⇧M** 打开主窗口。两个快捷键都可以在「设置 → 桌面端」里点击后直接按下新的组合键来修改。

> 如果被 Raycast / Alfred 占用，注册会失败——托盘菜单和设置页都会明确提示，录制一个不同的组合即可，不会静默失效。

### 方式 C：打包成 .app / .dmg

```bash
pnpm --filter @aimarkdown/desktop dist:mac
# 产物在 apps/desktop/release/：
#   AiMD-0.1.0.dmg              (x64，Intel)
#   AiMD-0.1.0-arm64.dmg        (Apple Silicon)
```

只想打本机架构、省一半时间：

```bash
cd apps/desktop && pnpm build && npx electron-builder --mac --x64
```

**产物未签名**（没有 Apple Developer ID），首次打开会被 Gatekeeper 拦：右键 → 打开，或到「系统设置 → 隐私与安全性」点「仍要打开」。要正式分发需要配置签名与公证，见 `apps/desktop/package.json` 的 `build.mac`（把 `identity: null` 换成你的证书并开启 `hardenedRuntime`）。

> 打包前必须先构建 renderer：`pnpm build` 会按 `web 构建 → 主进程编译 → stage renderer` 的顺序做完。如果单独跑了 `electron-builder` 而没重新 stage，`copy-renderer.mjs` 会告警提示 bundle 可能过期。

### 移动端 App（Android / iOS / HarmonyOS）

在 `apps/mobile` 下，用 **Capacitor** 复用同一份 React 渲染层（与 Electron 相同的 `web/dist` 契约）。
服务端、CRDT 同步、离线缓存全部沿用现有实现：移动端走 bearer 鉴权 + `/collab` WebSocket，
离线靠 WebView 的 IndexedDB（y-indexeddb）。

```bash
# 首次：安装依赖并生成原生工程（Android SDK / Xcode）
pnpm install
pnpm --filter @aimarkdown/mobile add:android
pnpm --filter @aimarkdown/mobile add:ios

# 改完 web 后重新打包
make mobile-build         # web build → stage → 同步 www 与 harmony rawfile
make mobile-apk           # Android debug APK → apps/mobile/android/app/build/outputs/apk/debug/
make mobile-ipa           # iOS 模拟器构建（未签名）
make mobile-hap           # HarmonyOS HAP —— 需要 DevEco Studio（本机未装，v1 为阻塞项）
```

- 首启会在登录页引导填写自托管服务器地址（与桌面端一致），Token 存 Keychain / Android Keystore。
- Android 工程钉在 **AGP 8.7.3 / compileSdk 35**（兼容 2025 代 Android Studio，原因和升级路径见 `apps/mobile/android/variables.gradle` 注释）；Gradle 保持 8.14.3。
- 自用侧载构建已放开明文 HTTP（AndroidManifest / Info.plist 有注释标记），上架前必须移除并强制 HTTPS。
- HarmonyOS 走 `apps/mobile/harmony` 的最小 ArkWeb harness（Stage 模型 + javaScriptProxy 桥），
  native 插件面仅 token 存储一项；拿到 DevEco Studio 后 `cd apps/mobile/harmony && ohpm install && hvigorw assembleHap`。

### 本地开发

```bash
pnpm install
make db-up      # 启动开发用 Postgres（:5433）与测试库（:5434）
make dev        # 同时启动 API（:3000）与 Vite（:5173）
```

### 测试

```bash
make test                # 单元测试（不需要数据库）
make test-integration    # 集成测试：真实 Postgres + 真实 Hocuspocus WebSocket
make test-e2e            # Playwright 端到端（需要先 make db-up）
make typecheck && make lint
```

---

## 架构

```
┌─────────────┐  ┌─────────────┐  ┌──────────────┐
│ 浏览器 (Web) │  │ Electron 主窗 │  │ Electron 速记窗 │
└──────┬──────┘  └──────┬──────┘  └──────┬───────┘
       │   同一个 Vite 构建产物（apps/web/dist）  │
       │  REST /api          WebSocket /collab   │
       └──────────────┬──────────────┬───────────┘
                      ▼              ▼
              ┌──────────────────────────────┐
              │   Node 进程（apps/server）     │
              │  Fastify :3000  Hocuspocus :1234│
              └───────────────┬──────────────┘
                              ▼
                    ┌───────────────────┐
                    │ Postgres 18       │
                    │  note_documents   │ ← CRDT 二进制（唯一真相）
                    │  notes/folders/…  │ ← 关系型镜像（查询/搜索/树）
                    └───────────────────┘
```

### 仓库结构

| 路径 | 说明 |
| --- | --- |
| `packages/shared` | zod API 契约、CRDT 文档命名与结构、分数排序、统一错误码 |
| `packages/markdown` | 同步、无 DOM 依赖的渲染管线（GFM / KaTeX / mermaid / wikilink / 任务列表）+ DOMPurify 消毒与浏览器端增强 |
| `apps/server` | Fastify REST + Hocuspocus 协同服务 + Postgres 镜像投影 |
| `apps/web` | React 19 + Vite + CodeMirror 6，浏览器与 Electron 共用 |
| `apps/desktop` | Electron 外壳：主窗口、托盘、全局快捷键、`safeStorage` 凭据 |
| `deploy/` | 生产与开发用 Compose、Caddyfile、`.env` 模板、镜像加速示例 |
| `scripts/` | `deploy.sh` / `backup.sh` / `dev.sh` |

### CRDT 数据模型

只有两类 Y.Doc：

- **`note-{noteId}`** — `Y.Text body`（Markdown 正文）、`Y.Map meta`（标题、目录、置顶、归档、软删除、排序位）、`Y.Array tagIds`
- **`workspace-{userId}`** — `Y.Map folders`、`Y.Map tags`、`Y.Map settings`

**Y.Doc 是唯一真相**，Postgres 里同名的列都是从它投影出来的镜像，由 Hocuspocus 的 `store` 钩子在同一个事务里刷新。列表、搜索、目录树全部读镜像，因此永远不需要为渲染而反序列化 Y.Doc。

REST 写操作（移动目录、置顶、打标签）不会绕过 CRDT：服务端通过 Hocuspocus 的 **direct connection** 打开真实文档、改动、再广播给所有在线客户端，和浏览器发起的修改走完全相同的路径。

客户端同时挂载 `y-indexeddb`，所以断网时照常编辑，重连后自动合并。

---

## 桌面端

### 全局快捷键速记

- 「打开主窗口」默认 **`⌘⇧M` / `Ctrl+Shift+M`**；「打开数据窗口」默认 **macOS `⌥Space`** / **Windows `Ctrl+Alt+Space`**
- 在「设置 → 桌面端」点击快捷键框后直接按下新组合即可录制；设置存在 workspace CRDT 里，因此多端一致
- 两个快捷键独立注册；注册失败（被 Raycast / Alfred 等占用）时，托盘菜单与设置页都会明确告警，不会静默失效
- 小窗无边框、置顶、跨 Space 可见；`Esc` 或失焦隐藏（隐藏而非销毁，保持热启动）
- `⌘/Ctrl + Enter` 提交，内容以 CRDT 追加写入收集箱末尾——即使此刻另一台设备正在编辑这篇笔记的中间部分，两边都不会丢
- 主窗口左侧「速记」会按时间戳把收集箱里的速记拆成独立条目；点击条目可直接跳到对应的速记位置

### macOS 备忘录双向同步

macOS 桌面端标题栏有「备忘录」按钮，设置里有「macOS 备忘录同步（仅此 Mac）」：

- 默认 Apple 备忘录账户与当前 AiMD 用户**全库双向镜像**：文件夹双向，笔记新建/编辑/删除双向；包含收集箱和归档，排除回收站（删除会进入 app 回收站和 Apple 的 `AiMD 回收站 (App)` 目录，可恢复）
- 首次启用必须先扫描预览，确认后才写入；之后支持手动、启动时和定时同步（默认 30 分钟）
- 笔记正文/文件夹冲突按最新修改优先；失败版本会复制到 app 并打「Apple 同步冲突」标签
- 图片、PDF、普通文件尽量双向同步；Apple Notes 无法导出的绘图/扫描件/录音、加密或共享内容会让对应笔记进入只读并打「Apple 同步只读」标签
- 同步引擎运行在 Electron 主进程，映射保存在本机 `userData/apple-notes-sync.json`。同一账号只应在一台 Mac 上启用；换 Mac 前先停用旧机器
- 首次同步/重建未签名 app 后，点设置里的「请求授权」或「预览差异」才会触发 macOS「控制备忘录」授权框；授权前「系统设置 → 隐私与安全性 → 自动化」里不会出现 AiMD。拒绝或重置后可在那里重新授权
- 定时同步要求 AiMD 保持运行；关闭窗口驻留托盘即可。笔记排序、置顶、标签和 Apple 智能文件夹不参与同步

### 打包

```bash
pnpm --filter @aimarkdown/desktop dist:mac   # dmg + zip，x64 与 arm64
pnpm --filter @aimarkdown/desktop dist:win   # nsis，x64
```

**v1 不做代码签名与公证**（没有 Apple Developer ID / Windows 证书）。用户首次打开时：

- **macOS**：右键 → 打开，或在「系统设置 → 隐私与安全性」中点「仍要打开」
- **Windows**：SmartScreen 提示时选「更多信息 → 仍要运行」

`electron-updater` 依赖已保留但**未启用**自动更新检查——它需要一个发布源（如 GitHub Releases），配置好后把 `autoUpdater` 接上即可。

---

## 国内网络注意事项

部署脚本假设 Docker Hub 可能不可达。实测情况（2026-10-30）：

| 镜像源 | 状态 |
| --- | --- |
| `registry-1.docker.io` / `index.docker.io` | 超时不可达 |
| `docker.m.daocloud.io` | 可达（`/v2/` 返回 401 属正常） |
| `dockerproxy.net` | 可达（200） |
| `hub-mirror.c.163.com` | 已失效 |

如果拉取镜像失败，把 `deploy/daemon.json.mirror` 里的 `registry-mirrors` 合并进 `/etc/docker/daemon.json`，重启 Docker 后重跑部署。**先检查现有配置**——很多机器已经配好了镜像加速。

也可以在本地构建后离线传输：

```bash
docker build -t aimarkdown-app:local .
docker save aimarkdown-app:local | gzip > app.tar.gz
# 服务器上：
gunzip -c app.tar.gz | docker load
# 然后在 deploy/.env 里设置 APP_IMAGE=aimarkdown-app:local 并执行 ./scripts/deploy.sh --no-build
```

npm 依赖同理，可在 `.npmrc` 中指向镜像源。

---

## 实施过程中与初始方案的差异

这些都是在真实环境里跑起来之后发现的问题，逐条记录以便复查：

| 方案里写的 | 实际采用 | 原因 |
| --- | --- | --- |
| Drizzle ORM + `postgres` | 只用 `postgres`，手写 SQL + `db/schema.ts` 行类型 | **`drizzle-orm/postgres-js` 会改写传入连接的 serializers**，之后绑定 JS `Date` 会抛 `ERR_INVALID_ARG_TYPE` 而不是写成 `timestamptz`。本项目所有查询本来就是裸 SQL（bytea、trgm 表达式索引、投影 upsert），ORM 没带来收益却破坏了正确性。改用集成测试断言线上库结构与行类型一致来防漂移。 |
| `argon2` | `@node-rs/argon2` | 后者为 linux-x64-musl / linux-arm64-musl 提供预编译 NAPI 二进制，Alpine 镜像无需编译工具链。算法仍是 argon2id。 |
| `archiver` 生成 ZIP | `fflate` | archiver v8 是纯 ESM 且只有具名导出（`ZipArchive`，无 default），而 `@types/archiver` 仍针对 v7 的 `export =`。fflate 纯 JS、Node 与浏览器同一实现，导入导出共用一套代码。 |
| Hocuspocus `wsOptions` / `flushDocumentHooks()` | `websocketOptions` / `flushPendingStores()` | v4 的实际命名。另外必须设 `stopOnSignals: false`，否则 Hocuspocus 会自己抢 SIGTERM，来不及 flush 待存的 CRDT。 |
| 关停时先 flush 再关连接 | **先关连接**，再 flush，再轮询排空 | 仍有连接在的文档永远不会 unload，`drained` 会恒为 false。 |
| Postgres 卷挂 `/var/lib/postgresql/data` | 挂 `/var/lib/postgresql` | Postgres 18 改了约定；挂旧路径容器会直接崩溃并提示用 `pg_upgrade`。 |
| Caddy 固定占用 80/443 | `HTTP_PORT` / `HTTPS_PORT` 可配 | 机器上常已有别的反向代理。 |
| 浏览器固定连同源 `/collab` | 支持 `COLLAB_PUBLIC_URL` 运行时注入 | 没有反向代理直接把 app 暴露出去时（本地开发、E2E、裸机部署），同源 `/collab` 是不存在的。服务端在返回 `index.html` 时注入 `window.__AIMARKDOWN_CONFIG__`，一份构建产物适配所有拓扑。 |
| `folderId=null` 表示根层级 | 独立的 `rootOnly=true` | `"null"` 本身是合法的 id 形状字符串，会被当成一个恰好没有笔记的目录。 |
| 桌面端 refresh token 走 cookie | 客户端发 `X-Token-Transport: bearer`，服务端才在响应体里返回 | 浏览器绝不能拿到 refresh token（否则 httpOnly 的意义就没了），而 Electron 在 `file://` 下没有可用的 cookie jar。 |
| 笔记 `tagIds` 放在 `meta` map 里 | 提升为顶层 `Y.Array`，且写入用**最小 diff** | 整体替换数组会破坏未改动标签的 CRDT 身份，两台设备各加一个不同标签会合并出重复项。 |

---

## 已验证的运行结果

不是「代码写完了」，而是实际跑通的部分：

- **单元测试 234 项**：CRDT 离线合并、速记追加、标签最小 diff、目录删除重挂载、Markdown 管线（GFM/KaTeX/mermaid/wikilink/任务列表）、XSS 消毒、分数排序、配置解析、日期与 bytea 编解码
- **集成测试 119 项**（真实 Postgres 18 + 真实 Hocuspocus WebSocket）：WS 鉴权与跨租户拒绝、bytea 往返、镜像投影、trgm 中文搜索、标签 AND 过滤、回收站、附件鉴权与 SVG CSP、ZIP 导出→导入 round-trip、**debounce 窗口内关停仍不丢写入**、库结构与行类型一致性
- **端到端 24 项**（Playwright + 真实服务端）：注册/建笔记/编辑/实时预览/三态切换/目录拖拽/标签筛选/中文搜索/回收站/登出重登/**双设备实时同步**/**双设备离线合并**/离线重连后持久化/速记与并发编辑互不干扰/快捷键键盘录制/XSS 不执行
- **生产栈实机验证**：`docker compose up -d --build` 起 Caddy + app + Postgres，通过 HTTPS 实测健康检查、SPA 与静态资源 MIME、HTTP→HTTPS 跳转、注册、建笔记、中文搜索、整库 ZIP 导出（中文文件名正确），以及 **WebSocket 经 Caddy `/collab` 前缀剥离后的鉴权拒绝、实时传播与离线合并**
- **Electron 外壳**：主进程启动无错误，主窗口 + 预创建的隐藏速记窗各一个渲染进程，全局快捷键注册成功（失败会在托盘与设置页告警）

---

## AI 总结与自动标签

设置 →「AI 助手」里填写 OpenAI 兼容服务的 `Base URL`、模型和 API Key。阿里云 Token Plan 预设为：

- Base URL：`https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`
- 默认模型：`qwen3.7-plus`
- API Key：Token Plan 的 AK / API Key（`sk-sp-…`）

工作方式：

- 新笔记首次出现正文后自动生成一次摘要、要点、待办和标签；之后正文变化只标记摘要过期，手动点「重新生成」才会再次调用。
- 已有标签的笔记不会被 AI 删除或覆盖标签；只有 0 标签笔记才会由 AI 补最多 3 个标签，并优先复用已有标签。
- 设置页的「回填未处理笔记」会处理所有未删除、正文非空且「没有标签」或「缺少摘要」的笔记。任务在服务端串行执行，可看进度并取消。
- 超长笔记按段落分块、层级汇总；默认最多 48 块，超过会明确报错而不是静默截断。
- API Key 使用 AES-256-GCM 加密存 Postgres，浏览器只能看到掩码。未配置 `AI_CREDENTIALS_SECRET` 时由 `JWT_SECRET` 派生；轮换 `JWT_SECRET` 后需要重新填写 AI Key。
- 自定义 Base URL 默认仅允许 HTTPS 公网地址，防止 SSRF。本地 Ollama 等内网服务需显式设置 `AI_ALLOW_PRIVATE_BASE_URL=true`。
- **个人版阿里云 Token Plan 可能限制自定义后端或批量调用**。请先确认套餐条款；回填按钮会要求二次确认并提示额度风险。

## 已知限制

这些是 v1 有意为之的取舍，不是遗漏：

- **没有「时间旅行」版本历史**。选择了 CRDT 方案，而 Yjs 默认不提供按时间点回滚。目前用**回收站**（软删除 / 恢复 / 彻底删除）兜底；后续可以基于周期性 Y.Doc 快照增量实现。
- **中文搜索基于 `pg_trgm`**，是子串匹配而非分词。Postgres 原生全文检索不分中文词，而 `zhparser` / `pg_bigm` 需要自建镜像。`SEARCH_DRIVER` 环境变量已预留升级位。
- **单实例部署**。没有引入 Redis，因此不能横向扩展 app 容器。Hocuspocus 支持 Redis pub/sub，需要多实例时再加。
- **附件存本地 Docker 卷**，没有接 S3/MinIO。存储通过 `AttachmentStorage` 接口隔离，替换实现即可。
- **未启用 CSP**。前端会注入运行时样式，预览还要渲染 KaTeX/MathML，半吊子的 CSP 只会制造故障。笔记内容的 XSS 边界是 DOMPurify（渲染管线本身也以 `html: false` 转义所有原始 HTML）。收紧 CSP 是后续加固项。
- **邮箱注册不发验证邮件**，避免引入 SMTP 依赖。
- **离线能力覆盖「已打开的页面」**：断网后可以继续编辑，改动进 IndexedDB，联网后自动合并。但**断网时刷新页面无法启动**——v1 没有 service worker，应用外壳本身取不到。要支持离线冷启动需要加 PWA 缓存。
- **搜索需要至少 2 个字符**（trgm 限制），且不做分词与语义检索。

---

## API 概览

所有路径以 `/api` 为前缀，错误统一返回 `{ code, message, details? }`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/auth/register` `/auth/login` `/auth/refresh` `/auth/logout` | argon2id + JWT，refresh 令牌轮换 |
| GET | `/me` `/settings` | 当前用户、偏好设置 |
| GET | `/tree` | 目录树 + 标签 + 计数（首屏骨架） |
| GET | `/notes?folderId=&rootOnly=&tagIds=&q=&archived=&sort=` | 列表 / 搜索 / 组合筛选 / 游标分页 |
| POST | `/notes` | 新建（同一事务写入行与 CRDT 文档） |
| PATCH | `/notes/:id` | 目录、置顶、归档、标签、排序 |
| DELETE | `/notes/:id` | 软删除进回收站；`?permanent=1` 彻底删除 |
| POST | `/notes/:id/restore` · `/notes/:id/capture` | 恢复 · 速记追加 |
| GET | `/notes/:id/export` · `/export/vault` | 单篇 `.md` · 整库 ZIP |
| POST | `/import` | 上传 `.md` 或 ZIP，重建目录层级 |
| POST | `/attachments` · GET `/attachments/:id` | 图片上传与鉴权下载 |
| GET | `/ai/overview` | AI 配置掩码、待回填计数、当前任务 |
| PUT/DELETE | `/ai/config` · POST `/ai/config/test` | 保存/清空 AI 配置 · 测试连接 |
| POST | `/notes/:id/ai/analyze` | 手动生成/重跑当前笔记的 AI 总结 |
| POST | `/ai/backfill` · GET `/ai/jobs/:id` · POST `/ai/jobs/:id/cancel` | 回填、任务进度、取消 |
| GET | `/health` | 存活探针（部署脚本与容器健康检查使用） |
| WS | `/collab` | Hocuspocus 协同通道，连接时必须携带 access token |

令牌有两种传输方式，共用同一套服务端逻辑：浏览器用 httpOnly cookie（脚本读不到），Electron 用 `Authorization: Bearer` 并把 refresh 令牌存进系统钥匙串（`safeStorage`）。桌面端请求时带上 `X-Token-Transport: bearer`，服务端才会在响应体里返回 refresh 令牌。
