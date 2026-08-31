# WattRoom — common tasks. Dev loop: `make infra` once, then `make dev-server`
# and `make dev-web` in two terminals (Vite proxies /api and /ws to :8080).

.PHONY: infra dev-server dev-web web changelog protocol sqlc seed build test lint check ci release

infra: ## start Postgres + LiveKit containers
	docker compose up -d

dev-server: ## run Go server with hot reload (installs air on first use)
	cd server && WATTROOM_DB="postgres://wattroom:wattroom@localhost:5432/wattroom" WATTROOM_DEV_LOGIN=1 WATTROOM_LIVEKIT_URL="ws://localhost:7880" WATTROOM_LIVEKIT_KEY="devkey" WATTROOM_LIVEKIT_SECRET="secret" go run github.com/air-verse/air@latest

dev-web: changelog ## run Vite dev server
	cd web && pnpm dev

changelog: ## stage CHANGELOG.md as a static asset (#345)
	@# The SPA serves it at /changelog.md, so what a rider reads is the file
	@# the running build shipped with. Gitignored — it is a build artifact.
	cp CHANGELOG.md web/static/changelog.md

web: changelog ## build frontend and embed it into the server
	cd web && pnpm install --frozen-lockfile && pnpm build
	rm -rf server/webdist/* && cp -R web/build/* server/webdist/

protocol: ## regenerate web/src/lib/protocol.ts from Go structs
	cd server && go tool tygo generate

sqlc: ## regenerate internal/store/db from queries + migrations (commit the result)
	cd server && go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.30.0 generate

seed: ## seed the compose dev database (idempotent)
	cd server && go run ./cmd/seed

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
	cd server && GOLANGCI_LINT_CACHE=$(CURDIR)/server/tmp/golangci go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.12.2 run
	cd web && pnpm run check
	cd web && pnpm run format:check

ci: test lint ## what CI runs

release: ## cut a release: promote the changelog, tag, push (version is CalVer, computed)
	@scripts/release.sh
