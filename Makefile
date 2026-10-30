# aiMarkdown — common tasks. Run `make help` for the list.

COMPOSE_DEV := docker compose -f deploy/docker-compose.dev.yml
COMPOSE_PROD := docker compose -f deploy/docker-compose.yml --env-file deploy/.env

.DEFAULT_GOAL := help
.PHONY: help install build typecheck test test-unit test-integration test-e2e lint \
        dev db-up db-down db-logs migrate deploy deploy-rebuild backup logs ps down clean \
        mobile-build mobile-apk mobile-ipa mobile-hap mobile-sync

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

install: ## Install workspace dependencies
	pnpm install

build: ## Build shared packages, server and web bundle
	pnpm -r --filter=./packages/** build
	pnpm --filter @aimarkdown/server build
	pnpm --filter @aimarkdown/web build

typecheck: ## Type-check every workspace package
	pnpm -r typecheck

test: test-unit ## Run unit tests (no database required)

test-unit: ## Unit tests for shared, markdown and server
	pnpm --filter @aimarkdown/shared test
	pnpm --filter @aimarkdown/markdown test
	pnpm --filter @aimarkdown/server test:unit
	pnpm --filter @aimarkdown/web test

test-integration: db-up-test ## Integration tests against a real Postgres + Hocuspocus
	pnpm --filter @aimarkdown/server test:integration

test-e2e: ## Playwright end-to-end tests (starts its own stack)
	pnpm --filter @aimarkdown/web test:e2e

lint: ## Lint and format check
	pnpm lint

dev: ## Postgres + API + Vite (desktop: pnpm --filter @aimarkdown/desktop dev)
	bash scripts/dev.sh

db-up: ## Start the development database on :5433
	$(COMPOSE_DEV) up -d postgres

db-up-test: ## Start the throwaway test database on :5434
	$(COMPOSE_DEV) up -d postgres_test
	@for i in $$(seq 1 30); do \
		docker exec aimarkdown-test-postgres pg_isready -U aimarkdown >/dev/null 2>&1 && exit 0; \
		sleep 1; \
	done; echo "test postgres not ready" >&2; exit 1

db-down: ## Stop the development databases
	$(COMPOSE_DEV) down

db-logs: ## Tail development database logs
	$(COMPOSE_DEV) logs -f postgres

migrate: ## Apply database migrations manually (boot also migrates)
	pnpm --filter @aimarkdown/server migrate

deploy: ## One-command production deployment (see scripts/deploy.sh)
	bash scripts/deploy.sh

deploy-rebuild: ## Redeploy, rebuilding images
	bash scripts/deploy.sh --rebuild

backup: ## Back up the production database and attachments
	bash scripts/backup.sh

logs: ## Tail production application logs
	$(COMPOSE_PROD) logs -f app

ps: ## Show production container status
	$(COMPOSE_PROD) ps

down: ## Stop the production stack (volumes are kept)
	$(COMPOSE_PROD) down

mobile-build: ## Stage the web renderer into the mobile shells (www + harmony rawfile)
	pnpm --filter @aimarkdown/mobile build:renderer
	pnpm --filter @aimarkdown/mobile sync:harmony

mobile-apk: ## Build the Android debug APK (needs Android SDK + JDK 17)
	pnpm --filter @aimarkdown/mobile build:apk

mobile-ipa: ## Build the iOS simulator app, unsigned (needs Xcode)
	pnpm --filter @aimarkdown/mobile build:ipa

mobile-hap: ## Build the HarmonyOS HAP (needs DevEco Studio)
	pnpm --filter @aimarkdown/mobile build:hap

mobile-sync: ## Re-sync native projects after editing capacitor.config.ts
	pnpm --filter @aimarkdown/mobile sync

clean: ## Remove build outputs and installed dependencies
	rm -rf apps/*/dist apps/web/dist apps/desktop/renderer packages/*/dist
	rm -rf node_modules apps/*/node_modules packages/*/node_modules
