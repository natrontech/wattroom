# WattRoom — common tasks. Dev loop: `make infra` once, then `make dev-server`
# and `make dev-web` in two terminals (Vite proxies /api and /ws to the server).
#
# Ports and database are per-checkout, so parallel agents in parallel worktrees
# do not fight over :8080 or write each other's rooms (#552). The main working
# tree keeps :8080/:5174 and the `wattroom` database; every linked worktree
# derives its own from its path. `make dev-env` prints what this one takes.

.PHONY: infra dev-env dev-server dev-web dev-db-drop web changelog protocol sqlc seed build test lint check ci release

DEV_ENV := scripts/dev-env.sh

# The Go version CI lints with (go-version-file: server/go.mod); see lint.
GO_VERSION := $(shell sed -n 's/^go //p' server/go.mod)

infra: ## start Postgres + LiveKit containers
	docker compose up -d

dev-env: ## print this checkout's dev ports and database
	@$(DEV_ENV) banner dev

dev-server: ## run Go server with hot reload (installs air on first use)
	@# LiveKit stays one shared instance: two worktrees in voice land in the
	@# same SFU. Only ports and Postgres are per-checkout.
	@$(DEV_ENV) ensure-db
	@$(DEV_ENV) banner server
	@eval "$$($(DEV_ENV) print)"; cd server && WATTROOM_ADDR=":$$WATTROOM_DEV_SERVER_PORT" WATTROOM_BASE_URL="http://localhost:$$WATTROOM_DEV_SERVER_PORT" WATTROOM_DB="$$WATTROOM_DEV_DSN" WATTROOM_DEV_LOGIN=1 WATTROOM_LIVEKIT_URL="ws://localhost:7880" WATTROOM_LIVEKIT_KEY="devkey" WATTROOM_LIVEKIT_SECRET="secret" go run github.com/air-verse/air@latest

dev-web: changelog ## run Vite dev server
	@$(DEV_ENV) banner web
	@eval "$$($(DEV_ENV) print)"; cd web && PORT="$$WATTROOM_DEV_WEB_PORT" WATTROOM_API="http://localhost:$$WATTROOM_DEV_SERVER_PORT" pnpm dev

dev-db-drop: ## drop this worktree's database (nothing removes it on `git worktree remove`)
	@$(DEV_ENV) drop-db

changelog: ## stage CHANGELOG.md as a static asset (#345)
	@# The SPA serves it at /changelog.md, so what a rider reads is the file
	@# the running build shipped with. Gitignored — it is a build artifact.
	@# Silent: `make dev-web` depends on it, and the port/database banner has
	@# to be the first line an agent sees (#552).
	@cp CHANGELOG.md web/static/changelog.md

web: changelog ## build frontend and embed it into the server
	cd web && pnpm install --frozen-lockfile && pnpm build
	rm -rf server/webdist/* && cp -R web/build/* server/webdist/

protocol: ## regenerate web/src/lib/protocol.ts from Go structs
	cd server && go tool tygo generate

sqlc: ## regenerate internal/store/db from queries + migrations (commit the result)
	cd server && go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.30.0 generate

seed: ## seed this checkout's dev database (idempotent)
	@$(DEV_ENV) ensure-db
	@eval "$$($(DEV_ENV) print)"; cd server && WATTROOM_DB="$$WATTROOM_DEV_DSN" go run ./cmd/seed

build: web ## single binary with embedded frontend
	cd server && go build -o ../bin/wattroom-server .

test:
	@# Tests get their own database — a suite that deletes users must never
	@# point at the dev data (it did once; the seed world paid for it).
	@docker exec wattroom-postgres-1 psql -U wattroom -tc "select 1 from pg_database where datname='wattroom_test'" 2>/dev/null | grep -q 1 || docker exec wattroom-postgres-1 createdb -U wattroom wattroom_test 2>/dev/null || true
	cd server && go test -race ./...
	cd web && pnpm run test

lint:
	@# Per-checkout lint cache. Agents run `make lint` from worktrees under
	@# .claude/worktrees/, and a shared ~/.cache/golangci-lint served their
	@# cached results back here — reporting a finding against a file path in
	@# somebody else's tree, which no exclusion could correctly silence.
	@# golangci-lint's vendored staticcheck must match the Go it analyses — a newer
	@# local Go panics in buildir. go.mod's go line is only a minimum under GOTOOLCHAIN=auto
	@# (a toolchain line equal to it is not even allowed), so this env var alone makes
	@# `make lint` run the exact Go CI lints with (#334).
	cd server && GOTOOLCHAIN=go$(GO_VERSION) GOLANGCI_LINT_CACHE=$(CURDIR)/server/tmp/golangci go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.12.2 run
	cd web && pnpm run check
	cd web && pnpm run format:check

ci: test lint ## what CI runs

release: ## cut a release: promote the changelog, tag, push (version is CalVer, computed)
	@scripts/release.sh
