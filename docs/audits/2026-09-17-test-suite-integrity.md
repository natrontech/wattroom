# Audit 2026-09-17 — test-suite integrity: does the suite actually test anything

**Slice.** The tests themselves, not the code under test: the Go server suite (180 files,
932 `Test` funcs), the web unit suite (180 `*.test.ts`), the Playwright specs (40 files, 71
tests) and the desktop smoke, plus what a green PR actually proves. Four read-only auditors,
one per area — Go assertion quality, Go fixtures and shared state, the web unit suite, and
e2e plus CI gating. Commit `b17ca794`.

**Excluded.** Correctness of production code (a test that is *wrong about* correct code is in
slice; a live bug that is properly tested is not — nothing of the latter was found). Flakiness,
retries and runner timing, audited 2026-09-09 and not re-derived. The `web/src` app itself,
swept 2026-09-16, and the server's HTTP API, swept 2026-09-17 — this audit reads their *tests*.

**Method note.** Three of the four auditors ran **mutation testing** rather than reading alone:
a realistic bug injected into a scratchpad copy, the suite re-run, and the mutation reverted.
Every "survived" claim below was executed. Two auditors also read the live Postgres read-only,
which is how the teardown leak was caught with physical evidence rather than inferred.

## Findings and where they went

| # | Finding | Sev | Disposition |
|---|---|---|---|
| 1 | The e2e suite never zeroed the mixer outside the `riders` fixture — `ride.spec.ts` rode a real minute with cues at their 0.7 default, breaching AGENTS.md's "Mute before you play" | high | **#2358 → merged** (`--mute-audio` on the `chromium` and `phone` projects) |
| 2 | Test teardown silently deleted nothing, two ways: three cleanups on an already-cancelled `t.Context()`, and `internal/playlists` registering its crew cleanup last so LIFO hit `ON DELETE RESTRICT` | high | **#2361 → merged** |
| 3 | docs/SPEC.md's product numbers were asserted against themselves — a 11 s count-in and a 44 rpm auto-pause both passed all 1658 tests | high | **#2363 → merged** |
| 4 | `web/e2e/` is in no typecheck, no formatter and no required job — a spec can stop compiling with all five required contexts green | high | **#2359** |
| 5 | The redirect half of the SSRF policy is never executed — every block in `CheckRedirect` reads count 0 | high | **#2370** |
| 6 | Floor is Lava's disconnect grace (0% covered) and Points Race's `state`/`withdraw`/podium order (0%) — rules implemented in two modes, tested in one | high/med | **#2371** |
| 7 | Two assertions that could not fail: `gatePct` compared to itself, and `shapes.test.ts` mocking away the branch its title checks | med | **#2366 → PR #2369** |
| 8 | Fixtures bypass `testx` and are only *test*-unique on a database nothing sweeps — a killed run permanently reddens `internal/auth` and `internal/account` | med | **#2367** |
| 9 | Two more skips that should be failures, in the family #2352 fixed: `freshDatabase`, and one tz skip where five siblings fail | low | **#2368** |
| 10 | `phone-width.spec.ts` drops the three crew routes when the crew does not resolve — the guard covers four of the six variables it uses | med | **#2360** |

### Filed by the rule `kind is bug OR severity is high`

Everything above. What follows missed that bar and is recorded here rather than filed, so it
is not lost and nobody re-derives it.

- **No unit test renders a Svelte component.** 0 `mount(` calls, no render dependency, 225
  components, 66 of them carrying `$effect`. Demonstrated: both #2163 defects were
  reintroduced verbatim into `RoomMyPrefs.svelte` (a `$state` written inside its fill
  `$effect`, and `body:` in place of `json:`) and the suite stayed at 1658 green; deleting a
  route page's entire markup did too. **This matches WATTROOM.md's locked "Vitest for frontend
  logic" rather than violating it** — so it is a decision to revisit with evidence, not a
  defect. See *Decisions* below.
- **The kit's documented button heights are measured by nothing.** `.claude/rules/ux.md` rests
  its tap-target argument on four numbers (`btn-lg` 44, `btn` 36–38, `btn-xs` 28–30,
  `btn-link` 16); a padding change makes the rule false advice silently. `tap-targets.spec.ts`
  is correctly scoped and uses the right floor (24, AA) — the gap is the other half, and no
  spec asserts 44 on a control a rider uses while pedalling.
- **The four-states rule has no unit coverage.** 13 route `load` modules exist, 6 are covered;
  exactly one error state is asserted anywhere (`page-loads.test.ts:131`). `EmptyState`,
  `Banner` and `Skeleton` — used by 18, 43 and 28 components — have no test at all.
- **Scratch databases are invisible to every cleanup path.** `freshDatabase` and `scratchDB`
  create real databases named with a nanosecond; a killed run strands one, and its name matches
  nothing `dev-env.sh drop-db` or `worktree-gc` knows — so AGENTS.md's promise that
  `make dev-db-drop` "takes both" is then false. Not yet observed live.
- **The closed-set error-code check is a hand list, not a sweep.** `TestJukeboxRefusalsSpeakTheClosedSet`
  iterates 7 constants; `writeError` has 15 call sites, 13 passing a literal nothing sweeps.
  All 15 comply today. The thing that let the original seven bespoke codes through is still
  invisible outside the jukebox path.
- **The errors.md 401 case is missing on the room-scoped mutating routes** — 3 of 20 playlists
  routes have a signed-out test, and no room-membership verb (`join`, `role`, `members`,
  `transfer`, `schedule`) has one. A chokepoint makes this safe today; it is unpinned, not broken.
