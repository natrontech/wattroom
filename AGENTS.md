# AGENTS.md

WattRoom: collaborative indoor cycling. Go server + SvelteKit SPA + Postgres + LiveKit, one repo. These rules bind every agent and every human contributor. The incidents behind them are in [docs/history/agent-lessons.md](docs/history/agent-lessons.md); read that only when you want to question a rule.

## Canon

- [WATTROOM.md](WATTROOM.md): every product and architecture decision, locked. Don't re-decide; a new decision is an ADR in `docs/decisions/`.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): the client owns the trainer, the server owns live state in memory, Postgres owns durable data only.
- [docs/SPEC.md](docs/SPEC.md): glossary, roles, workout JSON, formulas, game parameters. Never invent a product number.
- [docs/HARDWARE-SESSIONS.md](docs/HARDWARE-SESSIONS.md): read it before asking anyone to plug in hardware.
- [docs/design/TARGETS.md](docs/design/TARGETS.md): the target and must-match list for every rider-visible surface. Canon outranks the image; the image outranks today's app ([ADR-0086](docs/decisions/0086-a-rider-visible-change-is-held-to-its-target.md)).
- `.claude/rules/` is vendor-neutral canon: `git.md` before your first commit, `errors.md` before API or frontend work, `code-quality.md` and `ux.md` before any feature.

## Commands

- `make infra`: the shared Postgres + LiveKit.
- `make dev-server` / `make dev-web`: the hot-reload pair (Vite proxies /api and /ws).
- `make test`: race-detected Go tests + vitest. Must pass.
- `make lint`: golangci-lint, svelte-check, prettier.
- `make protocol`: regenerate `web/src/lib/protocol.ts` after editing `server/internal/protocol/`; commit both.
- `make migration name=<slug>`: the only way to add a migration. Never type a sequence number.
- `make build`: one binary with the SPA embedded.
- `make perf` / `make perf-scenes`: GPU and CPU cost per animated element and per screen (macOS); see [docs/PERFORMANCE.md](docs/PERFORMANCE.md).

## Taking work

Every change has a GitHub issue on a milestone. All of this happens before the first edit, not the first commit:

