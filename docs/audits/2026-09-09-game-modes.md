# Audit: sprint moments and game modes (2026-09-09)

**Slice.** The server's rules for sprint moments and the seven game modes (`server/internal/hub/` sprint*, game*, mode_*, the gamify hooks, the protocol structs) and the web's rendering, cueing and controls for them (`web/src/lib/room/` GamePanel, SprintMoment, podium, room-sounds, TvOverlay, SessionControls, SessionPicker, the dev mocks).

**Excluded.** The workout timeline and ERG, the after-ride flow (its own audit the same day), jukebox, DMs, voice, desktop. Two open decisions were reported on, not re-decided: #1498 (Watt Golf 9 vs 18) and #1506 (lobby ping).

**Method.** Two read-only Explore agents at `42c52583`, one per half, against docs/SPEC.md's game-mode table and sprint rules, WATTROOM.md, ARCHITECTURE.md, ADR-0005/0022 and the rules. Every high and medium finding was verified by reading the cited code before filing. Filing rule: bug or high; the low polish went into one issue.

## Findings and where they went

| # | Finding | Kind | Disposition |
|---|---|---|---|
| S3 | Four of seven modes broke podium ties by map iteration order | bug, high | #1574 → **#1585** |
| S7 | Only three modes were sampled at 1 s; a coach-armed sprint quadrupled Team Relay's distance | bug | #1580 → **#1585** |
| S8 | A session start blanked the roster a running game scored against | bug | #1581 → **#1585** |
| S9 | One refusal for two refusals; game-end with nothing running was a silent success | polish | #1582 → **#1585** |
| S2 | A game ended in silence — no timeline line, no XP | not-built, high | #1575 → **#1595** (`game_win` ledger source, expand-only migration) |
| S5 | Sprint Roulette neither burst the tick nor published a start anchor | drift | #1578 → **#1595** |
| S6 | A game outlived its session and never stopped being "done" | bug | #1579 → **#1595** (a finished game lingers 30 s then goes; a running one is not cut off by a session close — see the issue) |
| S1 | The reconnect backfill never reaches the elimination grace — the buffer proves nothing | bug, high | #1576 (open) |
| S4 | A rider who leaves keeps playing and can win from outside the room | bug | #1577 (open) |
| S10 | Watt Golf is 9 holes on the wire and hides the meter for the whole game | decision | noted on #1498 |
| W1 | A started game never rendered — the Training place showed "Nothing is running yet"; End game was unreachable | bug, high | #1586 → **#1594** |
| W2 | Sprint Roulette's klaxon never sounded | bug, high | #1587 → **#1594** |
| W3 | The game panel and Watt Golf's count-in ran on the rider's wall clock | bug, high | #1588 → **#1594** |
| W6 | The phone's sprint overlay glowed a spectator's own 0 W | bug | #1591 → **#1594** |
| W8 | Mid-ride controls were 36 px on the Lounge; the disabled sprint had no reason; Start game was `btn-xs` | bug | #1592 → **#1594** |
| W4 | A sprint is audible on every place but visible on one; no game layer on the TV | bug | #1589 (open) |
| W5 | The eliminated rider is not told, nor the reconnecting one about the grace | not-built | #1590 (open) |
| W7, W9–W13 | Announcements (done for the panel in #1594), the picker's dialog role, the drifted `/dev/modes` mock, the rider-keys scan, the ramp podiums' missing score, the hardcoded hole count | polish | #1593 (open) |

## Checked and found sound

**Server.** The sprint's own numbers match SPEC exactly — 3 s klaxon, 15 s window, 250 ms burst opening 1 s early and closing 1 s late, best-5 s-w/kg with a real five-second floor, one sample per wall-clock second, scored once, the sprint-of-one refusal. Roles: `canControl` matches SPEC's matrix for sprint and mode, and a member's attempt is a `forbidden` refusal with a message. Sprint arming is gated on `running`; a second game start is refused. Double elimination is impossible in ramp and lava; the 30 s grace is implemented and boundary-tested; the elimination modes hold 1 Hz through a 4 Hz burst without replaying missed seconds; #824's collective-mean fix holds. Zero-watt riders are eliminated on the rules; FTP and weight are `not null` with checks, so "the rider with no FTP is immortal" is unreachable. Lock discipline: the keeper and `json.Marshal` run after the unlock; `startGame`/`endGame`/`armIfRunning` do no I/O. Game state is per room and goes only to that room's clients; XP is idempotent on `(user, source, ref)`. Nothing here reads `state.Elapsed`.

**Web.** Refusals reach the screen: `ws.go` writes `forbidden`/`invalid_request` for game, game-end and sprint, `live.svelte.ts` routes them to `refusal`, and `RoomStatus` renders a `role=status` banner on every place for 6 s. Coach gating hides the controls for non-coaches and spectators; the sprint button exists only while running. Every sprint and game cue goes through `play()` under the mixer's `cues` fader and mute, and ducks under voice. Both layers are typing-free. `podium.ts` and `modes.ts` are single sources of truth, use `text-neon` without glow, carry `aria-label`s, and speak the glossary. Production `{#each}` blocks over riders are keyed by id. `GameState`/`GameRider` are fully consumed (`targetPct` drives ERG); no removed field is read. `TvOverlay` is a focus-trapped dialog; Escape peels one layer. Neither layer animates, so reduced motion needs nothing.

## Lessons for the next run

- A mode's `advance` is called by whatever cadence the room is on; wrap every mode in the 1 s sampler by construction (the registry does now), not per mode.
- `startGame` never touched the session, so "the phase" was the wrong gate for a game surface; a game is a session's peer and needs its own branch.
- The server's `sprint` is not the roulette's `window`: anything keyed on `tick.sprint` (burst, klaxon, overlay) is silent for the game unless the game exposes its window.
- A test that reads `rm.game.(windowed)` needs the two-value assertion or errcheck refuses it.
