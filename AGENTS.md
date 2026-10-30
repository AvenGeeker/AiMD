# AGENTS.md

自托管的多端同步 Markdown 笔记本：一套 React 代码同时作为浏览器端与 Electron 桌面端，服务端是
Fastify + Hocuspocus + Postgres，同步基于 Yjs CRDT。面向用户的说明在 `README.md`；这里只写
**改代码前必须知道的事**。

---

## 命令

```bash
pnpm install          # 首次；pnpm 10 默认拦截构建脚本，白名单在 pnpm-workspace.yaml
make db-up            # 开发库 :5433 + 测试库 :5434（集成测试和 E2E 都需要）

make typecheck        # 全仓 tsc
make lint             # eslint --max-warnings=0（有 warning 就算失败）

make test-unit        # 183 项，纯内存，不需要数据库
make test-integration # 103 项，需要 :5434（真实 Postgres + 真实 Hocuspocus WebSocket）
make test-e2e         # 15 项，需要 :5433 + 已构建的 apps/web/dist

make dev              # Postgres + API(:3000) + Vite(:5173)
pnpm --filter @aimarkdown/desktop dev    # Electron 外壳，需先有 make dev
pnpm --filter @aimarkdown/desktop dist:mac   # 打 dmg
```

改完代码的最小验证：`make typecheck && make lint && make test-unit`。
碰了服务端 SQL / CRDT / 路由，再加 `make test-integration`。碰了 UI，再加 `make test-e2e`。

**构建顺序有依赖**：`packages/shared` 和 `packages/markdown` 必须先 build 出 `dist/`，
server 和 web 才能 typecheck（它们是 workspace 依赖，走 `main`/`types` 指向 dist）。
`pnpm -r build` 会按拓扑序处理；单独 build 某个 app 前记得先 build packages。

---

## 不可违背的架构约束

**Y.Doc 是唯一真相，Postgres 里的同名列只是投影。**

- 笔记正文、笔记 meta、目录树、标签、用户设置全部活在 CRDT 里
  （`note-{noteId}` 和 `workspace-{userId}` 两类文档，定义见 `packages/shared/src/crdt.ts`）。
- `notes` / `folders` / `tags` / `user_settings` 是只读投影，由 Hocuspocus 的 `store` 钩子在
  同一个事务里刷新（`apps/server/src/collab/persistence.ts`）。
- **REST 写操作不许直接改这些表。** 走 `collab/direct.ts` 的 `mutateDocument()`——它打开真实文档、
  改动、广播给所有在线客户端，然后调用方再刷一次投影保证响应不滞后。绕过这条路会造成两个真相源分叉。
- 客户端也不能只写 Postgres：改动必须落到 Y.Doc，否则不会同步到其他设备。

推论：**新增一个可同步字段 = 改 `packages/shared` 的文档结构 + 改 `collab/docFactory.ts` 的读写 +
改 `collab/projection.ts` 的投影 + 改 migration + 改 `db/schema.ts` 的行类型**，五处都要动，缺一处就静默不同步。

---

## 会让人踩坑的地方（都是真实修过的 bug）

### 模块系统每个包都不一样

| 包 | module | 后果 |
| --- | --- | --- |
| `apps/server` | NodeNext (ESM) | **相对导入必须带 `.js` 后缀**，否则运行时 `ERR_MODULE_NOT_FOUND`（tsc 不报错） |
| `apps/web` | ESNext / bundler | 同样统一写 `.js` 后缀，保持一致 |
| `apps/desktop` | CommonJS | 用 `__dirname`，**不能用 `import.meta`**；preload 必须能被 sandbox 加载 |
| `packages/*` | 继承 base (bundler) | 纯库，产出 ESM |

### 数据库层

- **不要引入 ORM。** `drizzle-orm/postgres-js` 会改写传入连接的 serializers，之后绑定 JS `Date`
  直接抛 `ERR_INVALID_ARG_TYPE`。所有查询是裸 SQL，行类型在 `db/schema.ts`，
  `test/integration/schema.test.ts` 负责断言它和 migration 不漂移。
