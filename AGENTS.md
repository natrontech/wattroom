# AGENTS.md

WattRoom: collaborative indoor cycling. Go server + SvelteKit SPA + Postgres + LiveKit, one repo.

## Read first

- [WATTROOM.md](WATTROOM.md): the decisions that hold. Changing one means editing it in the same PR.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): the client owns the trainer, the server owns live state in memory, Postgres owns durable data only.
- [docs/spec/](docs/spec/): product numbers (formulas, game parameters, glossary). Look a number up, never invent one.

## Commands

- `make infra` once, then `make dev-server` and `make dev-web`. `make dev-env` prints this checkout's ports; sign in with `?as=<name>`.
- `make test`, `make lint`: must pass. `make protocol` after editing `server/internal/protocol/`. `make migration name=<slug>` for a migration.

## Working

- Branch from `origin/main`, open a PR, squash-merge when `server` and `web` are green. `main` rejects direct pushes.
- Subject: `<type>(<scope>): <description>`. `feat`, `fix` and `perf` subjects become the release notes, so write them for a rider.
- Stage explicit paths. Never stash, discard or revert files you didn't write.
- Test logic that can break silently: hub, protocol, ride math, parsers, API handlers. No tests that read source files or pin markup.
- Check a UI change in the running app before you call it done.

## Hard rules

- `web/src/lib/protocol.ts` is generated: edit the Go structs and commit both.
- Go: stdlib first, no frameworks or ORM, `log/slog`. Web: Svelte 5 runes, Tailwind v4, no component library.
- Migrations only add (nullable columns, tables, indexes). Drop a column one release after the code stopped using it. Rollback is an image tag.
- Privacy: live metrics stay in the session, AV is never recorded, rides are private by default.
- Strava data and route geometry (names, coordinates, places along a route) never enter an LLM context: no prompt, fixture, issue or PR comment. A route ride reaches an AI as `Route ride` plus km and gain.
- Never copy code from Auuki (AGPL).
- Tests that play media mute first: localStorage `wattroom.mixer.v1` = `{"music":0,"cues":0,"board":0,"share":0}`.

## Product rules

- The rider is on a bike, sweating, the screen at arm's length. Big targets, no typing mid-ride, every state change gets a sound and a visual.
- An error says what went wrong and what to do. API errors are `{error, message, field?}` with `error` one of `validation_error invalid_request unauthorized forbidden not_found conflict rate_limited internal_error`. Never send `err.Error()` to a client.
- A feature whose precondition is missing (no trainer, no LiveKit) is disabled with a one-line hint or hidden. It never fails on click.
- Ride-critical errors (trainer lost, socket dropped) are persistent status, never a toast. Reversible actions run at once with an undo toast.
- A value 95 % of riders would pick is a default, not a setting.
- Words: crew, chat channel, voice channel, session, coach. Never "room".
- `--color-watt` (magenta) marks live data and is the only thing that glows. `--color-neon` (violet) is chrome.

## Releases

`make release` tags `YYYY.0M.MICRO` with notes from the `feat`/`fix`/`perf` subjects since the last tag. Deploying belongs to the operator's homelab repo, which rolls out each new tag.