- **`focus-trap` tests neither behaviour it is named for** — Tab containment and focus
  restoration on destroy are both untested, in a file that already has the harness for it.
- **Source-scan guards match a mention, not a use** — 13 `irreversible.test.ts` rows use a bare
  unanchored `/confirm\(/`, which passes on any occurrence in a two-action file. The authors
  already hit this and worked around it for one row.
- **`PLAYWRIGHT_BASE_URL` is set nowhere in this repository**, and 21 of 40 specs skip
  themselves against it, so what the production synthetic actually covers is undocumented here.

## Checked and found sound

The part that stops the next audit re-deriving it.

- **Mutation testing killed almost everything thrown at the Go suite.** Killed: SSRF
  `IsPrivate()` removal, CGNAT `/10`→`/32`, reserved `240/4`→`/32`, the port allowlist;
  `httpx.ClientIP` reading the first XFF hop instead of the last (#1824); trusting XFF with no
  proxy declared (#2258); `minSprintField` 2→1 (#2235, caught twice independently); the poke
  cooldown answering `conflict` instead of `rate_limited`; a jukebox refusal leaving the closed
  set. These regression tests do re-break.
- **All 153 registered HTTP routes** across 22 packages are exercised by at least one test in
  their own package. Finding 6 in the unfiled list is about the *401 case*, not untested routes.
- **No vacuous structural patterns in the Go suite.** Zero empty-body subtests across 142; two
  automated sweeps (functions whose only failure path is an `err != nil` guard; assertions
  inside unguarded `range` loops) produced 132 hits and **no** true positives.
- **Concurrency assertions are correctly synchronised** — all 6 goroutine-based cap/race tests
  collect into indexed slices or guarded counters and assert after `wg.Wait()`. Nothing stranded
  in a goroutine. Only 2 `t.Parallel()` calls exist in the whole Go suite.
- **The web suite's mocking discipline is good.** 40 files use `vi.mock`; every target was
  checked against its file's subject and **not one test mocks the module it asserts on**
  (finding 7's `shapes.test.ts` mocks a collaborator into a state that makes a branch
  unreachable — a different fault). `av.svelte.test.ts`'s 1517-line LiveKit fake models the
  SDK's semantics rather than stubbing returns, and nothing in it is tautological.
- **No disabled tests anywhere in the web suite** — zero `.skip`, `.only`, `.todo`, `xit`.
  All 24 files using fake timers advance them.
- **No implementation-mirroring on presentation** — zero assertions on Tailwind class strings,
  zero on `Object.keys` ordering. In a 225-component app this is the smell one expects most,
  and it is genuinely absent.
- **`phone-width.spec.ts`'s route list is complete today.** Audited route by route against
  `web/src/routes/`: `/progression`, `/sessions`, `/rooms` and `/dm/[peer]` are bodiless
  redirects, `/dev/*` 404s outside a dev build, and `/hud` deliberately has no `page-body`
  (asserted at `hud.spec.ts:17`). The rule's "every route" is true as written — the risk is
  drift, which is #2360's second half.
- **`tap-targets.spec.ts` uses the right number** — `FLOOR = 24` scoped to browse surfaces.
  #1088's mistake (a flat 44 condemning every button) is not repeated.
- **The e2e harness is not a mock** — it spawns the real Go binary against real Postgres,
  proxies `/api`, pipes the WebSocket upgrade raw, and rebuilds every run.
- **The desktop smoke has teeth** — 9 tests / 41 assertions against a real Electron binary,
  pinning the exact sorted key list of `window.wattroom` and asserting Node is unreachable
  from the renderer.
- **`.claude/rules/git.md`'s gating claim is accurate**, verified against the live ruleset
  (id `21957807`): required contexts are exactly `server`, `web`, `vulncheck`, `docs`,
  `changelog`, with `bypass_actors: []`.
- **`scripts/dev-env.sh` is sound and self-checking** — it refuses any test-database name not
  matching `wattroom_test*` before anything destructive, and refuses to hand out a port equal
  to Postgres's. No stranded `wattroom_wt_*` databases were found on this machine.
- **`storetest`'s skip/fail contract is correct as of #2352**, and `WATTROOM_REQUIRE_DB` is a
  canary test rather than a guard inside `Open` — which reads like an omission and is not.

## Decisions — for a maintainer, not for an agent

1. **Does "Vitest for frontend logic" still hold?** WATTROOM.md locks it, and the suite obeys it
   exactly. The evidence that the boundary now costs something is #2163: two defects in one
   component, neither visible to 1658 tests. Adding component rendering means a new dependency
   and a second vitest project. A cheap partial exists — a source-scan test flagging `$state`
   assigned inside an `$effect` body — which needs no dependency and would have caught one of
   the two.
2. **Should a red `e2e` be able to block a merge?** WATTROOM.md says the Playwright smoke
   "runs on every PR" (lines 54 and 207); in fact `e2e.yml` filters on paths so it never starts
   on a docs-only PR, and the context is advisory so a red run blocks nothing. `.claude/rules/git.md`
   has absorbed that reality; WATTROOM.md still reads as true and carries no `**Diverged**`
   annotation, though the file uses that form three times elsewhere (lines 19, 46, 197).
   Requiring it needs the skip-shim job `git.md` already describes, and changes what can block
   `main`. The doc half — annotating the divergence — is derivable and should happen either way.

---
*Read-only: no finding was observed in a running browser or against production. Every
high-severity finding was re-read at its `path:line`, and every coverage and mutation claim
re-run, by the auditor of record before filing.*
