# 0038 — The crew is the layer above rooms, and permissions inherit into it

- Status: accepted
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
release. *(Corrected by the fourth amendment below: the constraint waits a
release.)* Nothing is dropped: the per-user room cap's enforcement stops being
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

## Amendment, 2026-09-08 (#1021): what §16 changed

[RESEARCH.md §16](../RESEARCH.md) landed after this ADR — the wrong order, and
§16 says so. It overturns nothing above. It supports the
existing-rooms-migrate-private rule with a regulator-tested precedent (the FTC's
Google Buzz order, §16.3), settles the crew owner below, and leaves one item
open for [#1106](https://github.com/natrontech/wattroom/issues/1106).

**Two ban levels may be one too many.** §16.4: Discord has no per-channel ban
at all; exclusion from a channel is a deny in the same permission system as
everything else. *Settled in the third amendment below — both levels stay, and
the single expression is what fixes the forgettable guard.*

**Also from §16.2**: the single permission expression the cutover needs should
be a **SQL view** every gate and visibility join selects from, so a new join
that forgets it fails to compile rather than silently over-permitting. *The
third amendment below promotes this from advice to a requirement.*

## Amendment, 2026-09-08 (#1106): a crew has an owner

The decision above named crew *admins* and no un-removable actor, so two admins
could demote each other with nothing stating who still held the crew. §16.5
found no product with that shape: Discord's permission lockout is a documented,
*recoverable* state precisely because the server owner sits outside the
permission system. This settles it, ahead of the design (#1023), because it is a
question about the model rather than about how the tree is drawn.

**A crew has exactly one owner.** They cannot be demoted, removed or banned by
anyone, and they can always reach the crew's and its rooms' permissions. That is
the whole of the guarantee: it exists so that no configuration of roles can
leave a crew with nobody able to fix it.

**The owner is not a super-reader.** They gain no ability to read a room's
contents without joining it — the same line this ADR already draws for crew
admins, and deliberately stricter than Discord, whose `ADMINISTRATOR`
*"overrides any potential permission overwrites"*. The anti-lockout guarantee is
about **permissions, not contents**, and keeping those separate is what stops a
crew owner becoming a way to read every room in the crew.

Note the consequence this shares with crew admins, stated rather than hidden:
a crew owner can re-grant themselves permissions in a room whose own owner
excluded them. That is inherent in having any actor above the room, it is
already true of admins under "crew admins manage room permissions", and the
owner only adds that nobody can take the power away.

### The migration supplies the row

One crew per existing room owner, named after them — so **that person is the
crew's owner**, and no backfill has to invent one.

### Deletion is the part that forces the design

Room ownership does not transfer today (`rooms/rooms.go:777`) and
`rooms.owner_id` is `on delete cascade` (`00001_init.sql:26`), so deleting an
account deletes the rooms it owns. That is coherent for a room: it is one
person's, and WATTROOM.md's *delete-account (full purge)* promise is worth more
than the room.

**It is not coherent for a crew**, because a crew holds rooms *other people
own*, and this ADR binds a room to its crew permanently. A crew that cascaded
with its owner would destroy other people's rooms, and those rooms cannot be
moved out of the way first. Three options, and canon rules out two:

- **Cascade** — rejected. One person's account deletion would take other
  people's rooms with it.
- **Refuse the deletion while they own a crew** — rejected. WATTROOM.md locks
  export-all and delete-account as a privacy promise; a crew must never become
  a reason a rider cannot leave.
- **Transfer, and delete the person** — the only option left, and therefore the
  decision.

So: **crew ownership transfers, and on account deletion it transfers
automatically.** The purge still removes the person and the rooms they own
personally, exactly as today; the crew survives with a new owner. Deliberate
transfer while alive must also exist, or the only way to hand a crew over is to
delete your account.

Who receives it is `docs/SPEC.md`'s to state rather than this ADR's to invent —
the constraint is only that the rule must always name somebody, and must not be
able to pick the departing owner. The same rule applies when an owner leaves
every room in the crew, which is how they leave the crew at all, membership
following room membership.

A crew whose rooms are all gone has no members and nothing to own; it is
deleted rather than left ownerless.

## Amendment, 2026-09-08 (#1106): bans stay at two levels, read through one expression

[RESEARCH.md §16.4](../RESEARCH.md) argued the other way, and this amendment does
not take its recommendation. §16.4 is right about Discord — there is no
per-channel ban, and channel exclusion is a `View Channel` deny overwrite in the
same permission system as everything else — but the inference does not transfer,
for three WattRoom-specific reasons that pass did not check.

**1. It would silently grant a power this ADR explicitly denies.** The decision
above lets a crew admin who has not joined a room *"manage its permissions and
see it listed"* while forbidding them to *"rename it, **ban from it**, delete
it, or read its contents"*. Collapsing the room ban into the override mechanism
makes those two the same operation, so a non-member crew admin could eject
someone from a room they have never entered by setting an override — exactly the
power that sentence withholds. Discord has no such line to protect: its
`ADMINISTRATOR` bypasses every overwrite anyway, so nothing there rests on the
distinction this design is built on.

**2. A ban is not only state.** `docs/SPEC.md`: a ban *"survives rejoin via link
or code, **severs the live socket and voice on the spot**, and only the owner
sees the ban list"*. The middle clause is imperative — a permission override is a
fact a later query reads, while a ban also *does* something at the moment it is
applied. Collapsing the two either loses that or smuggles an action into the
permission layer, and the second is worse than the duplication it saves.

**3. It would move a room owner's power to the crew.** SPEC's roles matrix puts
*remove / ban / unban member* on the owner's column alone. If exclusion becomes
an override, then whoever manages room permissions may exclude — which is crew
admins. That is a change to who moderates a room, not a refactor, and nothing in
the crew model asks for it.

### What actually fixes the defect §16.4 points at

Its evidence is real: [#1109](https://github.com/natrontech/wattroom/issues/1109)
and [#1114](https://github.com/natrontech/wattroom/issues/1114) are four separate
joins that each forgot `role != 'banned'`, at *one* level. But the failure is not
that there are too many kinds of ban — it is that the guard is written out by
hand in every query needing it, so a new join can omit it and nothing fails.

**The count of levels is not what makes a guard forgettable; the count of places
it is written is.** So the answer is §16.2's single expression, and it is now
load-bearing rather than advice: **one `rooms_visible_to`-style view is the only
place allowed to answer "is this person excluded here", and it reads both
levels.** A join that forgets it selects from a table that is not there — a
compile error instead of a silent widening. That retires the whole class at
either level count.

### The decision, and how the levels relate

**Both levels stay.** A room ban is what it is today: a `memberships` role, set
by the room's owner. A crew ban is new, set at the crew, and removes a person
from every room in it and prevents rejoining.

- A crew ban **implies** exclusion from every room in the crew. A room ban
  implies nothing at the crew.
- **Lifting one does not lift the other.** Unbanning at the crew restores nothing
  a room owner decided; unbanning in a room does not readmit someone the crew
  banned. Separate decisions by separate people, and neither may silently
  overrule the other.
- A crew ban carries the same imperative half at crew scope: it severs live
  sockets and voice in every room of the crew when it is applied.

**Accepted cost.** The view's definition is more complex than one predicate, and
it becomes infrastructure the whole cutover depends on. That is the trade —
complexity concentrated in one tested place rather than spread thin across every
join, which is the arrangement the four bugs argue for.

## Amendment, 2026-09-08 (#1106): `rooms.crew_id` stays nullable for one release

The migration paragraph above says `crew_id` is added nullable, backfilled, and
*"only then constrained, all inside the one release"*. **That is wrong**, and
[ADR-0019](0019-tagged-releases-and-a-self-converging-vm.md) outranks it.

The previous release's `CreateRoom` inserts `(code, slug, name, owner_id)` and
knows nothing about the column. A `not null` with no default therefore leaves a
rolled-back image **unable to create any room at all** — and ADR-0019 is
explicit that nullable-only is *"the single load-bearing rule of the whole
document... the only reason retagging to `PREVIOUS` is safe"*. Constraining in
the same release trades the rollback path for a schema tidiness that nothing
needs yet.

So: **`crew_id` is added nullable and stays nullable for this release.**
Crewless rooms are forbidden in code from the cutover — every creation path
sets it, and the backfill leaves none behind — and the `not null` is the
contract half, one release later, exactly like `identities.refresh_token`
([#1038](https://github.com/natrontech/wattroom/issues/1038)).

Nothing else in that paragraph changes: the backfill, the one-crew-per-owner
rule, and the rollback-loses-the-crew-layer-not-the-rooms property all hold, and
they hold *better* with the column nullable.

Two related columns follow the same reasoning and are called out because they
are easy to get backwards:

- **`rooms.crew_visible` defaults to `false`**, which is both the privacy-safe
  value (the first amendment's existing-rooms-migrate-private rule) and the one
  that lets a rolled-back release keep creating rooms.
- **`crews.owner_id` is `on delete restrict`, never `cascade`.** `rooms.owner_id`
  cascades, which is right for a room and fatal for a crew holding other
  people's rooms. Restrict makes a purge that forgot to transfer ownership fail
  loudly instead of leaving an ownerless crew.
