# WattRoom — common tasks. Dev loop: `make infra` once, then `make dev-server`
# and `make dev-web` in two terminals (Vite proxies /api and /ws to :8080).

.PHONY: infra dev-server dev-web web protocol sqlc seed build test lint check ci

infra: ## start Postgres + LiveKit containers
	docker compose up -d

dev-server: ## run Go server with hot reload (installs air on first use)
	cd server && go run github.com/air-verse/air@latest

dev-web: ## run Vite dev server
	cd web && pnpm dev

web: ## build frontend and embed it into the server
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
	cd server && go test -race ./...

lint:
	cd server && go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.12.2 run
	cd web && pnpm run check

ci: test lint ## what CI runs
