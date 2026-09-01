# Contributing to WattRoom

Welcome — this project is built to be contributed to. Read this once and you should be productive without asking anyone anything.

## Orientation (read in this order)

1. [WATTROOM.md](WATTROOM.md) — the founding document: vision, every locked decision, milestones. **Decisions in it are settled**; re-litigating them needs an ADR, not a PR comment.
2. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the pieces fit and why the seams are where they are.
3. [docs/SPEC.md](docs/SPEC.md) — the concrete product numbers: glossary, roles, workout JSON, stats formulas, game-mode parameters. Implement from here, don't invent values.
4. [The issue board](https://github.com/natrontech/wattroom/issues) — the live work list, grouped by milestone. Every item is an issue; `good-first-issue` marks the ones scoped for a first contribution.

## Dev setup

Requirements: Go 1.26+, Node 22+, pnpm, Docker.

```sh
git clone https://github.com/natrontech/wattroom && cd wattroom
make infra        # Postgres + LiveKit dev containers
make dev-server   # terminal 1: Go with hot reload (air) on :8080
make dev-web      # terminal 2: Vite on :5173, proxying /api and /ws to :8080
```

Open http://localhost:5173. No smart trainer required — use the simulated trainer (dev flag; lands in M0). If you own an FTMS trainer, real-hardware testing is gold: note your trainer model in PRs that touch the BLE layer.

On Windows/WSL, `make infra` can fail with `Ports are not available … bind: An attempt was made to access a socket in a way forbidden by its access permissions` for a UDP port. That is Windows reserving port ranges for Hyper-V/WSL at boot, and the reservation landing on LiveKit's media range — it varies per machine and per reboot, so it looks like a flaky Docker problem when it is a port one. `netsh int ipv4 show excludedportrange protocol=udp` lists the reserved ranges; if 51000–51050 is among them on your machine, shift the range in docker-compose.yml's three places (`port_range_start`, `port_range_end`, and the `ports:` mapping) to one that is free.

## Repo layout

```
server/                 Go: API, room hub, embedded SPA  (stdlib-first, no framework)
  internal/hub/         goroutine-per-room live state
  internal/protocol/    WS message types — SOURCE OF TRUTH for the protocol
web/                    SvelteKit SPA (Svelte 5 runes, Tailwind v4, adapter-static)
  src/lib/protocol.ts   GENERATED from Go — never edit by hand (make protocol)
docs/                   ARCHITECTURE, RESEARCH, decisions/ (ADRs)
```

## Rules of the road

- **Protocol changes**: edit the Go structs in `server/internal/protocol/`, run `make protocol`, commit both files together.
- **Go style**: stdlib-first. No frameworks, no ORM. Raw SQL via sqlc, `log/slog` for logging, table tests, `go test -race` must pass.
- **Web style**: Svelte 5 runes, TypeScript, Tailwind utility classes (no component library — this app is bespoke visualization). Two accents, distinct jobs ([ADR-0005](docs/decisions/0005-synthwave-visual-identity.md)): the magenta `--color-watt` is reserved for **live data** and is the only thing that glows; the violet `--color-neon` is structural chrome and never glows.
- **Design decisions**: anything that changes architecture, protocol semantics, dependencies, or product behavior gets a short ADR in `docs/decisions/` (copy `0000-template.md`) in the same PR.
- **Commits**: [conventional commits](https://www.conventionalcommits.org) (`feat:`, `fix:`, `docs:`, `chore:`…). Squash-merged PRs, so the PR title follows the same convention.
- **Privacy is architecture**: live metrics never leave the room, AV is never recorded, rides are private by default. PRs that would loosen this are rejected regardless of feature value.
- **Licensing**: this repo is AGPL-3.0. Auuki (also AGPL) may be *read* as an FTMS reference, but never copy its code — see the license note in WATTROOM.md.

## Testing

```sh
make test    # go test -race ./...
make lint    # go vet + svelte-check
make ci      # what CI runs
```

One Playwright smoke (simulated trainer → 2-min workout → .fit file) guards the core flow once M1 lands. Non-trivial logic gets a table test; UI polish doesn't need one.

## Issue flow (humans and coding agents alike)

This repo is co-developed by people working with different coding agents (Claude Code, Codex, …). The coordination protocol is identical for everyone:

1. **Claim before you code**: check the issue is unassigned (`gh issue view <n> --comments`), then assign yourself and comment your approach in one line. An issue someone else claimed = coordinate in its thread, don't duplicate.
2. **Draft PR early** with `Closes #<n>` — in-flight drafts are the live "who's working on what" board.
3. **Progress lives in the issue/PR thread** — blockers, findings, decisions. Not in private chats; other contributors' agents can only see what's on GitHub.
4. Out-of-scope discoveries become new issues, never PR scope-creep.

## PR flow

Branch `feat/<slug>` from `main`, keep PRs scoped to one issue, make CI green. PR title in conventional-commit form (squash merge uses it). Good first issues are labeled [`good-first-issue`](https://github.com/natrontech/wattroom/labels/good-first-issue).

## Agent setup

Both agents read the same instructions — [AGENTS.md](AGENTS.md) (root + `server/` + `web/`) is the single source of truth:

- **Codex** picks up `AGENTS.md` natively (root, then nested files as you work deeper).
- **Claude Code** loads `CLAUDE.md`, which imports `AGENTS.md` — plus repo-level extras in `.claude/` (auto-loaded rule files, skills, permission allowlist, format-on-edit hooks).
- The rule files in `.claude/rules/` are vendor-neutral canon despite the path — AGENTS.md points every agent at them.

If you use another agent, point it at `AGENTS.md` and you're covered.
