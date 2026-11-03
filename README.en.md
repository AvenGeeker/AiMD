<div align="center">

<img src="apps/desktop/resources/icon.png" alt="AiMD" width="96" height="96" />

# AiMD

**A self-hosted, multi-device Markdown notebook.**

One React codebase powers the browser client, the Electron desktop app (macOS / Windows) and the
mobile shells (Android / iOS / HarmonyOS). The server is Fastify + Hocuspocus + Postgres, and sync
runs on **Yjs CRDTs**: write offline, and changes merge character-by-character when you reconnect —
devices never overwrite each other.

[![CI](https://github.com/geekeraven/aimarkdown/actions/workflows/ci.yml/badge.svg)](https://github.com/geekeraven/aimarkdown/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)
![pnpm](https://img.shields.io/badge/pnpm-10.x-f69220)
![Postgres](https://img.shields.io/badge/postgres-18-336791)

[简体中文](./README.md) | **English**

</div>

---

## Why

Notes are the last thing you want locked into a platform. AiMD's goal: **if you have a server, you
fully own a Markdown library that syncs across all your devices in real time.** Data lives in your
own Postgres and on your own disk, you can export the whole vault as `.md` files in a ZIP at any
moment, and you can import it back. No third party behind the account system, no monthly fee, no
"service shut down, data gone".

Nothing here reinvents a wheel: Yjs for CRDTs, Hocuspocus for collaboration transport, CodeMirror 6
for editing, and a rendering pipeline built on markdown-it / KaTeX / mermaid / DOMPurify.
**The Y.Doc is the single source of truth**; relational tables are read-only projections of it.
That invariant runs through the whole repository — see [Architecture](#architecture).

## Features

| | |
| --- | --- |
| **Real-time multi-device sync** | Yjs CRDTs, offline writes via y-indexeddb, character-level merge on reconnect; two devices editing the same paragraph lose nothing |
| **Markdown editing and preview** | CodeMirror 6 source editing with live preview, and split / edit-only / preview-only modes; GFM, task lists, KaTeX math, mermaid diagrams, `[[wikilinks]]` |
| **Global-hotkey quick capture** | Separate desktop hotkeys for "show main window" and "show capture window", recorded by pressing keys in Settings; captured text is appended to the inbox through the CRDT, merging safely with edits already in flight |
| **AI summaries and auto-tags** | The server calls any OpenAI-compatible endpoint to produce a summary, key points, checkable todos and up to 3 tags; batch backfill with visible progress and cancellation |
| **Favourites and folder AI** | Save Xiaohongshu/Douyin/WeChat/web links or share media from a phone; OCR/transcription enriches the note and AI files it under Favourites categories. Any folder supports Q&A, search and trip planning |
| **Two-way macOS Notes sync** | The desktop app mirrors your whole Apple Notes account (folders, notes, attachments) both ways; conflicts and read-only items are tagged, deletions are recoverable |
| **Folders and tags** | Unlimited folder depth, drag to move, multi-tag AND filtering; fractional-index ordering so inserting never disturbs a concurrent edit |
| **Search** | Postgres `pg_trgm` substring matching, works for Chinese (minimum 2 characters) |
| **Attachments** | Paste/drop image upload, authenticated download, SVG served under its own CSP |
| **Import and export** | Export a note as `.md`, export the vault as a ZIP (folder hierarchy and CJK filenames preserved), import `.md` or ZIP to rebuild the tree |
| **Trash** | Soft delete / restore / delete permanently |
| **Responsive and mobile** | The same web build runs in the browser, Electron and the Capacitor shells; foldable and rotation layouts are handled |
| **Security** | argon2id, JWT with refresh rotation, httpOnly cookies in the browser / OS keychain on desktop, `owner_id`-scoped tenancy, rate limiting, AI keys encrypted with AES-256-GCM |

<!-- Screenshots: drop images into docs/screenshots/ and embed them here with Markdown image syntax (editor.png / capture.png / mobile.png) -->

---

## Quick start

### Option 1: one-command Docker Compose deployment (recommended)

You need a server with Docker Engine and the Compose v2 plugin.

```bash
git clone https://github.com/geekeraven/aimarkdown.git AiMD
cd AiMD
./scripts/deploy.sh
```

The script then:

1. checks Docker and whether the ports are free
2. on first run, interactively creates `deploy/.env`: asks for the public address (domain, or public
   IP + port), fills `JWT_SECRET` and `POSTGRES_PASSWORD` with `openssl rand`, and derives the Caddy
   site address
3. runs `docker compose up -d --build` to build and start **Caddy + app + Postgres**
4. applies database migrations automatically at container start (idempotent) — no manual step
5. polls `/api/health` and prints the URL when it is up

Open the printed URL and register the first account. **Registration is open by default**: once your
accounts exist, set `ALLOW_REGISTRATION=false` in `deploy/.env` and re-run `./scripts/deploy.sh`.

Two deployment modes are supported:

| Mode | When | How you reach it |
| --- | --- | --- |
| **Domain mode** (recommended) | You have a domain pointing at the server | `https://your-domain/`; Caddy issues and renews Let's Encrypt certificates, 80 redirects to 443 |
| **Direct-IP mode** | No domain, you just want it running | `http://server-ip:port/`; plain HTTP, the browser will warn, that is expected |

**Domain mode**: set `PUBLIC_URL=https://your-domain` (with scheme) in `deploy/.env`;
`CADDY_SITE_ADDR` is derived for you. If 80/443 are taken, change `HTTP_PORT` / `HTTPS_PORT`.

**Direct-IP mode**: the script asks for the public IP and port (default `8080`).
`PUBLIC_URL=http://IP:PORT` and `CADDY_SITE_ADDR=http://IP` (**without the port** — Caddy binds 80
inside the container; the host-side port comes from `HTTP_PORT`).

- On mainland-China ECS, **ports 80/443 are blocked until the domain is filed (ICP)**, so a
  non-standard port is required (hence the 8080 default). Outside mainland China you can keep 80.
- Over plain HTTP the session cookie carries no `Secure` flag (the server decides per request, Caddy
  forwards `X-Forwarded-Proto`); everything else behaves identically to HTTPS.
- Add a domain later: change `PUBLIC_URL` / `CADDY_SITE_ADDR` / `HTTP_PORT` and re-run
  `./scripts/deploy.sh` to switch to HTTPS without downtime.

If pulling images fails (common from mainland China), see
[China network notes](#china-network-notes).

### Option 2: desktop clients

Download a `.dmg` (macOS, x64 / arm64) or `.exe` (Windows x64) from
[Releases](https://github.com/geekeraven/aimarkdown/releases), then enter your server address on
first launch.

> Enter the **root address of your deployment** — the one that opens the notebook in a browser —
> such as `https://notes.example.com` or `http://203.0.113.10:8080`: no `/api` prefix, and not some
> other site or router admin page. Saving probes `/api/health` first and tells you right there why
> an address was rejected, instead of failing later at login with an unreadable error. A missing
> `https://` is added automatically.

**The artifacts are unsigned** (no Apple Developer ID, no Windows code-signing certificate), so the
OS will object the first time:

- **macOS**: right-click → Open, or System Settings → Privacy & Security → "Open Anyway"
- **Windows**: on the SmartScreen prompt choose "More info → Run anyway"

To distribute properly, replace `build.mac.identity: null` in `apps/desktop/package.json` with your
certificate and enable `hardenedRuntime`.

### Option 3: mobile (Android / iOS / HarmonyOS)

`apps/mobile` uses **Capacitor** to reuse the same React renderer as Electron (the same `web/dist`
contract). Auth is a bearer token, sync goes over the `/collab` WebSocket, offline persistence uses
the WebView's IndexedDB, and tokens live in the Keychain / Android Keystore.

```bash
pnpm install
pnpm --filter @aimarkdown/mobile add:android   # first time: generate native projects
pnpm --filter @aimarkdown/mobile add:ios

make mobile-build    # web build -> stage -> sync www and the harmony resfile
make mobile-apk      # Android debug APK
make mobile-ipa      # iOS simulator build (unsigned)
make mobile-hap      # HarmonyOS HAP — needs DevEco Studio
```

- The Android project is pinned to **AGP 8.7.3 / compileSdk 35** (compatible with 2025-generation
  Android Studio; rationale and upgrade path are in `apps/mobile/android/variables.gradle`), Gradle 8.14.3.
- **The sideload build allows cleartext HTTP** (flagged in AndroidManifest / Info.plist). Remove that
  and force HTTPS before publishing to a store.
- HarmonyOS uses a minimal ArkWeb harness in `apps/mobile/harmony` (Stage model + a javaScriptProxy
  bridge); the only native plugin surface is token storage. Signing material is generated by DevEco
  Studio under `~/.ohos/` — **never commit the `signingConfigs` block of `build-profile.json5`**
  (see [Contributor notes](#contributor-notes)).

---

## Operations

On the server, prefer `scripts/aimd.sh`: it chains backup, build, health check and image rollback.

```bash
./scripts/aimd.sh deploy          # first deployment; treated as an update if one exists
./scripts/aimd.sh update          # backup -> build -> switch -> health check, auto-rollback on failure
./scripts/aimd.sh apply           # apply deploy/.env changes without rebuilding
./scripts/aimd.sh rollback        # roll back to the previous app image
./scripts/aimd.sh releases        # release history
./scripts/aimd.sh status          # version, containers, health, DNS, certificates
./scripts/aimd.sh logs app        # follow app logs
./scripts/aimd.sh backup --keep 14
```

Or through the Makefile:

```bash
make logs            # follow application logs
make ps              # container status
make backup          # back up database + attachments into ./backups/
make deploy-rebuild  # rebuild and redeploy
make down            # stop (volumes are kept)
```

The backup script exports `pg_dump` (custom format) plus the attachment volume and snapshots
`deploy/.env`. Scheduled backups:

```cron
30 3 * * * cd /path/to/AiMD && ./scripts/backup.sh --keep 14 >> /var/log/aimarkdown-backup.log 2>&1
```

### Recommended: build in CI, let the VPS pull the image

A source build has to run Vite/Rolldown over 4,000+ modules on the first build, after dependency
changes, or whenever Web sources change, then minify the large mermaid/shiki chunks. On a small VPS
(especially a burstable instance whose CPU credits are exhausted) that can take several minutes — it is
compilation, not a deadlock. Server-only changes reuse the Web layer, but a Web change always pays for
the whole bundle.

Build off the VPS instead. CI publishes images to GHCR on `main` and `v*` tags:

- `ghcr.io/<owner>/<repo>:latest`, `:main` (rolling default-branch tag)
- `ghcr.io/<owner>/<repo>:sha-xxxxxxx` (every commit)
- `ghcr.io/<owner>/<repo>:v1.2.3` / `:1.2.3` (tag releases)

The server only pulls layers; it needs neither Node nor Vite:

```bash
# deploy/.env
APP_IMAGE=ghcr.io/<owner>/<repo>:latest
```

```bash
./scripts/aimd.sh update   # docker pull -> switch -> health check, auto-rollback on failure
```

> GHCR packages are private by default after the first publish: either make the package public in the
> repository's **Packages** settings, or run `docker login ghcr.io` on the server. If ghcr.io is slow or
> unreachable from mainland China, mirror the image to Aliyun ACR (or another reachable registry) and
> point `APP_IMAGE` there, or use the offline `docker save/load` flow below.

Use `./scripts/deploy.sh --rebuild` / `make deploy-rebuild` only when you really need to build from
source on the server.

Release records, the current image and the `.env` snapshot live in `.deploy/` (gitignored).
**Rollback only switches the app image; it does not roll back database migrations.** To roll data
back, use an archive from `backups/` and follow its `BACKUP.json`.

---

## Development

### Prerequisites

```bash
node -v      # >= 22
pnpm -v      # 10.x
docker -v    # Compose v2 plugin required
```

```bash
pnpm install     # auto-approves the esbuild / @node-rs/argon2 / electron build scripts
make hooks       # install the pre-commit secret scanner
make db-up       # dev Postgres on :5433 + throwaway test DB on :5434
```

### Run it in a browser (fastest, hot reload)

```bash
make dev
# -> API  http://127.0.0.1:3000
# -> Web  http://127.0.0.1:5173   <- open this
```

Vite proxies `/api` and `/collab` to the local server, so the browser only ever talks to port 5173.

### Run the Electron desktop app (with the global-hotkey capture window)

Keep the above running and open a second terminal:

```bash
pnpm --filter @aimarkdown/desktop dev
```

The script probes `http://127.0.0.1:5173`: if it answers, Vite is used (editor hot reload);
otherwise it loads the built bundle and tells you to run `pnpm --filter @aimarkdown/web build` first.
On first launch you are asked for a server address — use `http://127.0.0.1:3000` for local development.

Then press **⌥Space** to summon the capture window, `⌘Enter` to append to the inbox, `Esc` to hide it,
and **⌘⇧M** to open the main window. Both hotkeys can be re-recorded in Settings → Desktop by
clicking the field and pressing the new combination.

> If Raycast / Alfred already own the combination, registration fails loudly — the tray menu and the
> settings page both say so. Record a different one; it never fails silently.

### Packaging

```bash
pnpm --filter @aimarkdown/desktop dist:mac   # dmg + zip, x64 and arm64
pnpm --filter @aimarkdown/desktop dist:win   # nsis, x64
```

Build only your own architecture to halve the time:

```bash
cd apps/desktop && pnpm build && npx electron-builder --mac --x64
```

> The renderer must be built first: `pnpm build` runs `web build -> main compile -> stage renderer`
> in that order. If you run `electron-builder` alone without re-staging, `copy-renderer.mjs` warns
> that the bundle may be stale.

The `electron-updater` dependency is present but auto-update checking is **not enabled** — it needs a
publish source such as GitHub Releases; wire `autoUpdater` up once you have one.

### Tests

```bash
make test                # unit tests (no database needed)
make test-integration    # real Postgres + real Hocuspocus WebSocket (needs :5434)
make test-e2e            # Playwright end-to-end (needs :5433 + apps/web/dist)
make typecheck && make lint
make secrets             # secret scan (must stay clean)
```

Current scale: **261 unit tests** (verified green before this release), **120 integration test
cases**, **38 end-to-end cases**.

The two things this project most needs covered are **cross-tenant access** and **offline merges that
neither lose nor duplicate data**. That means: CRDT offline merge, quick-capture appends, minimal tag
diffs, folder delete-and-remount, the Markdown pipeline (GFM / KaTeX / mermaid / wikilink / task
lists), XSS sanitisation, fractional ordering, config parsing, date and bytea codecs, WebSocket auth
and cross-tenant rejection, projection mirroring, trgm Chinese search, tag AND filtering, trash,
attachment auth and SVG CSP, ZIP export→import round-trip, **shutdown inside the debounce window
still loses no writes**, schema/row-type consistency, two-device live sync and offline merge, capture
vs. concurrent editing, and hotkey recording.

---

## Architecture

```
┌─────────────┐  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐
│ Browser     │  │ Electron    │  │ Electron     │  │ Mobile      │
│ (web)       │  │ main window │  │ capture win  │  │ (Capacitor) │
└──────┬──────┘  └──────┬──────┘  └──────┬───────┘  └──────┬──────┘
       │        one and the same Vite build (apps/web/dist) │
       │   REST /api                    WebSocket /collab   │
       └──────────────┬──────────────────────┬──────────────┘
                      ▼                      ▼
              ┌────────────────────────────────────┐
              │       Node process (apps/server)    │
              │   Fastify :3000   Hocuspocus :1234  │
              └───────────────────┬────────────────┘
                                  ▼
                        ┌───────────────────┐
                        │ Postgres 18       │
                        │  note_documents   │ <- CRDT binary (source of truth)
                        │  notes/folders/…  │ <- relational mirror (queries/search/tree)
                        └───────────────────┘
```

### Repository layout

| Path | What it is |
| --- | --- |
| `packages/shared` | zod API contracts, CRDT document names and shapes, fractional indexing, unified error codes, constants |
| `packages/markdown` | A synchronous, DOM-free rendering pipeline (GFM / KaTeX / mermaid / wikilink / task lists) plus DOMPurify sanitisation and browser-side enhancement |
| `apps/server` | Fastify REST + Hocuspocus collaboration + Postgres projection mirroring + AI jobs |
| `apps/web` | React 19 + Vite + CodeMirror 6 + Tailwind, shared by browser, Electron and mobile |
| `apps/desktop` | Electron shell: main window, tray, global hotkeys, `safeStorage` credentials, the Apple Notes sync engine |
| `apps/mobile` | Capacitor shells: Android / iOS / HarmonyOS (ArkWeb) |
| `deploy/` | Production and dev Compose files, Caddyfile, `.env` templates, registry-mirror example |
| `scripts/` | `deploy.sh` / `aimd.sh` / `backup.sh` / `dev.sh` / `check-secrets.sh` |
| `docs/` | Design notes (Chinese and English) |

### CRDT data model

There are only two kinds of Y.Doc:

- **`note-{noteId}`** — `Y.Text body` (the Markdown), `Y.Map meta` (title, folder, pinned, archived,
  soft-deleted, ordering rank), `Y.Array tagIds`
- **`workspace-{userId}`** — `Y.Map folders`, `Y.Map tags`, `Y.Map settings`

**The Y.Doc is the single source of truth.** The same-named Postgres columns are projections of it,
refreshed by the Hocuspocus `store` hook inside the same transaction. Lists, search and the folder
tree all read the mirror, so a Y.Doc never has to be deserialised just to render something.

REST writes (move, pin, tag) do not bypass the CRDT: the server opens the real document through a
Hocuspocus **direct connection**, mutates it, and broadcasts to every connected client — exactly the
path a browser edit takes.

Clients also mount `y-indexeddb`, so editing continues offline and merges automatically on reconnect.

Two write rules are mandatory (details in [`AGENTS.md`](./AGENTS.md)):

- mutate a `Y.Array` with a **minimal diff** — a wholesale `delete + insert` destroys the CRDT
  identity of untouched items, and two devices adding two different tags would merge into duplicates;
- always `insert` quick-capture text at `body.length`, the one insertion point that merges safely
  with concurrent edits from other devices.

---

## Configuration

Everything is read from environment variables and validated once at boot with zod, so **a
misconfiguration fails immediately with a readable reason** instead of misbehaving at runtime.
`apps/server/src/config.ts` is the single source.

### Application (`apps/server`)

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | — | **Required.** Postgres connection string |
| `JWT_SECRET` | — | **Required, at least 32 characters**, no default. Must be unique per deployment |
| `NODE_ENV` | `development` | `development` / `test` / `production` |
| `HOST` | `0.0.0.0` | Listen address |
| `REST_PORT` | `3000` | REST port |
| `COLLAB_PORT` | `1234` | Hocuspocus WebSocket port |
| `CORS_ORIGIN` | `*` | Comma-separated origins, or `*`. Keep `*` when the SPA and API share an origin |
| `ALLOW_REGISTRATION` | `true` | Set to `false` once your accounts exist |
| `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` | empty | Create and flag an admin on first boot; password needs 8+ characters, blank skips it |
| `UPLOAD_DIR` | `./data/uploads` | Attachment directory (mounted at `/data/uploads` in the container) |
| `PUBLIC_URL` | empty | Public address, used to build absolute attachment links |
| `WEB_DIST_DIR` | empty | Point at `apps/web/dist` to have the server host the client; blank means API only |
| `COLLAB_PUBLIC_URL` | empty | WebSocket URL injected into `index.html` at request time. Leave blank when a reverse proxy maps `/collab` |
| `SEARCH_DRIVER` | `trgm` | Reserved; only `trgm` is implemented |
| `AUTH_RATE_LIMIT_MAX` | `10` | Requests/min/IP on credential endpoints |
| `API_RATE_LIMIT_MAX` | `600` | Requests/min/IP globally |
| `COLLAB_DEBOUNCE` | `2000` | CRDT store throttle in ms, minimum 200 |
| `COLLAB_MAX_DEBOUNCE` | `10000` | Maximum store delay in ms |
| `COLLAB_TIMEOUT` | `30000` | Document unload timeout in ms |
| `COLLAB_MAX_PAYLOAD_BYTES` | `10485760` | Maximum size of one collaboration message |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | Bounded wait for pending CRDT stores so SIGTERM cannot lose writes |
| `LOG_LEVEL` | `info` | `fatal` / `error` / `warn` / `info` / `debug` / `trace` / `silent` |
| `MIGRATIONS_DIR` | automatic | Migration SQL directory; normally left alone |
| `ACCESS_TOKEN_TTL_SECONDS` / `REFRESH_TOKEN_TTL_SECONDS` | `900` / `2592000` | Mostly used by tests |

### AI features

| Variable | Default | Notes |
| --- | --- | --- |
| `AI_CREDENTIALS_SECRET` | empty | Dedicated key (32+ characters) for encrypting stored provider keys. Blank derives one from `JWT_SECRET` — **rotating `JWT_SECRET` then invalidates saved AI keys** |
| `AI_ALLOW_PRIVATE_BASE_URL` | `false` | Allow HTTP / loopback / private addresses (local Ollama, tests). **Keep `false` in production** — this is the SSRF guard |
| `AI_REQUEST_TIMEOUT_MS` | `90000` | Per-request timeout |
| `AI_REQUEST_INTERVAL_MS` | `750` | Spacing between requests, to stay under provider rate limits |
| `AI_MAX_CHUNK_CHARS` | `16000` | Chunk size for long notes |
| `AI_MAX_CHUNKS` | `48` | Maximum chunk count; exceeding it raises an explicit error instead of truncating silently |

### Deployment (`deploy/.env`, Compose only)

| Variable | Default | Notes |
| --- | --- | --- |
| `PUBLIC_URL` | — | **Required**, with scheme. Domain mode `https://notes.example.com`; direct-IP mode `http://203.0.113.10:8080` |
| `CADDY_SITE_ADDR` | derived | Caddy site address. Only set it explicitly when `PUBLIC_URL` carries a non-80 port, and **without the port** |
| `ACME_EMAIL` | empty | Let's Encrypt expiry notices (domain mode only) |
| `HTTP_PORT` / `HTTPS_PORT` | `80` / `443` | Host-side ports |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `aimarkdown` / — / `aimarkdown` | `deploy.sh` generates the password with `openssl rand` |
| `APP_IMAGE` | empty | Point at a prebuilt image (e.g. `ghcr.io/you/aimarkdown:latest`) to skip building on the server; CI publishes to GHCR and `aimd.sh update` pulls the latest tag first |

Full annotated templates: [`deploy/.env.example`](./deploy/.env.example) and [`.env.example`](./.env.example).

---

## API overview

Every path is prefixed with `/api`, and every failure returns `{ code, message, details? }` with
`code` from `packages/shared/src/errors.ts`. All request/response zod schemas live in
`packages/shared/src/api.ts` — the server validates with them, the client infers types from them,
and there is exactly one contract.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/auth/register` `/auth/login` `/auth/refresh` `/auth/logout` | argon2id + JWT, refresh-token rotation |
| GET | `/me` `/settings` | Current user, preferences |
| GET | `/tree` | Folder tree + tags + counts (first-paint skeleton) |
| GET | `/notes?folderId=&rootOnly=&tagIds=&q=&archived=&sort=` | List / search / combined filters / cursor pagination |
| POST | `/notes` | Create (row and CRDT document written in one transaction) |
| PATCH | `/notes/:id` | Folder, pin, archive, tags, ordering |
| DELETE | `/notes/:id` | Soft delete into the trash; `?permanent=1` deletes for good |
| POST | `/notes/:id/restore` · `/notes/:id/capture` | Restore · append a quick capture |
| GET | `/notes/:id/export` · `/export/vault` | Single `.md` · whole-vault ZIP |
| POST | `/import` | Upload `.md` or ZIP and rebuild the folder hierarchy |
| POST | `/attachments` · GET `/attachments/:id` | Image upload and authenticated download |
| GET | `/ai/overview` | Masked AI config, backfill backlog, current job |
| PUT/DELETE | `/ai/config` · POST `/ai/config/test` | Save/clear AI config · test the connection |
| POST | `/notes/:id/ai/analyze` | Generate or re-run the AI summary for one note |
| POST | `/ai/backfill` · GET `/ai/jobs/:id` · POST `/ai/jobs/:id/cancel` | Backfill, job progress, cancel |
| GET | `/health` | Liveness probe (used by the deploy script and the container healthcheck) |
| WS | `/collab` | Hocuspocus channel; an access token is required at connect time |

Tokens travel two ways through one server implementation: the browser uses an httpOnly cookie
(unreachable from scripts), while Electron and mobile use `Authorization: Bearer` and keep the refresh
token in the OS keychain (`safeStorage` / Keychain / Android Keystore). A desktop client must send
`X-Token-Transport: bearer` before the server will return a refresh token in the response body.

---

## Security model

Details and the operator checklist are in [`SECURITY.md`](./SECURITY.md). Highlights:

- **Passwords**: `argon2id` via `@node-rs/argon2`; never stored or logged in plaintext.
- **Sessions**: 15-minute access token, 30-day rotating refresh token.
- **Browser**: refresh token in an `httpOnly` + `SameSite=Lax` cookie, `Secure` over HTTPS; scripts cannot read it.
- **Desktop / mobile**: refresh token in the OS keychain; the client must explicitly opt in with
  `X-Token-Transport: bearer` before the server puts it in a body.
- **Collaboration channel**: an access token is required at connect time; cross-tenant documents are rejected.
- **Authorization**: every query is narrowed by `owner_id`; cross-tenant attempts are covered by
  integration tests over both REST and the WebSocket.
- **Rate limiting**: 10 req/min/IP on credential endpoints, 600 req/min/IP globally.
- **AI keys**: AES-256-GCM at rest; the API only ever returns a mask.
- **AI `baseUrl`**: HTTPS and public addresses only by default, to block SSRF;
  `AI_ALLOW_PRIVATE_BASE_URL=true` is required for a private network.
- **Note HTML**: raw HTML is escaped (`html: false`) and rendered output passes DOMPurify.
- **Attachment SVG**: served under a restrictive CSP, so an uploaded SVG cannot script the origin.
- **Config**: `JWT_SECRET` has no default; boot fails fast when it is missing or under 32 characters.
- **Repository**: `scripts/check-secrets.sh` scans for credentials in CI and from a pre-commit hook
  (including a full-history scan). See below.

### Contributor notes

```bash
make hooks          # install the pre-commit secret scanner
make secrets        # scan git-tracked files
make preopen-check  # full self-check before pushing anywhere public (untracked files + skip-worktree list)
```

IDEs write **machine-local signing material** into two files: HarmonyOS `keyPassword` /
`storePassword` / `~/.ohos` paths, and the Xcode `DEVELOPMENT_TEAM` id. Their real content must not
reach the repository, so mark them developer-local — your local builds keep working:

```bash
git update-index --skip-worktree apps/mobile/harmony/build-profile.json5
git update-index --skip-worktree apps/mobile/ios/App/App.xcodeproj/project.pbxproj
# to commit a real change: git update-index --no-skip-worktree <path>, after scrubbing the signing block
```

---

## AI summaries and auto-tags

In Settings → "AI assistant", enter the `Base URL`, model and API key of any **OpenAI-compatible**
service. Two presets ship in the box: Alibaba Cloud Token Plan
(`https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`, default model `qwen3.7-plus`)
and "Custom OpenAI-compatible" (OpenAI, Azure OpenAI, DeepSeek, Moonshot, a local Ollama — anything
that speaks the protocol).

How it behaves:

- A new note is summarised once, the first time it has body content: summary, key points, todos and
  tags. Later edits only mark the summary stale; nothing is re-sent until you press "Regenerate".
- Notes that already have tags never have them deleted or overwritten. Only a note with zero tags
  gets up to 3 suggested, reusing existing tags where possible.
- "Backfill unprocessed notes" in Settings covers every non-deleted note with a non-empty body that
  is missing tags or a summary. Jobs run serially on the server, with visible progress and cancellation.
- Long notes are split by paragraph and summarised hierarchically; the default cap is 48 chunks, and
  exceeding it raises an explicit error rather than truncating silently.
- API keys are encrypted with AES-256-GCM in Postgres and only ever returned masked. Without
  `AI_CREDENTIALS_SECRET` the key is derived from `JWT_SECRET`, so rotating `JWT_SECRET` requires
  re-entering the AI key.
- Custom base URLs must be public HTTPS by default, to prevent SSRF. A local Ollama needs
  `AI_ALLOW_PRIVATE_BASE_URL=true`.
- **Some providers restrict custom backends or bulk calls on consumer plans.** Check your plan terms
  first; the backfill button asks for a second confirmation and warns about quota.


---

## Favourites

The sidebar exposes a dedicated **Favourites** section. The desktop app also adds a tray action and a configurable global shortcut (default `CommandOrControl+Shift+F`) that brings up the main window and opens the paste box immediately. A favourite is still a normal note, so the editor, search, trash, export and Yjs sync all keep working; it additionally stores the source URL, platform, author, cover and media-processing state.

- Click the bookmark-plus button next to **Favourites**, paste a URL and press Enter. On mobile, a persistent **Favourites** button sits in the note-list header, and the system share sheet can send links or media directly. The server extracts WeChat articles and ordinary pages automatically. If Xiaohongshu/Douyin anti-bot pages or any other site cannot be parsed, the URL itself is still saved without asking for a form.
- Article images are downloaded as authenticated attachments. Images can be OCR'd by a vision model; videos are converted to audio with ffmpeg and transcribed through an OpenAI-compatible `audio/transcriptions` endpoint. Media models are optional in **Settings → AI**; favourites still save when they are absent.
- The Favourites section creates the preset categories (学习, AI, 大模型, 旅游, 购物, 生活, 职场, 健康, 其他) up front. Each new favourite immediately gets a default category, chosen from a matching platform folder or keywords in the title/body and falling back to 其他, so it never starts in 待分类; AI can still refine the choice. A non-preset category is only created after confirmation.
- Every real folder can open **Ask AI** with Q&A, search and trip modes. Answers cite saved notes; trip planning enables the model's native web search by default, while other modes expose it as an optional toggle.
- Mobile sharing uses Android `ACTION_SEND`, an iOS Share Extension (App Group + `aimarkdown://share`) and HarmonyOS `sendData`. Each mobile platform also ships a **Favourite link** home-screen card — Android AppWidget, iOS WidgetKit and HarmonyOS FormExtensionAbility — that opens the capture box directly. iOS device builds require a signing team for both the share extension and the widget.

The server needs `ffmpeg`/`ffprobe` (installed in the Docker image; use `brew install ffmpeg` for local development). Saving the same URL updates the existing favourite by default.

---

## Desktop

### Global-hotkey quick capture

- "Show main window" defaults to **`⌘⇧M` / `Ctrl+Shift+M`**; "show capture window" defaults to
  **`⌥Space` on macOS** and **`Ctrl+Alt+Space` on Windows**
- Re-record either one in Settings → Desktop by clicking the field and pressing the new combination;
  the setting lives in the workspace CRDT, so it is consistent across devices
- The two hotkeys register independently; if one fails (Raycast / Alfred already own it) both the tray
  menu and the settings page warn you — it never fails silently
- The capture window is frameless, always on top and visible across Spaces; `Esc` or losing focus
  hides it (hide, not destroy, so it stays warm)
- `⌘/Ctrl + Enter` submits, and the text is appended to the end of the inbox through the CRDT — even
  if another device is editing the middle of that note at the same moment, neither side loses anything
- The "Captures" view in the main window splits inbox entries apart by timestamp; clicking one jumps
  to its position

### Two-way macOS Notes sync

The macOS title bar has a "Notes" button, and Settings has "macOS Notes sync (this Mac only)":

- Mirrors the default Apple Notes account against the current AiMD user **in both directions, whole
  library**: folders both ways, note create/edit/delete both ways; includes the inbox and archive,
  excludes the trash (deletions land in the app trash and in an Apple folder named
  `AiMD 回收站 (App)`, and are recoverable)
- The first run must scan and preview before anything is written; afterwards you can sync manually,
  at launch, and on a timer (30 minutes by default)
- Body and folder conflicts resolve to the most recently modified version; the losing version is
  copied into the app and tagged `Apple 同步冲突`
- Images, PDFs and plain files sync both ways where possible; drawings, scans, audio, encrypted or
  shared items that Apple Notes cannot export make the note read-only, tagged `Apple 同步只读`
- The sync engine runs in the Electron main process and the mapping lives in
  `userData/apple-notes-sync.json` on that machine. **Enable it on only one Mac per account**; disable
  it on the old machine before switching
- After changing servers or accounts the old mapping is not reused: pressing "Sync now" opens a
  read-only preview, and confirming rebuilds the mapping for the current account while keeping the old
  one as a timestamped backup file
- After a first sync or an unsigned rebuild, macOS only shows the "control Notes" permission prompt
  once you press "Request access" or "Preview changes" in Settings; until then AiMD does not appear
  under System Settings → Privacy & Security → Automation, where a denied or reset grant can be
  re-approved
- Scheduled sync requires AiMD to stay running; closing the window to the tray is enough. Note
  ordering, pinning, tags and Apple smart folders are not synced
- **Deletion is refused when the scan is incomplete**; if Apple returns zero items while the local
  mapping is non-empty, the run aborts — a safety valve so one permission or network failure cannot
  empty the library

---

## Known limitations

Deliberate v1 trade-offs, not oversights:

- **No time-travel version history.** The CRDT choice means Yjs gives no point-in-time rollback out of
  the box. The **trash** (soft delete / restore / delete permanently) covers the common case; periodic
  Y.Doc snapshots would be the incremental path to real history.
- **Chinese search uses `pg_trgm`**, i.e. substring matching, not word segmentation. Postgres' native
  full-text search does not segment Chinese, and `zhparser` / `pg_bigm` need a custom image.
  `SEARCH_DRIVER` is the reserved upgrade slot. **Queries need at least 2 characters** — a product
  constraint, not a bug.
- **Single-instance deployment.** No Redis, so the app container cannot scale out. Hocuspocus supports
  Redis pub/sub; add it when you need multiple instances.
- **Attachments live in a local Docker volume**, no S3/MinIO. Storage sits behind an
  `AttachmentStorage` interface, so swapping the implementation is contained.
- **No CSP.** The client injects runtime styles and the preview renders KaTeX/MathML, so a half-hearted
  CSP would only cause breakage. The XSS boundary for note content is DOMPurify (and the pipeline
  escapes all raw HTML with `html: false`). Tightening CSP is a follow-up hardening item.
- **Registration sends no verification email**, to avoid an SMTP dependency.
- **Offline covers "pages already open"**: you can keep editing without a network, changes go to
  IndexedDB and merge on reconnect. But **refreshing while offline will not boot** — v1 has no service
  worker, so the app shell itself is unreachable. Offline cold start needs a PWA cache.
- **Desktop and mobile artifacts are unsigned** (no Apple Developer ID, no Windows certificate), so
  first launch needs a manual override.

---

## China network notes

The deploy script assumes Docker Hub may be unreachable. Measured on 2026-10-30:

| Registry mirror | Status |
| --- | --- |
| `registry-1.docker.io` / `index.docker.io` | times out, unreachable |
| `docker.m.daocloud.io` | reachable (`/v2/` returning 401 is normal) |
| `dockerproxy.net` | reachable (200) |
| `hub-mirror.c.163.com` | dead |

If image pulls fail, merge the `registry-mirrors` from `deploy/daemon.json.mirror` into
`/etc/docker/daemon.json`, restart Docker and re-run the deployment. **Check the existing config
first** — many machines already have a mirror configured.

Or build locally and transfer offline:

```bash
docker build -t aimarkdown-app:local .
docker save aimarkdown-app:local | gzip > app.tar.gz
# on the server:
gunzip -c app.tar.gz | docker load
# then set APP_IMAGE=aimarkdown-app:local in deploy/.env and run ./scripts/deploy.sh --no-build
```

The same applies to npm dependencies via a mirror in `.npmrc`.

---

## Design notes

Where the implementation diverged from the plan, and what each divergence actually cost, is recorded
separately:

- [`docs/design-notes.en.md`](./docs/design-notes.en.md) (English)
- [`docs/design-notes.zh.md`](./docs/design-notes.zh.md) (中文)
- [`AGENTS.md`](./AGENTS.md) — architectural invariants, per-package module systems and the full
  pitfall list (Chinese)

## Contributing

Issues and PRs are welcome. Development setup, verification commands, where tests live and the two
architectural invariants that must not be broken are all in [`CONTRIBUTING.md`](./CONTRIBUTING.md).
Report security problems privately per [`SECURITY.md`](./SECURITY.md) — do not open a public issue.

```bash
make hooks           # install the pre-commit secret scanner
make typecheck && make lint && make test-unit
```

## License

[MIT](./LICENSE) © 2026 AiMD contributors. Third-party licenses are summarised at the end of
`LICENSE` and listed authoritatively in `pnpm-lock.yaml`; this project ships no GPL / AGPL / LGPL
component.
