# Contributing to WattRoom

Welcome — this project is built to be contributed to. Read this once and you should be productive without asking anyone anything.

## Orientation (read in this order)

1. [WATTROOM.md](WATTROOM.md) — the founding document: vision, every locked decision, milestones. **Decisions in it are settled**; re-litigating them needs an ADR, not a PR comment.
2. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the pieces fit and why the seams are where they are.
3. [TODO.md](TODO.md) — the live work list per milestone. GitHub issues mirror the contributor-ready items.

## Dev setup

Requirements: Go 1.26+, Node 22+, pnpm, Docker.

```sh
git clone https://github.com/natrontech/wattroom && cd wattroom
make infra        # Postgres + LiveKit dev containers
make dev-server   # terminal 1: Go with hot reload (air) on :8080
make dev-web      # terminal 2: Vite on :5173, proxying /api and /ws to :8080
```

Open http://localhost:5173. No smart trainer required — use the simulated trainer (dev flag; lands in M0). If you own an FTMS trainer, real-hardware testing is gold: note your trainer model in PRs that touch the BLE layer.

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
- **Web style**: Svelte 5 runes, TypeScript, Tailwind utility classes (no component library — this app is bespoke visualization). The watt-yellow accent (`--color-watt`) is reserved for **live data**, never for chrome.
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

## PR flow

Branch from `main`, keep PRs scoped to one thing, make CI green. `main` is protected once CI exists; a maintainer review lands it. Good first issues are labeled [`good-first-issue`](https://github.com/natrontech/wattroom/labels/good-first-issue).
