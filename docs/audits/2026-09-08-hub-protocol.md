# Audit — the hub and protocol layer — 2026-09-08

Run against main @ `a99af82` (release 2026.09.44). Read-only: nothing was changed and nothing was
verified in a running app.

**Produced no issues.** That is the finding. Everything checked below holds, and this document exists
so the next audit does not re-derive it — which is the whole reason
[`.claude/skills/audit`](../../.claude/skills/audit/SKILL.md) asks for the *solid* half of a report.

## The brief

Slice: `server/internal/hub` and `server/internal/protocol` — live room state, the tick loop, the
game modes and the WS wire contract. Everything else explicitly out, especially the jukebox client,
which had #267 in flight in a neighbouring worktree.

Chosen because it was the one subsystem **nobody touched** during 2026-09-07/08's burst of parallel
merges (five releases, ~30 PRs across eight agents). The hypothesis was that unattended code drifts
against its documents while everyone works around it. It did not.

Single-threaded rather than fanned out, per the skill's own "sized to the plan the maintainer is on".

## What was checked, and found sound

| Claim | Where it comes from | Verdict |
| --- | --- | --- |
| No DB, HTTP or blocking I/O in the tick loop or under a room mutex | `server/AGENTS.md` | **Holds.** `tick.go:214` unlocks before every hand-off, and each one carries a comment saying so. Session saves (`tick.go:231`) and recap writes (`tick.go:250`) are detached onto `safego.Go`; the XP keeper is called outside the lock because it queues its own I/O. |
| Every `go func()` names its exit condition | `server/AGENTS.md` | **Holds.** There is no bare `go func` in the package: seven launch sites, all through `safego`, three of them supervised with a panic budget (`safego.Budget`). |
| WS input is untrusted; bounds-check metrics | `server/AGENTS.md` | **Holds.** `room.go:287` bounds watts (0–3000), HR (0–250) and cadence (0–250). Chat is rune-counted, rate-limited and its image id length-checked (`ws.go:143`). See the note on `seq` below. |
| Coalesce n riders into 1 tick per room per second | `docs/ARCHITECTURE.md` | **Holds.** `tick.go:257` marshals once per room, not once per client — with the #670 regression named in the comment. |
| 1 Hz, bursting to 4 Hz during sprints | `docs/ARCHITECTURE.md` | **Holds.** `tick.go:60-66`, and the voice clock's `dt` is wall time so the burst does not quadruple it. |
| Elimination modes get a 30 s disconnect grace | `docs/SPEC.md` | **Holds.** `game.go:27`, shared by the elimination modes through `graceTracker`. |
| Backyard Ramp: 3 min, 80 %, +5 %, 10 s below, 50 % for the eliminated | `docs/SPEC.md` | **Holds** — `mode_backyard.go:16-23`, including Collective Ramp's 75 % / +4 %. |
| Floor is Lava: 3 lives, >5 s out, zone every 2 min | `docs/SPEC.md` | **Holds** — `mode_lava.go:14-17`. |
| Watt Golf: 9 holes, 20 s lead-in, 10 s window, 60–110 % FTP, meter hidden | `docs/SPEC.md` | **Holds** — `mode_golf.go:8-14`, and `MeterHidden` is a real protocol field, not a client-side convention. |
| Sprint Roulette: 10–15 s sprints, 3–8 min gap, 3 s klaxon | `docs/SPEC.md` | **Holds** — `mode_roulette.go:39-59` (gap 180–479 s, length 10–15 s). |
| Team Relay: 110 % front, 55 % rest, 60–90 s rotation | `docs/SPEC.md` | **Holds** — `mode_relay.go:22,38`. |
| Points Race: sprints score 5/3/2/1 | `docs/SPEC.md` | **Holds** — `mode_points.go:19`. |
| `web/src/lib/protocol.ts` is generated and in sync | root `AGENTS.md` | **Holds.** `make protocol` produced no diff. |
| Deliberate shortcuts name their ceiling | `.claude/rules/code-quality.md`, ponytail | **Holds.** Nine `ponytail:` comments across the slice, every one naming both the limit and the upgrade path. No `TODO`, `FIXME`, `XXX` or `HACK` anywhere in it. |

## Three notes, none of them issues

Filed nowhere on purpose — none is a bug, and none is high severity, which is the rule this run used.

**`seq` is not bounds-checked, and does not need to be.** `server/AGENTS.md` names it alongside watts
("bounds-check metrics (watts, seq)") and `validMetrics` (`room.go:287`) does not check it. It is
still safe, by two independent guards: the accumulator admits **one sample per room-clock second**
(`accumulator.go:100-104`, and the comment is explicit that a client's seq "is proof that it sent
something, never that a second passed"), and `maxAccumulated` caps the record at six hours. A hostile
seq can churn the `stream` counter and nothing else. Worth knowing that the rule's wording is ahead
of the code here in the *safe* direction — the defence moved rather than being missed.

**Two Points Race numbers are not in SPEC.** `pointsSprints = 4` and `pointsIntervalLen = 2 * time.Minute`
(`mode_points.go:15-16`) are invented, where the sibling `mode_roulette.go:13` carries a `ponytail:`
comment saying its own sprint count "is not specced, tune in alpha". SPEC's Points Race row specifies
the *scoring* and not the *structure*, so nothing is contradicted — but the roulette comment is the
better pattern and points lacks it.

**Sprint medals break ties by id, not SPEC's rule.** `sprint.go:109` says so out loud: "id is stable,
not the SPEC's medal rule (earlier joiner)". A documented divergence rather than drift, and it only
decides who is listed first on an exact tie.

## What was not covered

The WS *transport* beyond the message contract (`coder/websocket`'s own 32 KB default read limit is
what bounds a frame; nothing in the hub sets one, and nothing needs to). The hub's interaction with
`internal/rooms`, `internal/gamify` and `internal/recap` was read only where the tick hands off to
them. Nothing was exercised in a running app, so this says nothing about behaviour under real
concurrency — `make test` runs the package race-detected, and that is the evidence that exists.