1. **Check it is free**: `gh issue view <n> --comments`, `gh pr list`, `git worktree list`. It is taken if it is assigned, claimed in a comment, covered by an open PR (a draft is a claim even on a silent issue), or named by someone's worktree branch (a branch with no commits is an agent that just started). Taken: coordinate in the thread.
2. **Cut the worktree**: `git worktree add ../wattroom-worktrees/<slug> -b feat/<slug> origin/main` (or `fix/`, `docs/`, `chore/`), and work only there. A session that starts in a linked worktree (Happier's `.dev/worktree/<name>`) renames its branch instead (`git branch -m feat/<slug>`) and opens no second one.
3. **Claim**: `gh issue edit <n> --add-assignee @me` and a one-line approach comment.
4. **Open a draft PR** with `Closes #<n>` and a conventional-commit title. Re-run step 1 after reading the code; the earliest claim wins.

Standing down: withdraw your claim and write "proceed, do not stand down on account of my comment". Everything goes through a PR; `main` rejects direct pushes.

## Doing it

- Progress, blockers and decisions go in the issue or PR. A decision made in a thread still gets an ADR.
- Out-of-scope findings become new issues with a milestone and labels, never extra scope.
- A PR a rider can see carries a Design check section per [docs/design/DESIGN-CHECK.md](docs/design/DESIGN-CHECK.md); one with a blocker or major left stays draft.
- A PR body says what changed, why and how you checked it, in at most 600 characters ([template](.github/PULL_REQUEST_TEMPLATE.md)); findings and logs go in comments. CI goes red over 1,200.
- Done = CI green, diff self-reviewed, PR marked ready.

## Merging and cleaning up

- **Merge your own PR** once the five required checks pass (`gh pr checks <n>`), no advisory check is red and no reviewer point is open: `gh pr merge <n> --squash --subject '<type>(<scope>): <description> (#<n>)'`. A PR that edits WATTROOM.md is marked ready and left for a human.
- **Then finish**: `make dev-db-drop`, delete the branch locally and on the remote, `git worktree remove`, and leave the canonical clone on `main`, pulled.
- Never stash, discard or revert files you did not write. Report the blocker and the one command that clears it.

## What worktrees share

- `scripts/dev-env.sh` derives each worktree's ports and databases from its path: server 8100+, Vite 5500+, verify 8500+, e2e 4400+ and 8700+, databases `wattroom_wt_<name>_<crc>` and `wattroom_test_wt_<name>_<crc>`. The main tree keeps :8080, :5174, :8082, :4173/:8081 and `wattroom` / `wattroom_test`. `make dev-env` prints them.
- Both databases are created on demand and nothing removes them but `make dev-db-drop`.
- A whole `go test ./...` run, and the next one, share one test database: a fixture that must be alone needs a run-unique name, and one that must survive a retention sweep is dated inside the retention. `WATTROOM_TEST_DB` overrides the name; a bare `go test` hits the main tree's.
- Still shared: one Postgres server and one LiveKit. Say so when you verify audio.
- `make infra` always starts the one compose project `wattroom`, wherever you run it. Never `docker compose up` by hand and never bring a compose project down. `make worktree-gc` names stray postgres containers and prints the `docker rm -f`; it stops nothing itself.

## Labels

- Area: `ble` `channels` `workouts` `game-modes` `jukebox` `infra` `docs` `design`.
- Kind: `bug` `enhancement` `security` `feedback` (a rider report, ADR-0006; the `pickup-feedback` skill works it).
- State: `blocked` (the body names the blocker), `backlog` (parked: ask first), `needs-human-input` (needs taste, money, legal exposure, risk appetite or roadmap priority: don't build what it proposes). If WATTROOM.md, SPEC, an ADR or a rule already answers it, it is a defect: amend the stale doc, drop the label, build it. Two plausible options is not enough for the label. Ask the maintainer while they are there; the issue is the fallback.
- Process: `no-changelog` (no rider sees it), `good-first-issue`.

## Releases

You don't release or deploy ([ADR-0019](docs/decisions/0019-tagged-releases-and-a-self-converging-vm.md)), but know the shape:

- Releases are tags, CalVer `YYYY.0M.MICRO`, cut only by `make release`. `:main` is built on every merge and never deployed.
- The desktop shell has its own tags, `desktop-vYYYY.M.N` (month unpadded: semver), cut only by `make desktop-release` when `desktop/` changed ([ADR-0037](docs/decisions/0037-a-desktop-shell-for-what-the-browser-cannot-reach.md)).
- Deploying belongs to the operator's infrastructure repo (`janlauber/homelab` for wattroom.ch), whose timer rolls out each new release: cutting one is deploying it. `deploy/` is the self-hosting reference, not production.
- Rollback is an image tag, never a database restore. Add nothing that restores a dump.
- Every PR adds a `changelog.d/` entry (`.claude/rules/git.md`).

## Hard rules

- `web/src/lib/protocol.ts` is generated: edit the Go structs.
- Go: stdlib first, no frameworks or ORM, `log/slog`, table tests. Web: Svelte 5 runes, Tailwind v4 utilities, no component library.
- Privacy is architecture: metrics session-scoped, AV never recorded, rides private by default. Never loosen.
- **Migrations are expand/contract** (ADR-0019): a release only adds nullable columns, tables and indexes. Drop or rename a column one release after the release whose code stopped using it; sqlc's `select *` and `returning *` use every column until a release has made them explicit. This is what keeps rollback safe.
- Never copy code from Auuki (AGPL; read only).
- **Strava data never enters an LLM context** (Strava API Policy §5.3, [RESEARCH §13.5](docs/RESEARCH.md)): no Strava payload in a prompt, fixture, issue or PR comment, and no feature that hands one to a model. A ride we recorded is ours; the copy Strava returns is theirs.
- **Route geometry and the place names derived from it never enter an LLM context** ([ADR-0063](docs/decisions/0063-a-route-keeps-its-place-with-care.md)): a route's name, id, coordinates, heights, the places and climbs along it, segment efforts. That covers MCP, feedback issues, prompts, fixtures, issues and PR comments. A route ride reaches an AI as `Route ride` plus km and gain. Fixtures use the invented `testx.Corridor`; every new AI-facing surface runs `testx.Leak`.
- Two accents ([ADR-0005](docs/decisions/0005-synthwave-visual-identity.md)): `--color-watt` (magenta) marks live data and is the only thing that glows; `--color-neon` (violet) is chrome and never glows.
- **Mute before you play**: unless audio is under test, set localStorage `wattroom.mixer.v1` to `{"music":0,"cues":0,"board":0,"share":0}` before playback, all four in one object (a missing key returns to its default: `board` 0.7, `share` 1). Do the same for any other media a test opens.
