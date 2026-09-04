# ADR-0027: An earned badge travels with the rider; progress stays home

- Status: accepted
- Date: 2026-09-04
- Extends: [ADR-0024](0024-social-profiles.md) — the page it lands on, and the audience that already gates it

## Context

Achievements shipped with the gamification (#467): ten catalogue entries, each
a threshold the server can verify, each paying XP into the ledger. They are
rendered in exactly one place — `/trophies`, your own — and the rider page
`/u/{id}` does not show them at all. `GET /api/riders/{id}` does not even
return them.

So the level is the only thing anyone can see of another rider's play. A
number with no receipts: "level 4" says nothing about whether that rider
coaches every week, DJs the room, or turns up at 6am. The operator's ask was
to make levels worth taking seriously and let riders flex with room-mates and
friends; the badges are the substance the level is an aggregate of, and nobody
can see them.

ADR-0024 settled who may look at a rider page, and set the rule for what it
shows: *what a room already shows them* — "the page collects them, it does not
extend them". Achievements are the first fact that has no room to be collected
from. Unlike a medal, which is won in a room and stays in that room, an
achievement is account-lifetime and earned across every room a rider has ever
been in. There is no room-scoped version of "200 Rides". So this is a genuinely
new visibility class, and WATTROOM.md's privacy row is locked — it has to be
decided rather than assumed.

The catalogue is not uniform, which is the whole difficulty:

- **Habit**: Sunrise Club (5 rides before 07:00), Night Shift (5 after 23:00).
- **Volume**: 200 Rides.
- **Effort**: Sufferfest Survivor (45 min at or above FTP), Hot End (3 min in
  Z6), Espresso Ride.
- **Social**: Lounge Lizard (10 h in voice), DJ (50 tracks played to the end),
  Crew Chief (coach 20 sessions), Sprint Snob (win 10 sprints).

## Decision

**An earned badge is visible to everyone the rider's page already opens to.**
No new audience: ADR-0024's gate is unchanged — a shared live room, an accepted
friendship, or a pending request *from* the rider; everyone else still gets the
same 404 an unknown id gets. The badge travels because it is identity, the same
argument that already carries the level and lifetime XP onto that page.

**A badge is a binary, and only a binary.** Earned or not earned. Never the
value that earned it, never the margin, never a rank against anyone. "Sufferfest
Survivor" says a rider once held FTP for 45 minutes; it does not say for how
long, how often, or how that compares. This is what keeps it inside
WATTROOM.md's rule that numbers do not leave the room: a threshold that was
crossed is not a measurement, and no watt, heart rate or weight escapes with it.
Heart rate stays where ADR-0008 put it, untouched by this ADR — no achievement
may ever be defined on HR.

**Progress toward an unearned badge is private, always.** `/api/me/trophies`
already answers with `earnedAt` **or** `progress`; a rider page returns the
earned entries only, and the field is absent for the rest. "3 of 5 rides before
07:00" is a trace of somebody's current week — the live pattern, not the
finished fact — and it is exactly the reading the earned badge is careful not to
give. Your own trophy case keeps its progress bars; nobody else's does.

**No completion score, and no ranking outside a room.** A rider page shows the
badges earned, not "7 of 10" and not a percentage. A count across the whole
catalogue is an app-wide ladder wearing a smaller hat, and WATTROOM.md allows
ladders **only inside a room**. Ordering room members by their trophies on a
room's own surface is therefore fine — that is the room's crew comparing itself,
which the product exists for; a global "most decorated riders" list is not, and
must not be built.

**No opt-out.** The 95% rule (`.claude/rules/ux.md`): a badge is earned to be
shown, and a setting for hiding it would be a switch almost nobody moves,
guarding something the level already implies. Rides stay private by default as
they always were — a ride is a record of a session, a badge is a fact about a
rider, and the two are not the same object.

## Consequences

- `GET /api/riders/{id}` gains the earned achievements; the shape is the
  existing `achievementJSON` with `progress` omitted, so the web side reuses
  `TrophyShelf` in a read-only mode rather than growing a second renderer.
- The rider's own page renders through the same endpoint (ADR-0024's
  `friend: "self"` honesty), so a rider sees their badges exactly as a
  room-mate does — with their own progress bars living on `/trophies`.
- A room's Members place may sort and compare its own members' badges. Nothing
  outside a room may.
- Habit badges (Sunrise Club, Night Shift) are the sharpest edge here: they
  imply *when* a rider rides. They stay in, because five occurrences across a
  lifetime is not a schedule, and a room-mate can already see them ride. If a
  rider ever objects in practice, the escape is per-badge suppression by the
  earner — not a global toggle, and not a redefinition of the catalogue.
- Revisit trigger: an achievement that cannot be stated as a binary without
  leaking the number behind it. Such an entry does not belong in the catalogue
  while this ADR stands.