- **不要用 `new Date(String(row.x))`。** postgres.js 返回的 timestamptz 已经是 `Date`，
  经 `String()` 会截断到整秒。一律用 `utils/dates.ts` 的 `toDate/toDateOr/toIso`。
- **jsonb 回来是字符串**（simple query 协议下）。用 `db/json.ts` 的 `parseJsonb()`，
  直接当对象读会静默拿到 `undefined` 然后回落默认值。
- **bytea 用 `db/bytea.ts`** 的 hex 编解码，不要指望驱动自动处理。
- 接受事务句柄的函数参数类型是 `ISql`（postgres.js 官方的 "Sql / TransactionSql 共同点"），
  不是 `Sql`——否则 `sql.begin(tx => ...)` 传不进去。
- `pg_trgm` 不支持中文分词，只做子串匹配，所以**搜索词至少 2 字符**，这是产品约束不是 bug。

### Hocuspocus v4 的命名和关停顺序

- 是 `websocketOptions` 不是 `wsOptions`；是 `flushPendingStores()` 不是 `flushDocumentHooks()`。
- **必须 `stopOnSignals: false`**，否则 Hocuspocus 自己抢 SIGTERM，来不及 flush。
- 关停顺序是 **先 `closeConnections()` → 再 flush → 再轮询排空**。仍有连接的文档永远不会 unload，
  顺序反了 `drained` 恒为 false。
- `Database` 扩展的 `store` 收到的是 `state: Buffer`，`fetch` 必须返回 `Uint8Array | null`。
- Provider v4 的回调只能写在构造参数里（没有 `provider.onSynced()` 方法），且 `disconnect()` 是同步的。

### Web / 渲染

- **`@fastify/static` 必须 `wildcard: true`。** 关掉之后静态资源路由根本不存在，所有 `/assets/*.js`
  会落到 SPA 兜底、返回 `text/html` 且**状态码 200**，浏览器 MIME 校验失败 → 白屏、服务端零报错。
- 缺失的静态资源要 404，不能返回 SPA 外壳（`plugins/error-handler.ts` 里有显式判断）。
- `index.html` 缓存按 mtime 失效，否则重新构建后会继续吐旧的 asset hash。
- **DOMPurify 会丢掉值里含换行的 `data-*` 属性**，所以 mermaid 源码放在 `<pre><code>` 文本里而不是属性里。
- markdown-it v15：`MarkdownIt` 是**具名类型导出**，default 是 callable 值；`renderToken` 只收 3 个参数；
  `attrGet()` 返回 `string | number | null`。
- **CodeMirror 会虚拟化视口外的行**，所以 `.cm-content` 的 `innerText` 不等于完整文档。
  断言文档内容要查服务端，不要比对两个编辑器的 DOM 文本。
- 订阅 Y.Doc 的 hook（`useNoteMeta` / `useNoteTagIds`）必须把观察计数器放进 `useMemo` 依赖，
  否则永远缓存同步前的空文档值。

### CRDT 写入

- 改 `Y.Array` 要用**最小 diff**（只删移除项、只插新增项）。整体 `delete(0, len) + insert(0, next)`
  会破坏未改动元素的 CRDT 身份，两台设备各加一个不同标签会合并出重复项。
- 读取端仍要去重：两台设备并发加**同一个**标签，Yjs 无法知道语义相同，会产生两份。
- 速记追加一律 `insert` 到 `body.length`——这是能和其他设备的并发编辑安全合并的插入点。
- 目录树可能出现环（两端离线各自移动同一目录）。`sanitizeFolderTree` 确定性地断环，
  前端 `buildTree` 也要能把环里的节点显示在根层级，不能让它消失。

### Electron

- 渲染层直接复用 `apps/web/dist`，由 `apps/desktop/scripts/copy-renderer.mjs` stage 到 `apps/desktop/renderer`。
  **改完 web 必须重新 stage**，脚本会在 bundle 过期时告警、空目录时失败。
