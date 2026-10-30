# aiMarkdown

自托管的多端同步 Markdown 笔记本。一套 React 代码同时作为**浏览器端**和 **Electron 桌面端**（macOS / Windows）的界面，服务端是 **Fastify + Hocuspocus + Postgres**，用 **Docker Compose 一键部署**。

- **多端同步**：基于 **Yjs CRDT**，离线可写，联网后字符级自动合并，不会互相覆盖
- **Markdown 编辑与预览**：CodeMirror 6 源码编辑 + 实时预览，支持分栏 / 纯编辑 / 纯预览三态
- **全局快捷键速记**：macOS / Windows 全局热键唤出无边框置顶小窗，内容以 CRDT 追加写入「收集箱」

---

## 一键部署

需要一台服务器，装好 Docker Engine + Compose v2 插件，并且 80/443 端口可用（或改用 `HTTP_PORT` / `HTTPS_PORT`）。

```bash
git clone <your-repo> aiMarkdown && cd aiMarkdown
./scripts/deploy.sh
```

脚本会依次完成：

1. 检查 Docker 与端口占用
2. 首次运行时交互式生成 `deploy/.env`，用 `openssl rand` 填充 `JWT_SECRET` 与 `POSTGRES_PASSWORD`
3. `docker compose up -d --build` 构建并启动 **Caddy + app + Postgres**
4. 数据库迁移在容器启动时自动执行（幂等），无需手动步骤
5. 轮询 `/api/health`，成功后打印访问地址

部署完成后访问 `https://<你的域名>/` 注册第一个账号。**注册默认开放**，创建好自己的账号后，把 `deploy/.env` 里的 `ALLOW_REGISTRATION=false` 并重新执行 `./scripts/deploy.sh` 关闭注册。

Caddy 会自动申请并续期 Let's Encrypt 证书。如果拉取镜像失败（国内网络常见），脚本会提示配置镜像加速，详见[国内网络](#国内网络注意事项)。

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
30 3 * * * cd /path/to/aiMarkdown && ./scripts/backup.sh --keep 14 >> /var/log/aimarkdown-backup.log 2>&1
```

---

## 本地开发

```bash
pnpm install
make db-up      # 启动开发用 Postgres（:5433）与测试库（:5434）
make dev        # 同时启动 API（:3000）与 Vite（:5173）
```

桌面端另开一个终端：

```bash
pnpm --filter @aimarkdown/web build      # 或保持 Vite dev server 运行
pnpm --filter @aimarkdown/desktop dev    # 启动 Electron 外壳
```

桌面端会自动探测 `http://127.0.0.1:5173`，有 Vite dev server 就用它（编辑器热更新），否则加载已构建的产物。

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

- 默认 **macOS `⌥Space`** / **Windows `Ctrl+Alt+Space`**，可在「设置」里改，设置本身存在 workspace CRDT 里，因此多端一致
- 注册失败（被 Raycast / Alfred 等占用）时，托盘菜单与设置页都会明确告警，不会静默失效
- 小窗无边框、置顶、跨 Space 可见；`Esc` 或失焦隐藏（隐藏而非销毁，保持热启动）
- `⌘/Ctrl + Enter` 提交，内容以 CRDT 追加写入收集箱末尾——即使此刻另一台设备正在编辑这篇笔记的中间部分，两边都不会丢

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

## 已知限制

这些是 v1 有意为之的取舍，不是遗漏：

- **没有「时间旅行」版本历史**。选择了 CRDT 方案，而 Yjs 默认不提供按时间点回滚。目前用**回收站**（软删除 / 恢复 / 彻底删除）兜底；后续可以基于周期性 Y.Doc 快照增量实现。
- **中文搜索基于 `pg_trgm`**，是子串匹配而非分词。Postgres 原生全文检索不分中文词，而 `zhparser` / `pg_bigm` 需要自建镜像。因此**搜索词至少 2 个字符**，且没有语义/模糊检索。`SEARCH_DRIVER` 环境变量已预留升级位。
- **单实例部署**。没有引入 Redis，因此不能横向扩展 app 容器。Hocuspocus 支持 Redis pub/sub，需要多实例时再加。
- **附件存本地 Docker 卷**，没有接 S3/MinIO。存储通过 `AttachmentStorage` 接口隔离，替换实现即可。
- **未启用 CSP**。前端会注入运行时样式，预览还要渲染 KaTeX/MathML，半吊子的 CSP 只会制造故障。笔记内容的 XSS 边界是 DOMPurify（渲染管线本身也以 `html: false` 转义所有原始 HTML）。收紧 CSP 是后续加固项。
- **邮箱注册不发验证邮件**，避免引入 SMTP 依赖。

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
| GET | `/health` | 存活探针（部署脚本与容器健康检查使用） |
| WS | `/collab` | Hocuspocus 协同通道，连接时必须携带 access token |

令牌有两种传输方式，共用同一套服务端逻辑：浏览器用 httpOnly cookie（脚本读不到），Electron 用 `Authorization: Bearer` 并把 refresh 令牌存进系统钥匙串（`safeStorage`）。桌面端请求时带上 `X-Token-Transport: bearer`，服务端才会在响应体里返回 refresh 令牌。
