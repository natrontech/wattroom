# AGENTS.md

WattRoom: collaborative indoor cycling ("Discord for indoor cycling"). Go server + SvelteKit SPA + Postgres + LiveKit, monorepo. These instructions apply to **every** coding agent (Codex, Claude, or other) and human contributor.

## Read before changing things

- [WATTROOM.md](WATTROOM.md) — every product/architecture decision, **locked**. Don't re-decide (stack, privacy rules, YouTube RMF constraints, license). New decisions → ADR in `docs/decisions/`.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the three seams: client owns trainer, server owns live state in memory, Postgres owns durable data only.
- [docs/SPEC.md](docs/SPEC.md) — glossary, roles matrix, workout JSON, stats formulas, game-mode parameters. **Never invent product numbers** — they're specced there.
- [docs/HARDWARE-SESSIONS.md](docs/HARDWARE-SESSIONS.md) — how to run a trainer session and what to send back. Read it before asking anyone to plug in hardware.
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

1. **Before starting**: check the issue is unassigned and unclaimed (`gh issue view <n> --comments`) **and that no open PR already covers it** (`gh pr list`). If someone (or someone's agent) is on it, coordinate in comments instead of duplicating.
   The draft PR is the claim (step 3), and agents routinely open one without commenting on the issue — so a quiet issue is not an idle one. Two agents shipped the same feature twice for want of this one command (#280 → #284 and #294).
   Then `git worktree list`. A worktree whose branch has no commits yet is an agent that has *just* started: no ref, no PR, nothing for the two checks above to find. Named branches there (`test/pane-helpers`, `test/pane-size-position-merge`) are the work in progress — read the name and stay off it. This is how the same test got written three times (#297, #302, #304, #305).
2. **Claim it**: assign yourself (`gh issue edit <n> --add-assignee @me`) AND comment a one-line approach.
3. **Branch + PR for all feature work**: branch `feat/<slug>` or `fix/<slug>`, open a **draft PR early** with `Closes #<n>` — the draft is how others see what's in flight. Conventional-commit PR title (it becomes the squash commit). **Everything** goes through a PR, including trivial doc fixes and ADR text: a repository ruleset now rejects direct pushes to `main` (`GH013: Changes must be made through a pull request`). The rule stopped being convention-only — don't plan a direct push and discover it at the remote.
4. **Progress lives in the issue/PR**, not in chat apps: blockers, decisions, findings → comments. A decision made in a thread still gets an ADR.
5. **Done** = CI green, self-review of the diff, PR marked ready. Out-of-scope discoveries become new issues (right milestone + label), never PR scope-creep.

Labels: `ble` `rooms` `workouts` `game-modes` `infra` `docs` `blocked` (waiting on another issue — the body names which) `backlog` (parked — ask first). Commit style: conventional commits, scopes `server` `web` `ble` `hub` `protocol` `game` `jukebox` `ci` `deps` (full rules in `.claude/rules/git.md`).

## Releasing & deploying

You will not run a deploy, but your change moves through this, so know the shape ([ADR-0019](docs/decisions/0019-tagged-releases-and-a-self-converging-vm.md)):

- **Releases are git tags, and versions are CalVer** — `YYYY.0M.MICRO`, e.g. `2026.09.1` then `2026.09.2`, MICRO back to 1 each month. `make release` computes the number from existing tags, promotes the changelog through a release PR (main's ruleset rejects direct pushes), merges it, then tags the result; the tag builds `ghcr.io/natrontech/wattroom:2026.09.1` and cuts the GitHub Release. Never tag by hand — a tag without a changelog section fails the release job. The version says *when*; what changed is the changelog's job.
- **`:main` is built on every merge and never deployed.** Only tagged releases are.
- **Deploying is not this repo's job.** The operator's infrastructure repo owns it: for wattroom.ch that is `janlauber/homelab`, where a timer rolls out the newest release, refuses to interrupt a ride, dumps first, and rolls back on a failed health gate. Cutting a release *is* deploying it, but nothing here does the deploying. `deploy/` is the self-hosting reference, not what runs wattroom.ch — don't assume a change there reaches production.
- **Rollback is an image tag, never the database.** Nothing automated ever restores a dump — that would discard every ride recorded since it. Do not add anything that does.
- **Every PR writes its own changelog line** into `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md), under Added / Changed / Deprecated / Removed / Fixed / Security. One line, aimed at a person deciding whether to upgrade — not a copy of your commit subject, and not generated. A PR with no line makes the next release notes lie — which already happened once, so CI now fails a PR touching `server/` or `web/src` without one (`no-changelog` labels the exceptions).
- The expand/contract migration rule below is what makes the rollback safe. It is a correctness rule, not a style preference.

## Hard rules

- `web/src/lib/protocol.ts` is **generated** — edit the Go structs, never the TS.
- Go: stdlib-first, no frameworks/ORM, `log/slog`, table tests. Web: Svelte 5 runes, Tailwind v4 utilities, no component library.
- Privacy is architecture: metrics room-scoped, AV never recorded, rides private by default. Never loosen.
- **Migrations are expand/contract** ([ADR-0019](docs/decisions/0019-tagged-releases-and-a-self-converging-vm.md)): a release only *adds* — nullable columns, new tables, new indexes. Dropping or renaming a column happens one release **after** the release whose code stopped using it. The server migrates at boot and goose is forward-only in practice, so this rule is the only reason retagging to the previous image is safe. Break it and the rollback path silently stops working, discovered at the worst possible moment.
- Never copy code from Auuki (AGPL reference-reading only).
- Two accents, distinct jobs ([ADR-0005](docs/decisions/0005-synthwave-visual-identity.md)): `--color-watt` (magenta) marks live data and is the only thing that glows; `--color-neon` (violet) is structural chrome and never glows.
