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
RUN pnpm --filter @aimarkdown/web build

COPY apps/server ./apps/server
RUN pnpm --filter @aimarkdown/server build

# ---------- 3. drop devDependencies (vite, electron, playwright, test tooling) ----------
FROM build AS proddeps
WORKDIR /repo
# Best effort: if prune cannot run in this workspace layout, the image is simply larger.
RUN pnpm prune --prod || echo "pnpm prune unavailable; keeping the full dependency tree"

# ---------- 4. runtime ----------
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production

# curl backs the container healthcheck.
RUN apk add --no-cache curl ffmpeg

# Dependency trees at their original relative paths, so pnpm's symlinks still resolve.
COPY --from=proddeps /repo/node_modules ./node_modules
COPY --from=proddeps /repo/apps/server/node_modules ./apps/server/node_modules
# Includes packages/*/node_modules and the built dist/ for shared + markdown.
COPY --from=proddeps /repo/packages ./packages
COPY --from=proddeps /repo/apps/server/dist ./apps/server/dist
COPY --from=proddeps /repo/apps/server/migrations ./apps/server/migrations
COPY --from=proddeps /repo/apps/server/package.json ./apps/server/package.json
COPY --from=proddeps /repo/apps/web/dist ./apps/web/dist
COPY --from=proddeps /repo/package.json ./package.json

# Attachments live on a named volume; the directory must exist and be writable by `node`.
RUN mkdir -p /data/uploads && chown -R node:node /data /app
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
