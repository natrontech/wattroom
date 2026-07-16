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

## GitHub workflow (use the gh CLI)

All work is tracked as GitHub issues on milestones **M0–M6**; TODO.md is only ordering notes. Find work with `gh issue list --milestone "M0 — Foundations"` (or `--label good-first-issue`); read context with `gh issue view <n> --comments` before starting — decisions sometimes land in comments.

- Labels: `ble`, `rooms`, `workouts`, `game-modes`, `infra`, `docs`, `backlog` (parked — don't pick up without asking). Don't invent new labels or milestones; propose instead.
- Starting an issue: `gh issue comment <n> -b "picking this up — <one-line approach>"` so work isn't duplicated.
- PRs: `gh pr create` with a conventional-commit title (it becomes the squash commit) and `Closes #<n>` in the body. Check CI with `gh pr checks`; find review feedback with `gh pr view --comments` and `gh api repos/natrontech/wattroom/pulls/<n>/comments` (inline comments).
- Discovering out-of-scope work mid-task: `gh issue create` with the right milestone + label, don't scope-creep the current PR.
- New product/architecture decisions in an issue/PR discussion still get an ADR in `docs/decisions/` — GitHub threads are not the decision record.

## Hard rules

- `web/src/lib/protocol.ts` is **generated** — edit the Go structs, never the TS.
- Go: stdlib-first, no frameworks/ORM, `log/slog`, table tests. Web: Svelte 5 runes, Tailwind v4 utilities, no component library.
- Privacy is architecture: metrics room-scoped, AV never recorded, rides private by default. Never loosen.
- Never copy code from Auuki (AGPL reference-reading only).
- The watt-yellow accent (`--color-watt`) marks live data only, never UI chrome.
- Conventional commits; PRs squash-merge.
