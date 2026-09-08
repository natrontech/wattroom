# 0038 — The crew is the layer above rooms, and permissions inherit into it

- Status: proposed
- Date: 2026-09-08

## Context

Rooms are flat. `rooms` carries an owner, a 6-char code, a slug and a
`listed` flag; `memberships` is `(room_id, user_id, role)` with role in
`owner | coach | member | banned` (`00001_init.sql:18-41`, widened by
`00014_room_identity_moderation.sql`). There is nothing above a room and
nothing between two of them.

That shape fights the thing the app is for. A group that trains together also
chats, and sometimes games — and a room already holds exactly one of each of
those. Not as a single stated principle, but as the sum of several:
`docs/SPEC.md` defines a session as *"one group ride in a room"*,
[ADR-0018](0018-one-music-surface-drop-the-jam-card.md) gives a room one music
surface, [ADR-0022](0022-room-events-are-ephemeral.md) one scrollback,
[ADR-0020](0020-the-app-takes-discords-shape.md) *"one conversation"*, and
`ServerTick` a single `Game` and `Sprint`. So a group doing three things needs
three rooms, and today that means three join codes handed round, three
membership lists that drift, three ban lists, and no object anywhere that says
these three rooms are the same people. The group is real; the schema has no
word for it.

Those five are also the constraint on fixing it. They are load-bearing and
settled, and any answer that reaches inside a room to make grouping work breaks
all of them at once. Whatever is added has to sit strictly above the room.

## Decision

**A crew is the layer above rooms.** It exists so a group can be in one place
while doing different things, each in its own room.

| | |
| --- | --- |
| a crew carries | name, icon, membership, its rooms, a crew-wide chat |
| a crew never carries | voice, jukebox deck, session, game state, metrics |
| a room stays | one activity: one session, one deck, one game, one conversation, one privacy scope |

The second row is the whole design. Everything a room owns stays owned by the
room, so all five constraints above — plus medals and the room streak — are
untouched by this ADR. A crew is membership, naming and permission; nothing
live.

### Structure and lifecycle

- **Rooms belong to a crew permanently.** A room never moves between crews, and
  crewless rooms do not exist.
- **New rooms are created inside a crew.**
- **Migration: one crew per owner.** Each existing owner's rooms land in a
  single crew named after them, renameable immediately. This is what makes
  permanent binding survivable — people arrive already grouped, rather than
  holding N one-room crews they can never merge.
- **Caps**: the per-user *room* cap is replaced by a per-user **crew** cap plus
  a **rooms-per-crew** cap. Both numbers are `docs/SPEC.md`'s to set and are
  never invented in code. One constraint on them is already fixed by the
  migration above: SPEC today allows a user to own 3 rooms, and one crew per
  owner puts all 3 in one crew, so **rooms-per-crew cannot be set below the
  outgoing room cap** without the migration violating its own ceiling on day
  one.

### Joining is unchanged, and the ordering is the part that reads as broken

**Crew membership follows room membership.** There is no separate crew join, no
crew code, no invite object:

```
join room A by its 6-char code   (exactly as today)
  → member of room A
  → therefore a member of crew X
  → crew X's other non-private rooms become visible and enterable
```

This is not circular, and the reason is worth stating plainly because a reader
will assume it is: **the first room is always entered by its own code or share
link**. Room codes and `/r/{slug}` remain the front door and are not
supplemented by a crew-level equivalent.

### Permissions: RBAC at the crew, inherited, with per-room overrides

- Crew roles inherit into rooms; **a room may override them**.
- Rooms are **open to the crew by default**. A private room restricts by **crew
  role plus named exceptions**.
- **Crew admins manage room permissions.**
- A crew admin who has not joined a room may do **crew-level things only**: manage
  its permissions and see it listed. They may not rename it, ban from it, delete
  it, or read its contents. Removing a room from a crew is not among their powers
  because rooms never move.
- **Coach stays a room-level assignment**, expressed through the override
  mechanism. SPEC defines it as the role driving the shared timeline and it is
  handed off mid-session; it must remain a light, live action, never a crew-role
  change.
- **Bans exist at both levels.** A room ban is what it is today. A crew ban
  removes a person from every room in the crew and prevents rejoining.

### The privacy inversion, said out loud

`00001_init.sql:27` says today:

> Rooms are private/unlisted by default; a directory listing is a per-room owner
> choice (WATTROOM.md join flow). **Privacy is architecture: the default lives in
> the schema, not in whoever writes the INSERT.**

