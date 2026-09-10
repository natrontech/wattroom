# 0036 — What a room shows about its members: sums, your own turnout, and no default ladder

- Status: accepted
- Date: 2026-09-08
- Extends: [0024](0024-social-profiles.md) and [0013](0013-room-identity-and-moderation.md)
- Sits beside: [0034](0034-a-session-leaves-one-recap.md), which settled the same
  question for a session's presence card and drew the line this follows
- Constrained by: WATTROOM.md's locked privacy rules — metrics room-scoped,
  rides private by default, no public leaderboards
- Answers: [#995](https://github.com/natrontech/wattroom/issues/995), the first
  of the two decisions [RESEARCH.md §14.9](../RESEARCH.md) says block it

> **Amended by [#1100](https://github.com/natrontech/wattroom/issues/1100)
> (2026-09-08):** the per-rider board opt-out this ADR deferred now exists, as
> `memberships.on_board`. The rejected alternative below named its own
> condition — *"rejected as premature: with no board shipped yet there is
> nothing to consent to … if per-rider opt-out proves necessary, it is an
> amendment with a migration, not a rewrite"* — and the board shipped. The
> room-level opt-in is unchanged and still the first gate; this is the second.
> Default `true`, so no existing member's experience changed.
>
> **Why it proved necessary.** The room-level switch answers this ADR's own
> first bullet — *"being in a room must not put a rider on a board"* — for
> somebody **joining**. It does not answer it for everybody already inside
> when the owner turns the board on, which is the same "enrolment by
> existence" trap one level up, and it is the level at which Garmin's
> mandatory group challenges actually bite: nobody joins a challenge, they
> find they are in one.

> **Amended by [#1651](https://github.com/natrontech/wattroom/issues/1651)
> (2026-09-10):** *"turned on … visibly"* is honoured **at the join door**, and
> was not. `boardEnabled` was set only in the members-only branch of the room
> read, so the outsider view never mentioned a board: a rider walking into a
> room whose board was already on had their week published to the room without
> the door ever having said the board existed — this ADR's own "enrolment by
> existence", arriving through the one path the room-level switch was supposed
> to close. The flag now reaches any rider the door would let in, and the
> door's copy names what the board publishes and where the per-rider switch
> above lives (`$lib/room/door.ts`).
>
> **The fact, not the rows.** `board` stays a member's — knowing that a room
> keeps a board is not reading it — and the flag reaches only a rider who could
> walk in, because [0039](0039-the-public-room-directory-shows-a-door-not-a-window.md)'s
> asymmetry keeps what anybody else learns about a room as narrow as it is.
> The **directory** entry is untouched and stays a name, an icon and a link.
>
> **Not a door-time toggle**, which was the tempting third option. `ux.md`'s
> 95% rule: a rider who reads the line and presses the button wants to be on
> the board, and the #1100 amendment above already gives the rest the switch.
> A second control at the door would be a preference where a default plus a
> sentence does the job.
>
> **Known and not fixed here:** the per-rider opt-out does not survive leaving.
> `DeleteMembership` removes the row `on_board` lives on, so a rider who
> switched themselves off, left, and walked back in is on the board again with
> the column at its default — and the undo on "You left <room>" is the likeliest
> way to hit it. Remembering a preference past the membership that holds it
> needs somewhere to keep it, which is a schema decision and an amendment of
> its own rather than a line in this one.

## Context

A room's page showed four tiles — riders, streak, this month, medals. For a
crew that rides together every week, that says almost nothing about the crew.
The obvious fix is a leaderboard, and [RESEARCH.md §14](../RESEARCH.md) exists
because picking that by taste is how a friendly room turns into a ladder nobody
enjoys.

The research is unusually one-directional, and two findings do most of the work:

- **Zwift will not run "Keep Everyone Together" and Event Results at the same
  time.** The social-indoor incumbent, holding the largest mixed-ability dataset
  in the category, treats *riding together* and *ranking each other* as mutually
  exclusive modes (§14.1). That is a design decision, not a technical limit.
- **A standing crew cannot re-randomise.** Every product with a leaderboard
  survives a stable ordering by resetting, capping, or re-drawing the pool —
  Duolingo's leagues are 30 *randomly assigned* users, Strava clubs reset
  weekly. The same six people are in this room next week, so the permanent last
  place is a configuration none of the cited products has to survive (§14.3).

And one shape is unoccupied ground in every product torn down: the cooperative
total, a whole-group number nobody is ranked inside (§14.1).

## Decision

**A room's numbers are sums over the whole room, plus the caller's own turnout.
Nothing a room shows by default orders its members.**

Concretely, what the room page may carry:

1. **Whole-room sums** — hours ridden together, sessions this month against the
   room's own last month, the streak, the month's collective kJ. Cooperative by
   construction: no rider is inside any of them, so there is nothing to consent
   to beyond membership itself.
2. **The caller's own turnout** — the last twelve sessions, filled where *you*
   were there. Yours and nobody else's. A strip that can only describe the
   person reading it cannot become a ladder, which is what §14.8 asks for when
   it says "describe, never grade".
3. **Nothing else derived from another member's rides**, by default. No
   per-rider kJ, watts, w/kg, execution, or duration on any room surface.

### An ordered board is opt-in, and off until a coach turns it on

[#995](https://github.com/natrontech/wattroom/issues/995) decided a room *has* a
ladder. This decides its terms, on the research's recommendation (§14.4, §14.7
item 6):

- **Off by default.** Being in a room must not put a rider on a board —
  "enrolment by existence" is §14.8's first trap, and Garmin's mandatory group
  challenges (which have a support article titled *"I Am in a Garmin Connect
  Challenge I Did Not Accept"*) are the shipped counter-example.
- **Turned on per room, by the owner, visibly** — the WHOOP Teams pattern: what
  the room shares is fixed and legible *before* anyone is inside it. The owner
  rather than a coach because `docs/SPEC.md`'s matrix already puts *edit room*
  there and a coach runs sessions; what a room discloses about its members is
  not a session-running decision.
- **Weekly reset, no accumulating history.** Strava clubs show this week and
  last, and that is what keeps a bad week from being permanent.
- **Bracketed by Category**, which is a bracket rather than a rank: it says who
  to compare with, which is the useful half (§14.4).
- **Never the room's front page.** The consistency tiles lead; a board sits
  below them and is reachable rather than unavoidable.

### Why the tiles need no consent set and the board does

[0034](0034-a-session-leaves-one-recap.md) drew this line for the session recap
and landed on **presence and time only** — no watts, no kJ, no execution, no
heart rate. The tiles here stay on that side of it without needing a per-rider
consent set, because they disclose no individual at all: a sum over six people
is not a fact about any one of them, and your own attendance is not a fact about
anybody else.

A board is the other side of the line. It publishes one member's ride-derived
number to the rest of the room, and a ride is **private by default**. The
argument that everyone in the room watched it happen live is exactly the
argument 0034 had to make for presence — which is why it needed an ADR, and why
a board needs the opt-in rather than inheriting the tiles' reasoning.

## Consequences

- The riders count and the medals count leave the lounge grid. Neither is lost:
  the roster is on the same screen and the members page is where a medal's owner
  is legible anyway.
- **Streak** and **consistency** become `docs/SPEC.md` glossary terms in the
  same change, as §14.6 requires — both were doing load-bearing work with no
  definition, and *consistency* in particular was at risk of being coined
  differently on each surface.
- The room's stats stay a **read of `rides`**, room-scoped by `room_id`. No new
  table, no new consent record, nothing to migrate — which is what makes this
  decision cheap to revisit if the opt-in default turns out to be wrong.
- **A session is a day, not a ride.** Six riders in one evening is one session.
  Anything counting sessions counts distinct days, or it will flatter a room
  in proportion to its size.
- This does not settle whether *consistency* is a thing that travels off a room
  the way [0027](0027-an-earned-badge-travels-progress-stays-home.md) lets
  badges travel. §14.9 item 3 raises it; nothing here needs it answered.

## Alternatives considered

**A ladder on the room's front page, as first drawn.** Rejected on §14.1's
Zwift finding and §14.8's trap list. The mockup put consistency above it, which
is the right order — but "below the fold" is not the same protection as "off
until someone asks for it", and the crew that most needs the second is the one
least likely to scroll past the first and object.

**No board at all.** Defensible on the research alone, and cheaper. Rejected
because #995 decided the room has one, and because §14.4's own recommendation
is *cooperative by default, ordered board opt-in* rather than *never*.

**A per-rider consent flag on `memberships`.** Rejected as premature: with no
board shipped yet there is nothing to consent to, and a stored consent record
that nothing reads is worse than none. When the board lands, the room-level
opt-in above is the smaller thing that does the job — and if per-rider opt-out
proves necessary, it is an amendment with a migration, not a rewrite.

> **This is what happened** (#1100): the board landed, the flag stopped being
> a record nothing reads, and the amendment is `memberships.on_board` with
> `RoomWeekBoard` filtering on it. The reasoning above is kept rather than
> rewritten — being right about the *sequence* is why the column exists now
> and did not exist then.
