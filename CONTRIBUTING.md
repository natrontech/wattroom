# Contributing to WattRoom

Read [WATTROOM.md](WATTROOM.md) for the decisions that hold, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit, and [AGENTS.md](AGENTS.md) for the rules every contributor follows, human or agent.

## Dev setup

Requirements: Go 1.26+, Node 22+, pnpm, Docker. The pnpm version is pinned in `web/package.json` (`packageManager`); pnpm 10+ and corepack install it for you.

```sh
git clone https://github.com/natrontech/wattroom && cd wattroom
make infra        # Postgres + LiveKit dev containers
make dev-server   # terminal 1: Go with hot reload on :8080
make dev-web      # terminal 2: Vite on :5174, proxying /api and /ws to :8080
```

Open http://localhost:5174. In a `git worktree`, ports and the dev database come from the worktree path; `make dev-env` prints them. No smart trainer needed: use the simulated one. If you own an FTMS trainer, say which in PRs that touch the BLE layer.

On Windows/WSL, `make infra` can fail with `Ports are not available` for a UDP port when Hyper-V reserved LiveKit's media range. `netsh int ipv4 show excludedportrange protocol=udp` lists the reserved ranges; shift `port_range_start`, `port_range_end` and the `ports:` mapping in docker-compose.yml to a free range.

## Repo layout

```
server/                 Go: API, live hub, embedded SPA
  internal/hub/         live voice-channel state
  internal/protocol/    WS message types, the source of truth for the protocol
web/                    SvelteKit SPA (Svelte 5 runes, Tailwind v4, adapter-static)
  src/lib/protocol.ts   generated from Go (make protocol)
desktop/                Electron shell for what the browser cannot reach
docs/                   ARCHITECTURE, spec/, RESEARCH
```

## Pull requests

Branch from `main`, keep a PR to one change, make `make test` and `make lint` pass. The PR title is a [conventional commit](https://www.conventionalcommits.org); squash merge uses it, and `feat`/`fix`/`perf` titles become the release notes.

This repo is AGPL-3.0. Auuki (also AGPL) may be read as an FTMS reference, never copied.
