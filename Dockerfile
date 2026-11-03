# AiMD application image: REST API + CRDT collaboration server + built web client.
#
# Multi-stage so the runtime image carries no toolchain. The only native module is
# @node-rs/argon2, which ships prebuilt NAPI binaries for linux-x64-musl and linux-arm64-musl, so
# an Alpine runtime needs no compiler.
#
# The runtime stage must copy pnpm's symlinked node_modules trees *at the same relative paths*
# (`/app/node_modules`, `/app/apps/server/node_modules`, ...). pnpm links each workspace package's
# dependencies into its own node_modules with relative symlinks into the root `.pnpm` store, so
# reproducing the directory layout is what makes them resolve — copying only the root tree gives
# `ERR_MODULE_NOT_FOUND` at runtime.

ARG NODE_VERSION=24-alpine

# ---------- 1. install dependencies (cached independently of source changes) ----------
FROM node:${NODE_VERSION} AS deps
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/desktop/package.json apps/desktop/
COPY packages/shared/package.json packages/shared/
COPY packages/markdown/package.json packages/markdown/
# Headless: the desktop package would otherwise pull the ~100MB Electron binary into a server image.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN pnpm install --frozen-lockfile

# ---------- 2. build shared packages, web bundle and server ----------
FROM deps AS build
WORKDIR /repo
# Keep these layers ordered from least to most frequently changed. Docker invalidates every
# layer after a COPY, so putting apps/server *after* the web build means a server-only deploy
# reuses the expensive Vite/mermaid/shiki build instead of rebuilding it from scratch.
COPY packages ./packages
RUN pnpm --filter @aimarkdown/shared build \
 && pnpm --filter @aimarkdown/markdown build

COPY apps/web ./apps/web
# CI already runs `pnpm -r typecheck` before publishing; skip the duplicate tsc pass here so a
# source build on a small VPS spends its CPU on Rolldown/Vite instead. `vite build` still fails
# on unresolved imports and other bundling errors.
RUN pnpm --filter @aimarkdown/web exec vite build

COPY apps/server ./apps/server
RUN pnpm --filter @aimarkdown/server build

# ---------- 3. production-only dependency tree ----------
# Do not prune the build stage: `pnpm prune --prod` does not reliably remove devDependencies from
# a workspace and used to leave Electron/Playwright/Vite in the image (~700 MB of node_modules).
# A fresh prod-only install for just the server + the packages it imports is both smaller and
# easier to reason about. The `apps/*` and `packages/*` globs only see the package.json files
# copied here, so web/desktop build dependencies are not installed at all.
FROM node:${NODE_VERSION} AS proddeps
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
COPY packages/markdown/package.json packages/markdown/
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN pnpm install --prod --frozen-lockfile

# ---------- 4. runtime ----------
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production

# curl backs the container healthcheck.
RUN apk add --no-cache curl ffmpeg

# Dependency trees at their original relative paths, so pnpm's symlinks still resolve.
COPY --from=proddeps /repo/node_modules ./node_modules
COPY --from=proddeps /repo/apps/server/node_modules ./apps/server/node_modules
# Production dependency links + package.json files for shared/markdown; dist comes from `build`.
COPY --from=proddeps /repo/packages ./packages
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build /repo/packages/markdown/dist ./packages/markdown/dist
COPY --from=build /repo/apps/server/dist ./apps/server/dist
COPY --from=build /repo/apps/server/migrations ./apps/server/migrations
COPY --from=build /repo/apps/server/package.json ./apps/server/package.json
COPY --from=build /repo/apps/web/dist ./apps/web/dist
COPY --from=build /repo/package.json ./package.json

# Attachments live on a named volume; the directory must exist and be writable by `node`.
# Do not `chown -R /app`: that copies every root-owned file into a new layer (hundreds of MB);
# the runtime only needs read access to the code.
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node

ENV UPLOAD_DIR=/data/uploads \
    WEB_DIST_DIR=/app/apps/web/dist \
    MIGRATIONS_DIR=/app/apps/server/migrations \
    HOST=0.0.0.0 \
    REST_PORT=3000 \
    COLLAB_PORT=1234

EXPOSE 3000 1234

# Migrations run at boot (idempotent), so `docker compose up` needs no manual step.
WORKDIR /app/apps/server
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "dist/index.js"]
