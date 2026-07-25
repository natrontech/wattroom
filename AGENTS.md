# AGENTS.md

WattRoom: collaborative indoor cycling ("Discord for indoor cycling"). Go server + SvelteKit SPA + Postgres + LiveKit, monorepo. These instructions apply to **every** coding agent (Codex, Claude, or other) and human contributor.

## Read before changing things

- [WATTROOM.md](WATTROOM.md) — every product/architecture decision, **locked**. Don't re-decide (stack, privacy rules, YouTube RMF constraints, license). New decisions → ADR in `docs/decisions/`.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the three seams: client owns trainer, server owns live state in memory, Postgres owns durable data only.
- [docs/SPEC.md](docs/SPEC.md) — glossary, roles matrix, workout JSON, stats formulas, game-mode parameters. **Never invent product numbers** — they're specced there.
- The rule files in `.claude/rules/` are **vendor-neutral canon despite the directory name** — read `git.md` before your first commit, `errors.md` before API/frontend work, `code-quality.md` and `ux.md` before any feature work.

## Commands

- `make infra` — Postgres + LiveKit containers (needed for anything DB/AV)
- `make dev-server` / `make dev-web` — hot-reload dev loop (Vite proxies /api + /ws → :8080)
- `make test` — Go race-detected tests + web vitest (must pass)
- `make lint` — golangci-lint + svelte-check + prettier check
- `make protocol` — regenerate `web/src/lib/protocol.ts` after editing `server/internal/protocol/` (commit both)
- `make build` — single binary with embedded SPA

## Working on the issue board (mandatory for humans AND agents)

All work is tracked as GitHub issues on milestones M0–M6; nobody works untracked.

1. **Before starting**: check the issue is unassigned and unclaimed (`gh issue view <n> --comments`). If someone (or someone's agent) is on it, coordinate in comments instead of duplicating.
2. **Claim it**: assign yourself (`gh issue edit <n> --add-assignee @me`) AND comment a one-line approach.
3. **Branch + PR for all feature work**: branch `feat/<slug>` or `fix/<slug>`, open a **draft PR early** with `Closes #<n>` — the draft is how others see what's in flight. Conventional-commit PR title (it becomes the squash commit). Only trivial doc fixes and ADR text may go direct to main. Note: `main` has **no platform-level protection** (private repo, free plan) — the PR rule is convention; follow it anyway, nothing will stop a bad push except you.
4. **Progress lives in the issue/PR**, not in chat apps: blockers, decisions, findings → comments. A decision made in a thread still gets an ADR.
5. **Done** = CI green, self-review of the diff, PR marked ready. Out-of-scope discoveries become new issues (right milestone + label), never PR scope-creep.

Labels: `ble` `rooms` `workouts` `game-modes` `infra` `docs` `backlog` (parked — ask first). Commit style: conventional commits, scopes `server` `web` `ble` `hub` `protocol` `game` `jukebox` `ci` `deps` (full rules in `.claude/rules/git.md`).

## Hard rules

- `web/src/lib/protocol.ts` is **generated** — edit the Go structs, never the TS.
- Go: stdlib-first, no frameworks/ORM, `log/slog`, table tests. Web: Svelte 5 runes, Tailwind v4 utilities, no component library.
- Privacy is architecture: metrics room-scoped, AV never recorded, rides private by default. Never loosen.
- Never copy code from Auuki (AGPL reference-reading only).
- The watt-yellow accent (`--color-watt`) marks live data only, never UI chrome.
