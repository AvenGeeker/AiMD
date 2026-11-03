<div align="center">

<img src="apps/desktop/resources/icon.png" alt="AiMD" width="96" height="96" />

# AiMD

**自托管的多端同步 Markdown 笔记本。**

一套 React 代码同时是浏览器端、Electron 桌面端（macOS / Windows）和移动端 App（Android / iOS / HarmonyOS）；
服务端是 Fastify + Hocuspocus + Postgres，同步基于 **Yjs CRDT**：离线可写，联网后字符级自动合并，不会互相覆盖。

[![CI](https://github.com/geekeraven/aimarkdown/actions/workflows/ci.yml/badge.svg)](https://github.com/geekeraven/aimarkdown/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)
![pnpm](https://img.shields.io/badge/pnpm-10.x-f69220)
![Postgres](https://img.shields.io/badge/postgres-18-336791)

**简体中文** | [English](./README.en.md)

</div>

---

## 为什么

笔记是最不该被平台绑定的数据。AiMD 的目标是：**你自己有一台服务器，就完全拥有一份能多端实时同步的 Markdown 笔记库**——
数据落在你自己的 Postgres 与磁盘上，随时能整库导出成 `.md` + ZIP，也能随时导回。没有账号体系外的第三方，
没有按月付费，没有「服务下线即数据消失」。

技术上不重新发明轮子：CRDT 用 Yjs，协同传输用 Hocuspocus，编辑器用 CodeMirror 6，渲染管线自己写但全部基于
markdown-it / KaTeX / mermaid / DOMPurify。**唯一真相是 Y.Doc**，关系表只是它的只读投影——这个约束贯穿整个仓库，
详见 [架构](#架构)。

## 功能特性

| | |
| --- | --- |
| **多端实时同步** | Yjs CRDT，离线可写（y-indexeddb），重连后字符级合并；两台设备同时编辑同一段也不丢字 |
| **Markdown 编辑与预览** | CodeMirror 6 源码编辑 + 实时预览，分栏 / 纯编辑 / 纯预览三态；GFM、任务列表、KaTeX 公式、mermaid 图、`[[wikilink]]` |
| **全局快捷键速记** | 桌面端可分别设置「打开主窗口」与「打开速记窗」的全局热键，设置页直接录制按键；内容以 CRDT 追加写入收集箱，与正在进行的编辑安全合并 |
| **AI 总结与自动标签** | 服务端调用任意 OpenAI 兼容接口，生成摘要、要点、可勾选待办与最多 3 个标签；支持批量回填、进度可视与取消 |
| **收藏夹与文件夹 AI** | 收藏小红书/抖音/公众号/网页链接或手机分享的图片视频，图片本地化、OCR/视频转写后 AI 自动归入收藏分类；任意文件夹可问答、查询和生成出行规划 |
| **macOS 备忘录双向同步** | 桌面端与 Apple Notes 全库双向镜像（文件夹 / 笔记 / 附件），冲突与只读项打标签标识，删除可恢复 |
| **目录与标签** | 无限层级目录、拖拽移动、标签多选 AND 过滤；排序用分数索引，插入不打乱并发编辑 |
| **搜索** | Postgres `pg_trgm` 子串匹配，中文可用（至少 2 个字符） |
| **附件** | 图片粘贴 / 拖拽上传，鉴权下载，SVG 带独立 CSP |
| **导入导出** | 单篇导出 `.md`；整库导出 ZIP（保留目录层级与中文名）；`.md` 或 ZIP 导入重建层级 |
| **回收站** | 软删除 / 恢复 / 彻底删除 |
| **响应式与移动端** | 同一份 Web 构建产物跑在浏览器、Electron 与 Capacitor 壳里；适配折叠屏与横竖屏旋转 |
| **安全** | argon2id、JWT + refresh 轮换、浏览器 httpOnly cookie / 桌面端系统钥匙串、按 `owner_id` 收窄的跨租户隔离、限流、AI Key AES-256-GCM 加密存储 |

<!-- 截图：把图片放进 docs/screenshots/ 后在此处用 Markdown 图片语法插入（editor.png / capture.png / mobile.png） -->

---

## 快速开始

### 方式一：Docker Compose 一键部署（推荐）

需要一台服务器，装好 Docker Engine + Compose v2 插件。

```bash
git clone https://github.com/geekeraven/aimarkdown.git AiMD
cd AiMD
./scripts/deploy.sh
```

脚本会依次完成：

1. 检查 Docker 与端口占用
2. 首次运行时交互式生成 `deploy/.env`：询问部署地址（域名或公网 IP + 端口），用 `openssl rand`
   填充 `JWT_SECRET` 与 `POSTGRES_PASSWORD`，并推导 Caddy 的站点地址
3. `docker compose up -d --build` 构建并启动 **Caddy + app + Postgres**
4. 数据库迁移在容器启动时自动执行（幂等），无需手动步骤
5. 轮询 `/api/health`，成功后打印访问地址

然后访问脚本打印的地址，注册第一个账号。**注册默认开放**：创建好自己的账号后，把 `deploy/.env`
里的 `ALLOW_REGISTRATION=false`，重新执行 `./scripts/deploy.sh` 关闭注册。

支持两种部署模式：

| 模式 | 场景 | 访问方式 |
| --- | --- | --- |
| **域名模式**（推荐） | 有域名且 DNS 指向服务器 | `https://你的域名/`，Caddy 自动申请 / 续期 Let's Encrypt 证书，80 跳转 443 |
| **无域名 / IP 直连** | 没有域名，只想先跑起来 | `http://服务器IP:端口/`，纯 HTTP，浏览器会提示「不安全」，忽略即可 |

**域名模式**：`deploy/.env` 里 `PUBLIC_URL=https://你的域名`（带协议），`CADDY_SITE_ADDR` 由脚本自动推导。
若 80/443 被别的服务占用，改 `HTTP_PORT` / `HTTPS_PORT`。

**IP 直连模式**：脚本提示输入公网 IP 与端口（默认 `8080`）。`PUBLIC_URL=http://IP:端口`，
`CADDY_SITE_ADDR=http://IP`（**不带端口**——Caddy 在容器内绑定 80，宿主机对外端口由 `HTTP_PORT` 决定）。

- 大陆区 ECS **未备案时 80/443 会被运营商拦截**，所以必须用非标端口（这就是默认 8080 的原因）；境外区可留 80。
- 纯 HTTP 下登录 cookie 不带 `Secure` 标志（服务端按请求协议判断，Caddy 透传 `X-Forwarded-Proto`），功能与 HTTPS 一致。
- 之后配好域名：改 `PUBLIC_URL` / `CADDY_SITE_ADDR` / `HTTP_PORT`，重跑 `./scripts/deploy.sh` 即可平滑切到 HTTPS。

拉取镜像失败（国内网络常见）见 [国内网络注意事项](#国内网络注意事项)。

### 方式二：桌面客户端

从 [Releases](https://github.com/geekeraven/aimarkdown/releases) 下载 `.dmg`（macOS，x64 / arm64）或 `.exe`（Windows x64），
首次启动时填写你的服务器地址。

> 地址填**部署根地址**（浏览器里能打开笔记页面的那个），例如 `https://notes.example.com` 或
> `http://203.0.113.10:8080`：不要带 `/api` 前缀，也不要填成别的网站或路由器管理页。
> 保存时会先请求 `/api/health` 校验连通性，地址不对会当场说明原因，而不是等到登录时才报一个看不懂的错。
> 少写 `https://` 会自动补全。

**产物未签名**（没有 Apple Developer ID / Windows 代码签名证书），首次打开会被拦：

- **macOS**：右键 → 打开，或在「系统设置 → 隐私与安全性」点「仍要打开」
- **Windows**：SmartScreen 提示时选「更多信息 → 仍要运行」

想正式分发，把 `apps/desktop/package.json` 里 `build.mac.identity` 从 `null` 换成你的证书并开启 `hardenedRuntime`。

### 方式三：移动端（Android / iOS / HarmonyOS）

`apps/mobile` 用 **Capacitor** 复用同一份 React 渲染层（与 Electron 相同的 `web/dist` 契约）。
鉴权走 bearer token，同步走 `/collab` WebSocket，离线靠 WebView 的 IndexedDB；token 存 Keychain / Android Keystore。

```bash
pnpm install
pnpm --filter @aimarkdown/mobile add:android   # 首次：生成原生工程
pnpm --filter @aimarkdown/mobile add:ios

make mobile-build    # web build → stage → 同步 www 与 harmony resfile
make mobile-apk      # Android debug APK
make mobile-ipa      # iOS 模拟器构建（未签名）
make mobile-hap      # HarmonyOS HAP —— 需要 DevEco Studio
```

- Android 工程钉在 **AGP 8.7.3 / compileSdk 35**（兼容 2025 代 Android Studio，原因与升级路径见
  `apps/mobile/android/variables.gradle` 注释）；Gradle 8.14.3。
- **自用侧载构建放开了明文 HTTP**（AndroidManifest / Info.plist 有注释标记），上架前必须移除并强制 HTTPS。
- HarmonyOS 走 `apps/mobile/harmony` 的最小 ArkWeb harness（Stage 模型 + javaScriptProxy 桥），
  原生插件面只有 token 存储一项。签名材料由 DevEco Studio 生成在 `~/.ohos/`，
  **不要把 `build-profile.json5` 里的 `signingConfigs` 提交上来**（见 [贡献者注意](#开源自检与贡献者注意)）。

---

## 运维

服务器上推荐用 `scripts/aimd.sh`，它把备份、构建、健康检查和镜像回滚串在一起：

```bash
./scripts/aimd.sh deploy          # 首次部署；已有部署时按更新处理
./scripts/aimd.sh update          # 备份 → 构建 → 切换 → 健康检查，失败自动回滚镜像
./scripts/aimd.sh apply           # 只应用 deploy/.env 修改，不重新构建
./scripts/aimd.sh rollback        # 回滚到上一版应用镜像
./scripts/aimd.sh releases        # 查看发布记录
./scripts/aimd.sh status          # 当前版本、容器、健康检查、DNS、证书
./scripts/aimd.sh logs app        # 跟踪 app 日志
./scripts/aimd.sh backup --keep 14
```

也可以用 Makefile：

```bash
make logs            # 跟踪应用日志
make ps              # 查看容器状态
make backup          # 备份数据库 + 附件到 ./backups/
make deploy-rebuild  # 重新构建并部署
make down            # 停止（保留数据卷）
```

备份脚本导出 `pg_dump`（custom 格式）与附件卷，并快照 `deploy/.env`。定时备份：

```cron
30 3 * * * cd /path/to/AiMD && ./scripts/backup.sh --keep 14 >> /var/log/aimarkdown-backup.log 2>&1
```

### 推荐：在 CI 构建，VPS 只拉镜像

从源码构建时，首次构建、依赖变化或 Web 源码变化会让 Vite/Rolldown 处理 4,000+ 个模块并压缩
mermaid/shiki 等大分块；小内存 VPS（尤其是 CPU 积分耗尽的突发型实例）上可能持续数分钟，这不是卡死。
服务端源码变化会命中 Web 层缓存，但 Web 一改就躲不开整次打包。

更好的做法是把打包放到 CI 或本机。仓库的 CI 会在 `main` 与 `v*` tag 上发布镜像到 GHCR：

- `ghcr.io/<owner>/<repo>:latest`、`:main`（默认分支滚动标签）
- `ghcr.io/<owner>/<repo>:sha-xxxxxxx`（每次提交）
- `ghcr.io/<owner>/<repo>:v1.2.3` / `:1.2.3`（tag 发布）

服务器只需要拉镜像，不装 Node，也不跑 Vite：

```bash
# deploy/.env
APP_IMAGE=ghcr.io/<owner>/<repo>:latest
```

```bash
./scripts/aimd.sh update   # 自动 docker pull -> 切换 -> 健康检查，失败回滚
```

> GHCR 包首次发布后默认是 private：在 GitHub 仓库的 **Packages** 设置里把该包改成 public，
> 或在服务器上 `docker login ghcr.io`。大陆网络拉取 ghcr.io 不稳定时，可以把镜像同步到阿里云
> ACR 等可达仓库，再把 `APP_IMAGE` 指向那里；也可以继续用下面的离线 `docker save/load` 方式。

只有确实需要在服务器上从源码构建时，才使用 `./scripts/deploy.sh --rebuild` 或
`make deploy-rebuild`。

发布记录、当前镜像与 `.env` 快照保存在 `.deploy/`（已 gitignore）。**回滚只切换应用镜像，不会回滚数据库迁移**；
需要回滚数据时用 `backups/` 里的备份包，按其中的 `BACKUP.json` 操作。

---

## 本地开发

### 前置

```bash
node -v      # >= 22
pnpm -v      # 10.x
docker -v    # 需要 Compose v2 插件
```

```bash
pnpm install     # 会自动批准 esbuild / @node-rs/argon2 / electron 的构建脚本
make hooks       # 安装 pre-commit 密钥扫描钩子
make db-up       # 开发库(:5433) + 测试库(:5434)
```

### 浏览器里跑（最快，改代码即时热更新）

```bash
make dev
# → API  http://127.0.0.1:3000
# → Web  http://127.0.0.1:5173   ← 打开这个
```

Vite 会把 `/api` 与 `/collab` 代理到本地服务端，浏览器只连 5173 一个源。

### Electron 桌面端（含全局快捷键速记窗）

保持上面在跑，另开一个终端：

```bash
pnpm --filter @aimarkdown/desktop dev
```

脚本自动探测 `http://127.0.0.1:5173`：探测到就用 Vite（编辑器热更新），否则加载已构建产物并提示你先
`pnpm --filter @aimarkdown/web build`。首次启动会让你填服务器地址，本地开发填 `http://127.0.0.1:3000`。

启动后按 **⌥Space** 唤出速记窗，`⌘Enter` 写入收集箱，`Esc` 关闭；按 **⌘⇧M** 打开主窗口。
两个快捷键都可以在「设置 → 桌面端」里点击后直接按下新组合来修改。

> 如果被 Raycast / Alfred 占用，注册会失败——托盘菜单和设置页都会明确提示，录制一个不同的组合即可，不会静默失效。

### 打包

```bash
pnpm --filter @aimarkdown/desktop dist:mac   # dmg + zip，x64 与 arm64
pnpm --filter @aimarkdown/desktop dist:win   # nsis，x64
```

只想打本机架构、省一半时间：

```bash
cd apps/desktop && pnpm build && npx electron-builder --mac --x64
```

> 打包前必须先构建 renderer：`pnpm build` 会按 `web 构建 → 主进程编译 → stage renderer` 的顺序做完。
> 单独跑 `electron-builder` 而没重新 stage 时，`copy-renderer.mjs` 会告警提示 bundle 可能过期。

`electron-updater` 依赖已保留但**未启用**自动更新检查——它需要一个发布源（如 GitHub Releases），配置好后把 `autoUpdater` 接上即可。

### 测试

```bash
make test                # 单元测试（不需要数据库）
make test-integration    # 集成测试：真实 Postgres + 真实 Hocuspocus WebSocket（需要 :5434）
make test-e2e            # Playwright 端到端（需要 :5433 + apps/web/dist）
make typecheck && make lint
make secrets             # 密钥扫描（必须干净）
```

当前规模：**261 项单元测试**（本次开源前实测全绿）、**120 项集成测试用例**、**38 项端到端用例**。

覆盖的重点是两条命门：**跨租户越权**与**离线合并后数据不丢不重**。具体包括 CRDT 离线合并、速记追加、
标签最小 diff、目录删除重挂载、Markdown 管线（GFM / KaTeX / mermaid / wikilink / 任务列表）、XSS 消毒、
分数排序、配置解析、日期与 bytea 编解码、WS 鉴权与跨租户拒绝、镜像投影、trgm 中文搜索、标签 AND 过滤、
回收站、附件鉴权与 SVG CSP、ZIP 导出→导入 round-trip、**debounce 窗口内关停仍不丢写入**、
库结构与行类型一致性、双设备实时同步 / 离线合并、速记与并发编辑互不干扰、快捷键键盘录制。

---

## 架构

```
┌─────────────┐  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐
│ 浏览器 (Web) │  │ Electron 主窗 │  │ Electron 速记窗 │  │ 移动端 (Cap.)│
└──────┬──────┘  └──────┬──────┘  └──────┬───────┘  └──────┬──────┘
       │        同一个 Vite 构建产物（apps/web/dist）        │
       │   REST /api                    WebSocket /collab   │
       └──────────────┬──────────────────────┬──────────────┘
                      ▼                      ▼
              ┌────────────────────────────────────┐
              │      Node 进程（apps/server）        │
              │   Fastify :3000   Hocuspocus :1234  │
              └───────────────────┬────────────────┘
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
| `packages/shared` | zod API 契约、CRDT 文档命名与结构、分数排序、统一错误码、常量 |
| `packages/markdown` | 同步、无 DOM 依赖的渲染管线（GFM / KaTeX / mermaid / wikilink / 任务列表）+ DOMPurify 消毒与浏览器端增强 |
| `apps/server` | Fastify REST + Hocuspocus 协同服务 + Postgres 镜像投影 + AI 任务 |
| `apps/web` | React 19 + Vite + CodeMirror 6 + Tailwind，浏览器 / Electron / 移动端共用 |
| `apps/desktop` | Electron 外壳：主窗口、托盘、全局快捷键、`safeStorage` 凭据、Apple Notes 同步引擎 |
| `apps/mobile` | Capacitor 壳：Android / iOS / HarmonyOS(ArkWeb) |
| `deploy/` | 生产与开发用 Compose、Caddyfile、`.env` 模板、镜像加速示例 |
| `scripts/` | `deploy.sh` / `aimd.sh` / `backup.sh` / `dev.sh` / `check-secrets.sh` |
| `docs/` | 设计笔记（中英） |

### CRDT 数据模型

只有两类 Y.Doc：

- **`note-{noteId}`** — `Y.Text body`（Markdown 正文）、`Y.Map meta`（标题、目录、置顶、归档、软删除、排序位）、`Y.Array tagIds`
- **`workspace-{userId}`** — `Y.Map folders`、`Y.Map tags`、`Y.Map settings`

**Y.Doc 是唯一真相**，Postgres 里同名的列都是从它投影出来的镜像，由 Hocuspocus 的 `store` 钩子在同一个事务里刷新。
列表、搜索、目录树全部读镜像，因此永远不需要为渲染而反序列化 Y.Doc。

REST 写操作（移动目录、置顶、打标签）不会绕过 CRDT：服务端通过 Hocuspocus 的 **direct connection** 打开真实文档、
改动、再广播给所有在线客户端，和浏览器发起的修改走完全相同的路径。

客户端同时挂载 `y-indexeddb`，所以断网时照常编辑，重连后自动合并。

写入规则有两条必须遵守（详见 [`AGENTS.md`](./AGENTS.md)）：

- 改 `Y.Array` 用**最小 diff**——整体 `delete + insert` 会破坏未改动元素的 CRDT 身份，两台设备各加一个不同标签会合并出重复项；
- 速记追加一律 `insert` 到 `body.length`，这是能与其他设备的并发编辑安全合并的插入点。

---

## 配置

所有配置都从环境变量读取，启动时用 zod 校验一次，**配错会立刻启动失败并打印可读的原因**，不会在运行时才出问题。
`apps/server/src/config.ts` 是唯一来源。

### 应用（`apps/server`）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | — | **必填**，Postgres 连接串 |
| `JWT_SECRET` | — | **必填，至少 32 字符**，没有默认值。每个部署必须唯一 |
| `NODE_ENV` | `development` | `development` / `test` / `production` |
| `HOST` | `0.0.0.0` | 监听地址 |
| `REST_PORT` | `3000` | REST 端口 |
| `COLLAB_PORT` | `1234` | Hocuspocus WebSocket 端口 |
| `CORS_ORIGIN` | `*` | 逗号分隔的允许来源，或 `*`。SPA 与 API 同源时保持 `*` |
| `ALLOW_REGISTRATION` | `true` | 建好自己的账号后建议改成 `false` |
| `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` | 空 | 首次启动时创建并标记管理员；密码至少 8 位，留空则跳过 |
| `UPLOAD_DIR` | `./data/uploads` | 附件目录（容器内挂 `/data/uploads` 卷） |
| `PUBLIC_URL` | 空 | 对外访问地址，用于生成附件绝对链接 |
| `WEB_DIST_DIR` | 空 | 指向 `apps/web/dist` 即由服务端托管前端；留空则只提供 API |
| `COLLAB_PUBLIC_URL` | 空 | 浏览器该连的 WS 地址，运行时注入 `index.html`。有反向代理映射 `/collab` 时留空 |
| `SEARCH_DRIVER` | `trgm` | 预留位，目前只实现了 `trgm` |
| `AUTH_RATE_LIMIT_MAX` | `10` | 凭据类端点每分钟每 IP 请求数 |
| `API_RATE_LIMIT_MAX` | `600` | 全局每分钟每 IP 请求数 |
| `COLLAB_DEBOUNCE` | `2000` | CRDT 落库节流（ms），最小 200 |
| `COLLAB_MAX_DEBOUNCE` | `10000` | 落库最大延迟（ms） |
| `COLLAB_TIMEOUT` | `30000` | 文档卸载超时（ms） |
| `COLLAB_MAX_PAYLOAD_BYTES` | `10485760` | 单条协同消息上限 |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | 关停时等待待存 CRDT 的上限，保证 SIGTERM 不丢写入 |
| `LOG_LEVEL` | `info` | `fatal` / `error` / `warn` / `info` / `debug` / `trace` / `silent` |
| `MIGRATIONS_DIR` | 自动 | 迁移 SQL 目录，一般不用设 |
| `ACCESS_TOKEN_TTL_SECONDS` / `REFRESH_TOKEN_TTL_SECONDS` | `900` / `2592000` | 主要给测试用 |

### AI 功能

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `AI_CREDENTIALS_SECRET` | 空 | 加密用户 AI Key 的专用密钥（≥32 字符）。留空则由 `JWT_SECRET` 派生——**轮换 `JWT_SECRET` 会让已存的 AI Key 失效** |
| `AI_ALLOW_PRIVATE_BASE_URL` | `false` | 允许 HTTP / 环回 / 内网地址（本地 Ollama、测试）。**生产必须保持 `false`**，这是 SSRF 防线 |
| `AI_REQUEST_TIMEOUT_MS` | `90000` | 单次请求超时 |
| `AI_REQUEST_INTERVAL_MS` | `750` | 请求间隔，避免打爆供应商限流 |
| `AI_MAX_CHUNK_CHARS` | `16000` | 长文分块大小 |
| `AI_MAX_CHUNKS` | `48` | 最多分块数，超出会明确报错而不是静默截断 |

### 部署（`deploy/.env`，仅 Compose）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PUBLIC_URL` | — | **必填**，带协议。域名模式 `https://notes.example.com`；IP 直连 `http://203.0.113.10:8080` |
| `CADDY_SITE_ADDR` | 自动推导 | Caddy 站点地址。仅当 `PUBLIC_URL` 带非 80 端口时需要显式设置，且**不带端口** |
| `ACME_EMAIL` | 空 | Let's Encrypt 到期通知邮箱（仅域名模式） |
| `HTTP_PORT` / `HTTPS_PORT` | `80` / `443` | 宿主机对外端口 |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `aimarkdown` / — / `aimarkdown` | `deploy.sh` 会用 `openssl rand` 生成密码 |
| `APP_IMAGE` | 空 | 指向预构建镜像（如 `ghcr.io/you/aimarkdown:latest`）即跳过在服务器上构建；CI 会自动发布到 GHCR，`aimd.sh update` 会先拉取最新 tag |

完整模板见 [`deploy/.env.example`](./deploy/.env.example) 与 [`.env.example`](./.env.example)（含注释）。

---

## API 概览

所有路径以 `/api` 为前缀，错误统一返回 `{ code, message, details? }`（code 定义在 `packages/shared/src/errors.ts`）。
请求与响应的 zod schema 全部在 `packages/shared/src/api.ts`——服务端拿它校验，客户端拿它推导类型，只有一份契约。

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

令牌有两种传输方式，共用同一套服务端逻辑：浏览器用 httpOnly cookie（脚本读不到），Electron 与移动端用
`Authorization: Bearer` 并把 refresh 令牌存进系统钥匙串（`safeStorage` / Keychain / Android Keystore）。
桌面端请求时带上 `X-Token-Transport: bearer`，服务端才会在响应体里返回 refresh 令牌。

---

## 安全模型

细节与部署方检查清单见 [`SECURITY.md`](./SECURITY.md)。要点：

- **密码**：`argon2id`（`@node-rs/argon2`），永不明文存储或打日志。
- **会话**：15 分钟 access token + 30 天 refresh token，refresh 轮换。
- **浏览器**：refresh token 在 `httpOnly` + `SameSite=Lax` cookie 里，HTTPS 下带 `Secure`；脚本读不到。
- **桌面端 / 移动端**：refresh token 在系统钥匙串里；客户端必须显式声明 `X-Token-Transport: bearer`，服务端才会把它放进响应体。
- **协同通道**：连接时就要求 access token，跨租户文档直接拒绝。
- **授权**：所有查询按 `owner_id` 收窄，跨租户越权有集成测试覆盖（REST 与 WebSocket 两条路）。
- **限流**：凭据类端点 10 req/min/IP，全局 600 req/min/IP。
- **AI Key**：AES-256-GCM 加密存 Postgres，API 只返回掩码。
- **AI `baseUrl`**：默认只允许 HTTPS 公网地址，防 SSRF；`AI_ALLOW_PRIVATE_BASE_URL=true` 才能连内网。
- **笔记 HTML**：原始 HTML 全部转义（`html: false`），渲染结果再过 DOMPurify。
- **附件 SVG**：以独立 CSP 提供，上传的 SVG 无法脚本化同源。
- **配置**：`JWT_SECRET` 没有默认值，缺失或短于 32 字符直接启动失败。
- **仓库**：`scripts/check-secrets.sh` 在 CI 与 pre-commit 钩子里扫描凭据（含全历史扫描），见下文。

### 开源自检与贡献者注意

```bash
make hooks          # 安装 pre-commit 密钥扫描钩子
make secrets        # 扫描 git 跟踪的文件
make preopen-check  # 推送前的完整自检（含未跟踪文件与 skip-worktree 清单）
```

IDE 会把**本机签名材料**写进这两个文件（HarmonyOS 的 `keyPassword` / `storePassword` / `~/.ohos` 路径，
Xcode 的 `DEVELOPMENT_TEAM`）。它们的正确内容不该进仓库，标记为开发者本地即可，本地构建照常可用：

```bash
git update-index --skip-worktree apps/mobile/harmony/build-profile.json5
git update-index --skip-worktree apps/mobile/ios/App/App.xcodeproj/project.pbxproj
# 真要提交改动时：git update-index --no-skip-worktree <path>，并先把签名材料清掉
```

---

## AI 总结与自动标签

设置 →「AI 助手」里填写任意 **OpenAI 兼容**服务的 `Base URL`、模型和 API Key。
内置两个预设：阿里云 Token Plan（`https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`，默认模型
`qwen3.7-plus`）与「自定义 OpenAI 兼容」（OpenAI、Azure OpenAI、DeepSeek、Moonshot、本地 Ollama 等都可以）。

工作方式：

- 新笔记首次出现正文后自动生成一次摘要、要点、待办和标签；之后正文变化只标记摘要过期，手动点「重新生成」才会再次调用。
- 已有标签的笔记不会被 AI 删除或覆盖标签；只有 0 标签笔记才会由 AI 补最多 3 个标签，并优先复用已有标签。
- 设置页的「回填未处理笔记」会处理所有未删除、正文非空且「没有标签」或「缺少摘要」的笔记。任务在服务端串行执行，可看进度并取消。
- 超长笔记按段落分块、层级汇总；默认最多 48 块，超过会明确报错而不是静默截断。
- API Key 用 AES-256-GCM 加密存 Postgres，浏览器只能看到掩码。未配置 `AI_CREDENTIALS_SECRET` 时由 `JWT_SECRET` 派生；
  轮换 `JWT_SECRET` 后需要重新填写 AI Key。
- 自定义 Base URL 默认仅允许 HTTPS 公网地址，防止 SSRF。本地 Ollama 等内网服务需显式设置 `AI_ALLOW_PRIVATE_BASE_URL=true`。
- **部分云厂商的个人版套餐可能限制自定义后端或批量调用**。请先确认套餐条款；回填按钮会要求二次确认并提示额度风险。


---

## 收藏夹

侧边栏的「收藏」是独立一级入口；桌面端还提供托盘菜单「收藏链接…」和可录制的全局快捷键（默认 `CommandOrControl+Shift+F`）。按快捷键会唤起主窗口并直接打开粘贴框。收藏项仍然是普通笔记，沿用编辑器、搜索、回收站、导出与 Yjs 同步，并额外保存原文链接、平台、作者、封面和媒体处理状态。

- 点击左侧「收藏」旁的 `书签+`，粘贴链接并回车即可。手机端在笔记列表标题栏常驻「收藏」按钮；也可以从系统分享面板直接发送链接或图片。服务端自动解析公众号和普通网页；小红书/抖音受反爬限制或任意网页解析失败时，自动退化为只保存网址，不再要求填写表单。
- 正文图片会下载为鉴权附件；图片可走视觉模型 OCR，视频会用 ffmpeg 提取音频后走 OpenAI 兼容 `audio/transcriptions` 转写。媒体模型在「设置 → AI 助手」里可选配置，未配置时收藏仍会保存。
- 收藏区会自动创建预设类别：学习、AI、大模型、旅游、购物、生活、职场、健康、其他。每条新收藏保存时会立即按平台文件夹或标题/正文关键词选择一个默认类别，找不到合适类别则归入「其他」，不会停留在「待分类」；配置 AI 后仍会继续自动优化分类。非预设新类别需要确认后才会创建。
- 任意真实文件夹都能打开「问 AI」，支持问答、查询和出行规划。回答优先引用收藏并给出可点击引用；出行规划默认尝试模型原生联网搜索，其他模式可手动开启。
- 手机端支持 Android `ACTION_SEND`、iOS Share Extension（App Group + `aimarkdown://share`）和 HarmonyOS `sendData`。三端还各提供一个「收藏链接」桌面卡片：Android AppWidget、iOS WidgetKit 和 HarmonyOS FormExtensionAbility，点按后直接打开收藏输入框。iOS 真机分享扩展与小组件需要开发者团队签名。

服务端需要 `ffmpeg`/`ffprobe`（Docker 镜像已安装；本机开发可 `brew install ffmpeg`）。同一链接默认更新已有收藏。

---

## 桌面端

### 全局快捷键速记

- 「打开主窗口」默认 **`⌘⇧M` / `Ctrl+Shift+M`**；「打开速记窗」默认 **macOS `⌥Space`** / **Windows `Ctrl+Alt+Space`**
- 在「设置 → 桌面端」点击快捷键框后直接按下新组合即可录制；设置存在 workspace CRDT 里，因此多端一致
- 两个快捷键独立注册；注册失败（被 Raycast / Alfred 等占用）时，托盘菜单与设置页都会明确告警，不会静默失效
- 小窗无边框、置顶、跨 Space 可见；`Esc` 或失焦隐藏（隐藏而非销毁，保持热启动）
- `⌘/Ctrl + Enter` 提交，内容以 CRDT 追加写入收集箱末尾——即使此刻另一台设备正在编辑这篇笔记的中间部分，两边都不会丢
- 主窗口左侧「速记」会按时间戳把收集箱里的速记拆成独立条目；点击条目可直接跳到对应位置

### macOS 备忘录双向同步

macOS 桌面端标题栏有「备忘录」按钮，设置里有「macOS 备忘录同步（仅此 Mac）」：

- 默认 Apple 备忘录账户与当前 AiMD 用户**全库双向镜像**：文件夹双向，笔记新建/编辑/删除双向；包含收集箱和归档，
  排除回收站（删除会进入 app 回收站和 Apple 的 `AiMD 回收站 (App)` 目录，可恢复）
- 首次启用必须先扫描预览，确认后才写入；之后支持手动、启动时和定时同步（默认 30 分钟）
- 笔记正文/文件夹冲突按最新修改优先；失败版本会复制到 app 并打「Apple 同步冲突」标签
- 图片、PDF、普通文件尽量双向同步；Apple Notes 无法导出的绘图/扫描件/录音、加密或共享内容会让对应笔记进入只读
  并打「Apple 同步只读」标签
- 同步引擎运行在 Electron 主进程，映射保存在本机 `userData/apple-notes-sync.json`。**同一账号只应在一台 Mac 上启用**；
  换 Mac 前先停用旧机器
- 更换服务端或登录账号后，旧映射不会直接复用：点「立即同步」会自动打开只读预览，确认后按当前账号重建映射，
  旧映射保留为带时间戳的备份文件
- 首次同步/重建未签名 app 后，点设置里的「请求授权」或「预览差异」才会触发 macOS「控制备忘录」授权框；
  授权前「系统设置 → 隐私与安全性 → 自动化」里不会出现 AiMD。拒绝或重置后可在那里重新授权
- 定时同步要求 AiMD 保持运行；关闭窗口驻留托盘即可。笔记排序、置顶、标签和 Apple 智能文件夹不参与同步
- **扫描不完整时禁止执行删除**；Apple 返回 0 条但本地映射非空时必须中止——这是防止一次权限/网络故障清空全库的安全阀

---

## 已知限制

这些是 v1 有意为之的取舍，不是遗漏：

- **没有「时间旅行」版本历史**。选择了 CRDT 方案，而 Yjs 默认不提供按时间点回滚。目前用**回收站**
  （软删除 / 恢复 / 彻底删除）兜底；后续可以基于周期性 Y.Doc 快照增量实现。
- **中文搜索基于 `pg_trgm`**，是子串匹配而非分词。Postgres 原生全文检索不分中文词，而 `zhparser` / `pg_bigm`
  需要自建镜像。`SEARCH_DRIVER` 已预留升级位。**搜索词至少 2 个字符**，这是产品约束不是 bug。
- **单实例部署**。没有引入 Redis，因此不能横向扩展 app 容器。Hocuspocus 支持 Redis pub/sub，需要多实例时再加。
- **附件存本地 Docker 卷**，没有接 S3/MinIO。存储通过 `AttachmentStorage` 接口隔离，替换实现即可。
- **未启用 CSP**。前端会注入运行时样式，预览还要渲染 KaTeX/MathML，半吊子的 CSP 只会制造故障。笔记内容的 XSS
  边界是 DOMPurify（渲染管线本身也以 `html: false` 转义所有原始 HTML）。收紧 CSP 是后续加固项。
- **邮箱注册不发验证邮件**，避免引入 SMTP 依赖。
- **离线能力覆盖「已打开的页面」**：断网后可以继续编辑，改动进 IndexedDB，联网后自动合并。但**断网时刷新页面无法启动**——
  v1 没有 service worker，应用外壳本身取不到。要支持离线冷启动需要加 PWA 缓存。
- **桌面与移动端产物未签名**（没有 Apple Developer ID / Windows 证书），首次打开需要手动放行。

---

## 国内网络注意事项

部署脚本假设 Docker Hub 可能不可达。实测情况（2026-10-30）：

| 镜像源 | 状态 |
| --- | --- |
| `registry-1.docker.io` / `index.docker.io` | 超时不可达 |
| `docker.m.daocloud.io` | 可达（`/v2/` 返回 401 属正常） |
| `dockerproxy.net` | 可达（200） |
| `hub-mirror.c.163.com` | 已失效 |

如果拉取镜像失败，把 `deploy/daemon.json.mirror` 里的 `registry-mirrors` 合并进 `/etc/docker/daemon.json`，
重启 Docker 后重跑部署。**先检查现有配置**——很多机器已经配好了镜像加速。

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

## 设计笔记

方案与实现的差异、以及每条差异背后的真实代价，单独记录在：

- [`docs/design-notes.zh.md`](./docs/design-notes.zh.md)（中文）
- [`docs/design-notes.en.md`](./docs/design-notes.en.md)（English）
- [`AGENTS.md`](./AGENTS.md) — 改代码前必须知道的架构约束、每个包的模块系统差异与完整踩坑清单

## 贡献

欢迎 issue 与 PR。开发环境、验证命令、测试放哪里、以及两条不可违背的架构约束都在
[`CONTRIBUTING.md`](./CONTRIBUTING.md)。安全相关问题请按 [`SECURITY.md`](./SECURITY.md) 私下报告，不要开公开 issue。

```bash
make hooks           # 装上 pre-commit 密钥扫描
make typecheck && make lint && make test-unit
```

## 许可证

[MIT](./LICENSE) © 2026 AiMD contributors。第三方依赖各自的许可证见 `LICENSE` 末尾与 `pnpm-lock.yaml`；
本项目不含 GPL / AGPL / LGPL 组件。
