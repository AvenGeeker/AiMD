# Contributing · 贡献指南

English below · [中文版](#中文版)

Thanks for your interest. AiMD is a self-hosted, CRDT-synced Markdown notebook: one React
renderer powers the browser, the Electron desktop app and the Capacitor mobile shells, and a
Fastify + Hocuspocus + Postgres server owns the data.

## English

### Ground rules

1. **The Y.Doc is the single source of truth.** Note bodies, note metadata, the folder tree,
   tags and user settings all live in CRDT documents (`packages/shared/src/crdt.ts`). The
   `notes` / `folders` / `tags` / `user_settings` tables are read-only projections refreshed by
   the Hocuspocus `store` hook in the same transaction. A REST handler must never write those
   tables directly — go through `mutateDocument()` in `apps/server/src/collab/direct.ts` so the
   change reaches every connected client.
2. **One contract, defined once.** Request/response shapes are zod schemas in
   `packages/shared/src/api.ts`. The server validates with them, the client infers types from
   them. Do not add Fastify JSON Schema validation — that creates a second contract.
3. **Errors always look like `{ code, message, details? }`**, with `code` from
   `packages/shared/src/errors.ts`.
4. **No ORM.** Queries are plain SQL; row types live in `apps/server/src/db/schema.ts` and
   `test/integration/schema.test.ts` fails if they drift from the migrations.
5. **User-facing copy is Simplified Chinese.** Identifiers, comments and docs are English.

### Adding a syncable field (five places, all required)

Miss one and the field silently stops syncing:

1. document shape in `packages/shared/src/crdt.ts`
2. read/write in `apps/server/src/collab/docFactory.ts`
3. projection in `apps/server/src/collab/projection.ts`
4. a new migration under `apps/server/migrations/`
5. row type in `apps/server/src/db/schema.ts`

### Development setup

```bash
pnpm install        # pnpm 10; the build-script allowlist is in pnpm-workspace.yaml
make hooks          # install the pre-commit secret scanner
make db-up          # dev Postgres on :5433 + throwaway test DB on :5434
make dev            # API on :3000, Vite on :5173
```

Node >= 22, pnpm 10.x, Docker with the Compose v2 plugin. `packages/shared` and
`packages/markdown` must be built before the server and web can typecheck — `pnpm -r build`
handles the topological order.

### Before you open a PR

```bash
make typecheck && make lint && make test-unit   # required, always
make test-integration                           # also required if you touched SQL, CRDT or routes
make test-e2e                                   # also required if you touched the UI
make secrets                                    # must stay clean
```

`make lint` runs with `--max-warnings=0`, so a warning fails the build.

### Tests worth writing

This project has two failure modes that matter more than any other, so prefer tests that cover:

- **cross-tenant access** — one user reading or writing another user's data, over both REST and
  the collaboration WebSocket;
- **offline merge** — two devices editing concurrently, then reconnecting: nothing lost,
  nothing duplicated (tags and quick-capture appends are the usual casualties).

| Type | Location | Requires |
| --- | --- | --- |
| unit | `<package>/test/`, `src/**/*.test.ts` | nothing, in-memory |
| integration | `apps/server/test/integration/` | Postgres on :5434 (`helpers.ts` boots a real app + Hocuspocus) |
| e2e | `apps/web/e2e/` | Postgres on :5433 + a built `apps/web/dist` |

Integration helpers pick port 0 (system-assigned) and **skip the whole file when the database is
unreachable** — so CI must really provide one, otherwise the suite goes green without testing
anything.

Two gotchas when writing tests:

- CodeMirror virtualises off-screen lines, so `.cm-content`'s `innerText` is not the whole
  document. Assert against the server API instead of comparing two editors' DOM text.
- Selecting a note in e2e: use the `data-active-note-id` / `data-note-id` hooks and
  `waitForEditorBound()`. The inbox is pinned and always sorts first, so `.first()` picks wrong.

### Commit style

Conventional Commits, imperative mood, scoped by surface:
`feat(web): …`, `fix(server): …`, `feat(desktop): …`, `docs: …`, `chore(deploy): …`.

### Never commit

Credentials, signing material, local `.env` files, IDE state. `scripts/check-secrets.sh`
enforces this in CI and via the pre-commit hook installed by `make hooks`. Files that your IDE
rewrites with machine-local signing data (`apps/mobile/harmony/build-profile.json5`,
`apps/mobile/ios/App/App.xcodeproj/project.pbxproj`) should be marked developer-local:

```bash
git update-index --skip-worktree apps/mobile/harmony/build-profile.json5
git update-index --skip-worktree apps/mobile/ios/App/App.xcodeproj/project.pbxproj
# undo with --no-skip-worktree
```

### Licensing of contributions

Contributions are provided under the project's [MIT license](./LICENSE). Do not add a
dependency whose license is GPL / AGPL / LGPL without raising it in the PR first.

---

## 中文版

### 不可违背的约束

1. **Y.Doc 是唯一真相**：笔记正文、笔记 meta、目录树、标签、用户设置都在 CRDT 文档里
   （`packages/shared/src/crdt.ts`）。`notes` / `folders` / `tags` / `user_settings` 是只读投影，
   由 Hocuspocus 的 `store` 钩子在同一事务里刷新。REST 写操作不许直接改这些表，
   要走 `apps/server/src/collab/direct.ts` 的 `mutateDocument()`，否则两个真相源会分叉。
2. **契约只定义一次**：请求/响应结构是 `packages/shared/src/api.ts` 里的 zod schema，
   服务端拿它校验、客户端拿它推导类型。不要用 Fastify JSON Schema 校验。
3. **错误统一 `{ code, message, details? }`**，code 定义在 `packages/shared/src/errors.ts`。
4. **不要引入 ORM**：全部裸 SQL，行类型在 `apps/server/src/db/schema.ts`，
   `test/integration/schema.test.ts` 负责断言它和 migration 不漂移。
5. **面向用户的文案是简体中文**，标识符、注释和文档是英文。

### 新增一个可同步字段（五处都要动）

`packages/shared/src/crdt.ts` 文档结构 → `apps/server/src/collab/docFactory.ts` 读写 →
`apps/server/src/collab/projection.ts` 投影 → `apps/server/migrations/` 新增 migration →
`apps/server/src/db/schema.ts` 行类型。缺一处就静默不同步。

### 环境与验证

```bash
pnpm install && make hooks && make db-up && make dev
make typecheck && make lint && make test-unit   # 最小验证
make test-integration                           # 碰了 SQL / CRDT / 路由
make test-e2e                                   # 碰了 UI
make secrets                                    # 必须干净
```

### 优先补的测试

**跨租户越权**（REST 与协同 WebSocket 两条路都要覆盖）和**离线合并后数据不丢不重**
（标签、速记追加最容易出问题），这是本项目的两条命门。

### 提交规范

Conventional Commits，动词开头，按端加 scope：`feat(web): …`、`fix(server): …`、
`feat(desktop): …`、`docs: …`、`chore(deploy): …`。

### 禁止提交

凭据、签名材料、本地 `.env`、IDE 状态。`scripts/check-secrets.sh` 会在 CI 与 pre-commit
钩子里拦住它们。会被 IDE 写入本机签名信息的文件
（`apps/mobile/harmony/build-profile.json5`、
`apps/mobile/ios/App/App.xcodeproj/project.pbxproj`）请用 `git update-index --skip-worktree`
标记为开发者本地文件（命令见上）。

### 贡献的授权

贡献代码按项目的 [MIT 许可证](./LICENSE) 提供。新增依赖如果是 GPL / AGPL / LGPL，
请先在 PR 里说明再合并。

## Code of conduct · 行为准则

Be direct about code, kind about people. Harassment, personal attacks and spam are not
tolerated; report problems to the maintainer's email in [`SECURITY.md`](./SECURITY.md).

对代码直接，对人友善。不接受骚扰、人身攻击与垃圾内容；有问题请通过
[`SECURITY.md`](./SECURITY.md) 里的邮箱联系维护者。
