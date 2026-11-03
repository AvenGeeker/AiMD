# 设计笔记：与初始方案的差异

[English](./design-notes.en.md) · [返回 README](../README.md)

这里记录**方案与实现的差异**。每一条都是把东西真正跑起来之后才发现的问题，以及为什么最终
采用了另一个做法。写下来是为了以后有人（包括未来的自己）想改回去时，能先看到当初的代价。

「实际采用」就是现在代码里的样子，「原因」是不要改回去的理由。

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

## 相关文档

- [`AGENTS.md`](../AGENTS.md) — 改代码前必须知道的架构约束、模块系统差异与完整踩坑清单（中文）。
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — 开发环境、验证命令、测试放哪里。
- [`SECURITY.md`](../SECURITY.md) — 已实现的安全基线与部署方检查清单。
