# 0052 — A room ride the server loses comes back from the browser, as a file

- Status: accepted
- Date: 2026-09-10
- Writes down: [docs/ARCHITECTURE.md](../ARCHITECTURE.md) seams 2 and 3, which
  already answer who owns this — the shape [ADR-0050](0050-founding-record-and-current-state.md)
  gave to a statement the code had grown past
- Settles: [#1466](https://github.com/natrontech/wattroom/issues/1466)
- Constrained by: [ADR-0019](0019-tagged-releases-and-a-self-converging-vm.md) —
  rollback is an image tag, never a database restore

## Context

[#1466](https://github.com/natrontech/wattroom/issues/1466) asked the board to
decide who owns a room ride's crash safety. It does not need deciding.
[docs/ARCHITECTURE.md](../ARCHITECTURE.md) answers it twice, in two of the three
load-bearing seams:

> **2. The server owns shared truth, in memory.** […] Room state never touches
> the database; if the process restarts, live rooms re-form from reconnecting
> clients (which hold the ride data — see seam 3).

> **3. Postgres owns durable data only.** […] Rides survive anything: samples
> stream to the server _and_ buffer in IndexedDB with sequence numbers; either
> side can reconstruct after a crash.

So the client's buffer is the crash-safety copy, and a room ride the server
loses is designed behaviour, not a defect. What was a defect is the gap between
seam 3's promise and the code: the browser held the only copy and then threw it
away, and nobody was told. This ADR writes the answer down, records what a
restart actually costs, and fences what a future change may do about it.

**What the hub writes about a live session: nothing.** `tick.go`'s
`closeLocked` snapshots the session exactly once, on the tick its phase crosses
to `done`, and `handOff` gives that snapshot to the saver outside the lock.
Before that tick, no part of a room ride has reached Postgres. A backfill that
arrives *after* the close is amended onto the saved ride
(`room_ride.go`, [#1536](https://github.com/natrontech/wattroom/issues/1536));
a backfill into a room that holds no session lands in `rm.record`, is read by
nothing, and is discarded by the next `start`.

**A deliberate restart costs the same as a crash.** `server/main.go` waits
`drainGrace` (150 s) for hand-offs already made — the saver's whole retry
policy fits inside it — but it does not close running sessions, and cannot: the
timeline is the room's, not the process's. What makes this rare is
[ADR-0019](0019-tagged-releases-and-a-self-converging-vm.md)'s deploy timer
refusing to interrupt a ride, not the shutdown path.

**What survives a restart.** Everything in Postgres: rides saved by sessions
that closed, with their stats, XP, medals and power curve; the `ride_deleted`
ledger rows that keep a deleted ride's XP paid
([ADR-0047](0047-deleting-a-ride-keeps-its-xp.md)); session recaps already
written ([ADR-0034](0034-a-session-leaves-one-recap.md)); accounts, workouts,
rooms, crews, membership, saved playlists.

**What does not.** The session (phase, elapsed, the picked workout and its
parsed segments), every rider's ride record in it, the roster and the presence
spans a recap is built from, the running game mode, the jukebox queue and
playhead, sprint state, accrued voice time. The room re-forms *idle* from
reconnecting clients, and — because the workout went with the session — there
is nothing left to score the replayed samples against even in principle.

**What the rider still has.** One row a second in IndexedDB, seq-stamped,
written beside the socket send (`web/src/lib/ride/buffer.ts`). `/ride`'s
recovery card offers a ride that never ended back as a `.fit`
([#1057](https://github.com/natrontech/wattroom/issues/1057),
[#1664](https://github.com/natrontech/wattroom/issues/1664)).

## Decision

**The client's ride buffer owns room-ride crash safety. Server-side a room ride
is durable from the moment its session closes, and not one second earlier.**
That is seam 2 restated, and it is what the hub does today.

Four rules follow, and they are the whole of the contract:

1. **A room ride the server loses comes back as a `.fit`, never as a saved
   ride.** The room buffer carries no `workoutJson`, and the server scores
   against the account's FTP, so a Save from the recovery card would mint a
   second, unscored ride beside whatever the hub did save
   ([#1664](https://github.com/natrontech/wattroom/issues/1664)). Export only.
2. **Only a `done` tick may stamp the buffer finished.** The hub's per-rider
   ack says it *heard* a sample, never that it *saved* one — and a fresh
   process acks the live stream it hears while holding nothing to save, which
   is exactly how the last copy used to be stamped finished. A session that
   leaves a riding phase by any other route is a session the server forgot;
   `session.go` admits no third possibility (a riding phase exits through
   `done` alone).
3. **The rider is told, as persistent status in the room shell.** A ride that
   is not going to reach the account is ride-critical, and
   [.claude/rules/errors.md](../../.claude/rules/errors.md) wants those as
   dashboard status carrying the way back — never a toast a rider three metres
   from the screen will not see.
4. **The hub does not save an orphaned record.** A record with samples and no
   session cannot be scored (no workout survived), cannot be dated except by
   guessing, and would write a ride nobody asked for. The replay is still
   accepted and still bounded, because dropping a reconnect's samples is the
   loss the backfill exists to prevent — it simply buys nothing once the
   session is gone.

**Anything more is the owner's to want, and it is fenced.** A mid-ride write —
periodic sample flushes, a session checkpoint, a durable timeline — crosses
seam 2, so it needs that seam amended first, in its own ADR, not a PR that
quietly adds a table. And no recovery design may assume state can be put back:
[ADR-0019](0019-tagged-releases-and-a-self-converging-vm.md) makes rollback an
image tag and nothing automated ever restores a dump, because a restore would
discard every ride recorded since it.

## Consequences

Easier: the question stops being open. A room ride the server loses now has a
way back — a file, from the browser that recorded it — and the rider learns
about it in the room rather than by noticing a card on `/ride` days later. The
hub keeps its seam: no I/O under the lock, nothing durable mid-ride, one save
per closed session.

Harder, and accepted: the way back is a file, not a ride. A rider whose room
ride is lost gets a `.fit` they can upload elsewhere, and their WattRoom
history, XP and streak do not count that hour. That is the honest price of a
memory-only hub, and it is charged only on an ungraceful restart mid-session —
a case the deploy timer already refuses to create.

Accepted ceilings, each with its trigger:

- **A `done` tick is the only settle signal**, so a socket that misses the
  closing tick keeps its buffer unfinished and `/ride` offers back a ride the
  hub saved perfectly. The rider discards it. Erring this way is deliberate:
  the other error deletes a ride. The trigger to revisit is a save
  acknowledgement the client can read, which is also what rule 1 would need.
- **The status banner names the restart only when the room can name no
  workout at all**, which is the fresh process's signature (a closed session
  keeps its workout named; a new pick names the next one). A coach who picks
  the next workout inside the second between the reconnect and the first tick
  costs the rider the banner, not the ride — rule 2 does not depend on this
  test.
- **A room ride recoverable *as a ride*** — the audit's option A: the tick
  carries `workoutJson` and one start stamp both sides agree on, so the
  recovery card can Save — is **not decided here**. It is a real feature with
  a real cost (a stamp shared between hub and client so the two saves dedupe),
  and it stays where #1466 left it.
- **A buffer that fails to open still says nothing.** `openRideBuffer` returns
  a working-looking object whose `append` is a no-op when IndexedDB is
  unavailable, which is right for a mid-ride append and wrong for the initial
  open — that one is known before the first pedal stroke, and under rule 3 it
  is status. Recorded in #1466; it is a different failure from this one (no
  crash safety at all, rather than crash safety nobody read).
