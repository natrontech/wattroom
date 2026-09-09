# Sweep: dead code, duplication, size (2026-09-09)

**Slice.** `web/src` and `server/internal` against `.claude/rules/code-quality.md`: unused exports, components, queries, dependencies; the same helper written twice; files over the ceilings; orphaned flows; tests that test nothing.

**Method.** One read-only Explore agent at `712ec5c2`. Tools that ran: `go vet` (clean), `golangci-lint` with `unused` on (clean), `go mod tidy -diff` (clean), `npx knip` (3 files, 46 exports, 39 types — mostly false positives, each verified), custom greps quoted in every finding. `staticcheck` could not run (built for an older Go).

## Findings and where they went

| # | Finding | Lines | Disposition |
|---|---|---|---|
| 1 | 207 `log.Error` + `WriteError(500)` pairs; riders' `fail()` is the one home and is package-private | ~207 | #1695 |
| 2 | 16 identical `fakeUsers` test doubles, two divergent 401 bodies | ~175 | #1696 |
| 3 | 111 hand-rolled eyebrow labels beside `@utility eyebrow`; 19 identical page titles | 130 | #1697 |
| 4 | `av.svelte.ts` at 1171 lines (2.3× the ceiling); `music/+page.svelte` 670; `Jukebox.svelte` 632; `hub.go` 525 | ~1800 to move | #1698 |
| 5 | `mockcompat.ts`: a barrel named for a mock that ten production modules imported; `view.ts` had no direct importer | 85 moved, 28 removed | **#1704** |
| 6 | `rooms_test.go` at 1438 lines | ~1000 to move | open (split along the source files) |
| 7 | `clips.svelte.ts` bypasses `$lib/api` seven times | ~35 | #1698 |
| 8 | Three `Block` types, two `Phase`, two `TILE_METRICS` | ~30 | **#1704** |
| 9 | 19× `font-display text-3xl font-bold tracking-tight` | 19 | #1697 |
| 10 | `ACHIEVEMENT_BY_KEY` never read; `lib/index.ts` scaffold; 10 over-exported module internals | ~15 | **#1704** (`snap` kept: 29 uses, the sweep miscounted) |

## Checked and found sound

- All 254 sqlc queries are called (one is passed as a function value, which a `Queries.Name(` grep misses); every npm and Go dependency is used; all 22 `@utility` blocks are used; no `.svelte` component under `lib` is unimported.
- Every `mux.HandleFunc` path has a web, desktop or e2e caller; the two exceptions (`/api/auth/synthetic`, the unsubscribe pages) are by design.
- Expand/contract is current: the three most recent contract migrations cite the release they contract and landed on schedule.
- localStorage keys balance (every writer reads); no feature flags; no assertion-free test files; no cross-package duplicate of the `visible_rooms` scenarios; the e2e and Go skips are all environment guards.
- One address helper (`httpx.ClientIP`), one control-character sanitiser, one confirm, one toast-with-undo shape, one relative-time formatter.