After this ADR a room is **visible to its crew by default**, which inverts that
default and amends WATTROOM.md's join-flow paragraph. Three things hold it:

1. **A crew is invite-derived and small.** Nobody is in a crew who did not enter
   one of its rooms by a code somebody handed them. The set that gains visibility
   is the set that was already let in once, not the public.
2. **`rooms.listed` is a different axis and is untouched.** It governs the opt-in
   public directory. Crew-visible is not public, and no room becomes listed by
   this change.
3. **The principle survives the inversion.** The new default belongs in the
   schema, not in whoever writes the INSERT — the same sentence, a different
   value.

### Person-visibility follows the rooms a person may enter

Today `memberships` decides who may see whose profile, trophy case and rides.
**The decision: visibility follows the rooms a person is actually permitted to
see, not flat crew membership.** Joining a crew does not expose everyone's
trophies to everyone; being permitted into the same room does.

This is the hardest part to implement and the cutover ([#1106](https://github.com/natrontech/wattroom/issues/1106))
owns getting it right. What is there today is four call sites, and they are not
four of a kind — the cutover should not treat them as one change applied four
times:

| site | what it actually gates | banned-guarded |
| --- | --- | --- |
| `queries/riders.sql` `ListRoomsInCommon` | rooms in common — the gate for the whole rider page | yes |
| `queries/gamify.sql` `SharesRoomOrFriends` | who may see a trophy case | **no** — see below |
| `queries/rides.sql` `RoomWeekBoard` | the room's weekly board, not a person-visibility gate | yes |
| `queries/export.sql` `ExportUserRooms` | the caller's own account export, not a viewer gate at all | n/a |

Only the first two are visibility gates that this decision changes. The board is
room-scoped by ADR-0036 and stays so (below); the export returns the caller's own
rows and has no viewer to widen.

`SharesRoomOrFriends` missing its `role != 'banned'` guard is a **pre-existing
bug, not a consequence of this ADR** — it is [#1109](https://github.com/natrontech/wattroom/issues/1109)
and must not be folded into the cutover.

Every query that reads `role != 'banned'` must additionally honour the crew ban.
At the time of writing that is `queries/` (`riders.sql`, `rides.sql`,
`rooms.sql`, `gamify.sql` once fixed) and the Go guards in
`rooms/rooms.go:465,511,898,981` and `playlists/tracks.go:254`. The cutover
re-derives this list rather than trusting it.

## Consequences

### What this supersedes or amends

- **[ADR-0020](0020-the-app-takes-discords-shape.md)** — its sidebar sizing
  argument is amended. *"Discord's shape is two columns because Discord has forty
  servers of thirty channels. WattRoom has five rooms of five places"* was the
  reason for one column; the tree is now three deep and that arithmetic must be
  re-argued rather than quietly inherited. **What is not overturned:** *"voice
  stays a state you carry, not a place you join"* — voice remains per-room, which
  this design preserves by giving the crew no voice at all. Whether the deeper
  tree changes the column count is [#1023](https://github.com/natrontech/wattroom/issues/1023)'s
  to draw, not this ADR's to assert.
- **WATTROOM.md** — the join-flow/privacy paragraph (line 68) and the ownership
  cap. Per [ADR-0001](0001-adrs-and-founding-decisions.md) that file is edited
  only to mark a decision superseded, and it is **not edited by this PR**: the
  marking lands with the cutover that makes it true. Doing it now would make the
  founding record describe a repo that does not exist.
- **`docs/SPEC.md`** — the roles matrix, the cap numbers, and a glossary entry
  for *crew*. Same timing: the cutover edits it.
- **[ADR-0015](0015-self-hosted-music-pool.md) / [#1095](https://github.com/natrontech/wattroom/issues/1095)** —
  the pool is per uploader today. A crew is the scope Phase 2
  ([#1103](https://github.com/natrontech/wattroom/issues/1103)) widens it to, and
  that issue is unblocked by this ADR because `crew_id` now exists to scope to.
- **[ADR-0036](0036-what-a-room-shows-about-its-members.md) / [#995](https://github.com/natrontech/wattroom/issues/995)** —
  answered below.

### The weekly board stays room-scoped

ADR-0036 asks this ADR to say whether the board's scope becomes the crew. **It
does not**, and ADR-0036's own reasoning is why: it puts the board off by
default because *"being in a room must not put a rider on a board"* —
enrolment by existence, RESEARCH.md §14.8's first trap. A crew-scoped board
would reinstate exactly that at a larger radius: joining room A by its code
would place a rider on a board beside people from rooms B–E they never entered
and cannot see. The room stays the unit, and `rooms.board_enabled`
(`20260908070036_room_board_opt_in.sql`) stays where it is.

### "Crew" is already in the vocabulary, and that is a cost, not a saving

The name was chosen because WATTROOM.md already says *"your crew's ladder, not
the internet's"*. But the word is in use today meaning **the people in one
room**, which is the opposite of the new object:

- `docs/SPEC.md:285` — *"A room is a crew, not an attendance register."*
- `WATTROOM.md:153` — *"Crew-level:"* introduces room-level collective goals.
- `docs/SPEC.md:187` — the **`crew-chief`** medal, earned for pressing start on
  20 sessions in a room.

The first two are prose the cutover rewords. The third is not free: an earned
badge travels with the rider ([ADR-0027](0027-an-earned-badge-travels-progress-stays-home.md))
and `crew-chief` is a shipped, awarded slug, so renaming it is a data migration
over `medals` rather than a string change. **The decision is to keep the name
`crew` for the new object and leave the `crew-chief` slug alone**, accepting that
one medal is named after the old sense of the word. Re-earning cannot be asked
of riders who already earned it, and a slug is not a display string.

### Existing rooms migrate in private

Crew-visible-by-default plus one-crew-per-owner is a privacy event at migration
time if taken literally. An owner with rooms A, B and C gets one crew; crew
membership follows room membership, so everyone in A is in that crew; and if
migrated rooms take the new default, **A's members can suddenly see that B and C
exist and walk into them** — rooms they had no code for the day before. Nobody
consented to that, and it would happen in the same release that introduces the
concept, to every existing room at once.

So: **the crew-visible default applies to rooms created after the cutover.
Rooms that exist at migration land private, with their current membership as
their named exceptions.** Behaviour on upgrade is then identical to behaviour
before it — every room stays exactly as visible as it was — and an owner opens B
and C to the crew when they mean to, which is the same deliberate act ADR-0036
requires before a room shows a board.

This does not contradict the default; it scopes it. WATTROOM.md's privacy rule
is that metrics stay visible only to people who actually join, and a migration
is not a join.

### Migration and rollback

The migration is additive where it can be, per
[ADR-0019](0019-tagged-releases-and-a-self-converging-vm.md): new `crews` and
crew-membership tables, a `crew_id` on `rooms`. `crew_id` cannot be nullable
forever — crewless rooms do not exist — but it is added nullable, backfilled by
the one-crew-per-owner rule, and only then constrained, all inside the one
release. Nothing is dropped: the per-user room cap's enforcement stops being
read before its inputs go away, and `memberships` keeps its shape. A rollback to
the previous image finds every row it wrote still readable, and loses the crew
layer rather than the rooms. Migrations are created with `make migration`
([#928](https://github.com/natrontech/wattroom/issues/928)); no number is typed
by hand.

### What is explicitly unchanged

`/r/{slug}`, the 6-char room code, per-room ICS tokens
([ADR-0021](0021-rider-scoped-calendar-feed.md)) and LiveKit room names. An old
client that receives a payload mentioning a crew ignores the unknown fields and
behaves as it does today, which is what allows the rollback above to be a tag
change.

### Accepting

**It ships in one release.** A half-built permission model in production is
worse than a large release: a crew that exists but does not yet gate, or a ban
that holds at one level and not the other, is a privacy failure rather than a
missing feature. That is a deliberate trade of release size against the one
class of bug this design could produce, and it is why
[#1021](https://github.com/natrontech/wattroom/issues/1021) researches how
inherited-permission models fail *before* the cutover rather than after.

**The tree gets deeper and navigation gets harder**, which ADR-0020 spent a
whole decision avoiding. [#1023](https://github.com/natrontech/wattroom/issues/1023)
iterates on that before any implementation issue exists.

**Permanent room–crew binding is the sharpest constraint here.** A room in the
wrong crew can only be recreated, losing its code, slug, medals and streak. It
is accepted because a movable room makes every visibility rule above
time-dependent — "who could see this room" would need a history — and the
one-crew-per-owner migration removes the common reason anyone would want to
move one. If riders hit this in practice, the revisit is a room *copy*, never a
move.
