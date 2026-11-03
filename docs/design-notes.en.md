# Design notes: where the implementation diverged from the plan

[简体中文](./design-notes.zh.md) · [Back to README](../README.en.md)

Every row below was discovered by running the thing, not by reading about it. The "what we
actually do" column is what the code does today; the "why" column is the reason not to change
it back.

| Original plan | What we actually do | Why |
| --- | --- | --- |
| Drizzle ORM on top of `postgres` | Plain `postgres`, hand-written SQL, row types in `db/schema.ts` | **`drizzle-orm/postgres-js` rewrites the serializers of the connection you hand it.** After that, binding a JS `Date` throws `ERR_INVALID_ARG_TYPE` instead of writing a `timestamptz`. Every query here was already raw SQL (bytea, trgm expression indexes, projection upserts), so the ORM bought nothing and broke correctness. An integration test asserts the live schema matches the row types instead. |
| `argon2` | `@node-rs/argon2` | Ships prebuilt NAPI binaries for linux-x64-musl / linux-arm64-musl, so the Alpine image needs no toolchain. Still argon2id. |
| `archiver` for ZIP | `fflate` | archiver v8 is ESM-only with named exports (`ZipArchive`, no default) while `@types/archiver` still targets v7's `export =`. fflate is pure JS with one implementation for Node and the browser, so import and export share code. |
| Hocuspocus `wsOptions` / `flushDocumentHooks()` | `websocketOptions` / `flushPendingStores()` | The real v4 names. Also `stopOnSignals: false` is mandatory — otherwise Hocuspocus grabs SIGTERM itself and pending CRDT stores never flush. |
| On shutdown, flush first, then close connections | **Close connections first**, then flush, then poll until drained | A document with live connections never unloads, so `drained` would stay false forever. |
| Mount the Postgres volume at `/var/lib/postgresql/data` | Mount `/var/lib/postgresql` | Postgres 18 changed the convention; the old path makes the container crash and tell you to run `pg_upgrade`. |
| Caddy always owns 80/443 | `HTTP_PORT` / `HTTPS_PORT` are configurable | Machines usually already run another reverse proxy. |
| Browser always talks to same-origin `/collab` | `COLLAB_PUBLIC_URL` can be injected at runtime | Without a reverse proxy (local dev, e2e, bare-metal) same-origin `/collab` does not exist. The server injects `window.__AIMARKDOWN_CONFIG__` while serving `index.html`, so one build fits every topology. |
| `folderId = null` means "root" | A separate `rootOnly=true` flag | `"null"` is itself a valid id-shaped string, so it would be read as a folder that happens to hold no notes. |
| Desktop refresh token via cookie | The client sends `X-Token-Transport: bearer` and only then does the server return it in the body | A browser must never receive a refresh token (that would defeat `httpOnly`), but Electron has no usable cookie jar under `file://`. |
| Note `tagIds` inside the `meta` map | Promoted to a top-level `Y.Array`, written with a **minimal diff** | Replacing the whole array destroys the CRDT identity of untouched tags; two devices adding two different tags would merge into duplicates. |

## Further reading

- [`AGENTS.md`](../AGENTS.md) — architectural invariants, per-package module systems and the
  full pitfall list (Chinese).
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — development setup, verification commands, where tests live.
- [`SECURITY.md`](../SECURITY.md) — implemented hardening baseline and the operator checklist.
