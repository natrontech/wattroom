# 0080 — A crew's season is a tour, never a league

- Status: accepted; settles [#3277](https://github.com/natrontech/wattroom/issues/3277)
- Date: 2026-09-29
- Amends: [0036](0036-what-a-room-shows-about-its-members.md) — point 3, "nothing else derived from another member's rides, by default": a member may opt in, and the default stays off
- Keeps: [0047](0047-deleting-a-ride-keeps-its-xp.md) (a deleted ride's work stays in its rider's ledger, not as a record), [0067](0067-racing-on-a-road.md) (results on the closing card only)
- Beside: [0062](0062-the-horizon-may-be-a-road.md) (the reference rider, and the famous-climbs library), [0063](0063-a-route-keeps-its-place-with-care.md) (anchors, Strava-origin routes), [0082](0082-a-climb-belongs-to-the-map.md) (stretches)
- Decided on 2026-09-29, when Jan took the recorded recommendation: a tour, never a league, with the opt-in off by default

## Context

A crew wants a season: something that runs for weeks and gives the midweek
ride a reason. The obvious shape is a league, like the ZRL. A league needs
stored standings, which ADR-0067 and ADR-0036 rule out, and a standing crew
never re-randomises, so the same person is last every week (RESEARCH §14.3).

A cooperative tour makes each member's midweek ride matter to a goal they
share. That is the Köhler condition: a group task where every contribution
counts is what keeps the weaker member working, not a ranking they lose.

## Decision

### Stages

- A crew has **at most one running Tour**: an ordered list of **stages**
  chosen by its owner or an admin.
- Stages are **crew routes** above their km-0 anchors (ADR-0063), and
  **library climbs** once #3149 ships. **Strava-origin routes are never
  stages.**
- A stage finish **stamps the crew** and may plan the next session from that
  kilometre (#3103).

### A member opts in

- A member's saved ride counts only if they opted in: **"My rides count for
  ⟨crew⟩"** on the membership, **off by default**, modelled on `on_board`
  (#2432).
- This amends ADR-0036 point 3 without loosening it: nothing is derived from a
  member's rides unless they switch it on.
- **Opting in is not retroactive.**
- The opt-in lives on the **membership**, so leaving takes it with it: a rider
  who rejoins starts opted out.

### Tour metres

- A counted ride adds the **reference rider's distance** at that ride's %FTP
  profile (the #3048 pace model, on the flat). The same relative effort moves
  everyone equally, whatever their size.
- **Zero-watt seconds pay nothing.**

### What Home shows

The **caravan's kilometre**, the next stage finish, and **who moved it this
week** — unordered names of opted-in riders only. **Never a number per
member.**

### Deleting and leaving

- Deleting a ride, leaving the crew or a purge **folds the rows' metres into
  the tour's unattributed total** and deletes the rows. The tour keeps the
  crew's work as a number, never a record about a deleted ride. ADR-0047 keeps
  the work in the rider's own ledger and rejected keeping a deleted ride's
  summary, and in a crew of two to four a timestamped row would name the rider.
- A rider's **export** carries their own contributions.

### The col of the month

The col of the month **rotates entries of the existing library**, so it adds
no content and needs no WATTROOM.md marker; the growing library's one
divergence there is ADR-0062's. Its crew count uses opted-in riders only,
leaves out rides on Strava-origin routes (#3146's precedent), and is hidden
below 3. Its "top half" is the climb's top-half stretch (ADR-0082).

### What a tour never has

**No stored standings, no ordering, and no XP or Batzen** from the Tour
itself.

The numbers are in docs/SPEC.md's "Crew Tour" section.

## Consequences

- A crew has a season that every opted-in member moves, and nobody finishes
  last in it.
- A rider who never opts in is never part of it, and a crew sees only a
  kilometre and a list of names, never who rode how much.
- The tour's total can outlive the rides that made it, as an unattributed
  number and nothing more.
- Implementation: [#3278](https://github.com/natrontech/wattroom/issues/3278)
  (the tour), [#3103](https://github.com/natrontech/wattroom/issues/3103)
  (planning from a kilometre), [#3149](https://github.com/natrontech/wattroom/issues/3149)
  (the library).
