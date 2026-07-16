# CLAUDE.md

WattRoom: collaborative indoor cycling ("Discord for indoor cycling"). Go server + SvelteKit SPA + Postgres + LiveKit, monorepo.

## Read before changing things

- [WATTROOM.md](WATTROOM.md) — every product/architecture decision, **locked**. Don't re-decide (stack, privacy rules, YouTube RMF constraints, license). New decisions → ADR in `docs/decisions/`.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the three seams: client owns trainer, server owns live state in memory, Postgres owns durable data only.
- [docs/SPEC.md](docs/SPEC.md) — glossary, roles matrix, workout JSON, stats formulas, game-mode parameters. **Never invent product numbers** (tolerances, XP, thresholds) — they're specced there; "(default — tune in alpha)" values may change without an ADR, everything else needs one.

## Commands

- `make infra` — Postgres + LiveKit containers (needed for anything DB/AV)
- `make dev-server` / `make dev-web` — hot-reload dev loop (Vite proxies /api + /ws → :8080)
- `make test` — `go test -race ./...` (must pass, race detector always on)
- `make lint` — go vet + svelte-check
- `make protocol` — regenerate `web/src/lib/protocol.ts` after editing `server/internal/protocol/` (commit both)
- `make build` — single binary with embedded SPA

## Hard rules

- `web/src/lib/protocol.ts` is **generated** — edit the Go structs, never the TS.
- Go: stdlib-first, no frameworks/ORM, `log/slog`, table tests. Web: Svelte 5 runes, Tailwind v4 utilities, no component library.
- Privacy is architecture: metrics room-scoped, AV never recorded, rides private by default. Never loosen.
- Never copy code from Auuki (AGPL reference-reading only).
- The watt-yellow accent (`--color-watt`) marks live data only, never UI chrome.
- Conventional commits; PRs squash-merge.