- Vite dev server 绑的是 `127.0.0.1`（不是默认的 `::1`），否则桌面端 dev 探测不到、静默退回旧 bundle。
- `app.setLoginItemSettings` 要 read-before-write，未签名构建下每次调用都会刷 `Operation not permitted`。
- 全局快捷键注册失败必须显式告警（托盘 + 设置页），不能静默。

### 部署

- **Postgres 18 的卷要挂 `/var/lib/postgresql`**，不是 `/var/lib/postgresql/data`，挂错容器直接崩溃。
- Docker Compose 对未设置的变量传**空字符串**，所以可选配置项要用 `blankToUndefined` 预处理，
  否则 `min(8)` 之类的校验会让整个部署起不来（`apps/server/src/config.ts`）。
- Caddy 需要在 compose 里显式拿到 `PUBLIC_URL`，否则站点地址展开成空、容器无限重启。
- Caddy 自己读 `ACME_EMAIL` 环境变量，不要写 `email {$ACME_EMAIL}` 指令（空值会报配置错误）。
- 没有反向代理直连 app 时，必须设 `COLLAB_PUBLIC_URL`，否则浏览器连同源 `/collab` 会失败。

---

## 约定

- **错误契约统一**：所有失败都是 `{ code, message, details? }`，code 定义在 `packages/shared/src/errors.ts`。
  不要新造错误形状，不要返回裸字符串。
- **校验用 zod，且在 `packages/shared` 里定义一次**，服务端拿它校验、客户端拿它推导类型。
  不要用 Fastify 的 JSON Schema 校验（会形成第二套契约）。handler 里用 `utils/validate.ts` 的 `parse()`。
- **新增 REST 端点**：在 `packages/shared/src/api.ts` 加 zod schema → 在对应 `routes/*.ts` 注册 →
  鉴权用 `{ preHandler: [requireAuth] }`（注意别写 `as const`，readonly 数组 Fastify 不收）→
  所有查询必须按 `owner_id` 收窄，写完补一条跨租户测试。
- 密码用 `@node-rs/argon2`（有 musl 预编译二进制，Alpine 不需要编译器），不要换成 `argon2` 包。
- ZIP 用 `fflate`（纯 JS，Node 和浏览器同一实现）。不要用 `archiver`：v8 是纯 ESM 具名导出，
  而 `@types/archiver` 还停在 v7 的 `export =`。
- 时间戳一律 `Date` 对象进 SQL，读出一律过 `utils/dates.ts`。
- 面向用户的文案是简体中文。
- **不要加 `// eslint-disable-next-line react-hooks/...`**：本仓没装 eslint-plugin-react-hooks，
  ESLint 会对未知规则的 disable 指令直接报错。需要解释依赖数组时写普通注释。

---

## 测试怎么放

| 类型 | 位置 | 需要 |
| --- | --- | --- |
| 单元 | 各包 `test/` 或 `src/**/*.test.ts` | 无，纯内存 |
| 集成 | `apps/server/test/integration/` | Postgres :5434，`helpers.ts` 会起真实 app + Hocuspocus |
| E2E | `apps/web/e2e/` | Postgres :5433 + `apps/web/dist` |

- 集成测试的 `helpers.ts` 提供 `startTestServer()` / `register()` / `api()`，端口用 0（系统分配），
  数据库连不上时整个文件自动 skip——所以 CI 里必须真的提供数据库，否则会变成"全绿但什么都没测"。
- 涉及 debounce 的测试要用**独立的 server 实例**并把 `COLLAB_DEBOUNCE` 调大，
  这样"落库只能靠关停 flush"才是可断言的（见 `collab.test.ts` 的 graceful shutdown 用例）。
- E2E 断言文档内容要查服务端 API，不要比对 CodeMirror 的 DOM 文本（视口虚拟化）。
- E2E 里选笔记要用 `data-active-note-id` / `data-note-id` 这两个钩子，并用 `waitForEditorBound()`
  等编辑器真正换绑到新文档——收集箱是置顶的、永远排第一，`.first()` 会拿错。
- 加测试时优先覆盖**跨租户越权**和**离线合并后数据不丢不重**，这是这个项目的两条命门。
