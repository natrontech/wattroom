# ADR-0047: Deleting a ride keeps its XP

- Status: accepted
- Date: 2026-09-10
- Settles: [#1452](https://github.com/natrontech/wattroom/issues/1452) — from the 2026-09-09 stats audit
- Constrains: [ADR-0027](0027-an-earned-badge-travels-progress-stays-home.md) — the level the badges hang off

## Context

Two locked things did not agree with each other, and the stats audit found the
seam.

[docs/SPEC.md](../SPEC.md)'s glossary says a level "only goes up, earned by work
done", and [ADR-0027](0027-an-earned-badge-travels-progress-stays-home.md)
hangs a rider's whole visible play off that number: the badges are "the
substance the level is an aggregate of", and the level is what a room-mate sees
on a rider page. Meanwhile lifetime XP is `user_total_xp` — `sum(rides.xp)` plus
the `xp_events` ledger (#467) — and `DELETE /api/rides/{id}` is a hard delete,
because a ride the rider threw away is gone and its samples are not kept
anywhere else.

So a rider who deleted one ride lost that ride's XP out of the sum and dropped a
level on every surface that draws one: their own header, their rider page, a
room's members list, a DM head. The achievements they had already earned stayed
— those are rows in `achievements` — so the level and its badges contradicted
each other, which is the one thing ADR-0027's argument cannot survive.

Three ways out were on the table (#1452):

- **(a)** On delete, write an offsetting `xp_events` row: a new source, amount
  equal to the deleted ride's XP, so the ledger keeps the work as done.
- **(b)** Soft-delete: keep the row's summary columns and hide the ride.
- **(c)** Amend SPEC: a deleted ride takes its XP with it, and levels can fall.

## Decision

**(a). Deleting a ride deletes the record of the ride, not the fact that it was
ridden.** The delete stays hard, and the same statement writes one
`xp_events` row with `source = 'ride_deleted'`, `amount` = the deleted ride's
`xp` and `ref` = the deleted ride's id. The ride leaves `sum(rides.xp)` and the
ledger row puts the same number back, so `user_total_xp` — and every level
computed from it — comes out exactly where it was.

The reasoning is the one the product already runs on: the ride *was* ridden.
Deleting it is a privacy act, and privacy is not time travel. A rider removing a
record they would rather not keep is not asking to un-ride the ride, and nothing
in WATTROOM.md's privacy rules is served by taking their level with it.

**(b) was rejected**: privacy is architecture. A "deleted" ride that still
exists as summary columns is a ride WattRoom still holds after the rider told it
not to, and the next question — which surfaces honour the hidden flag — is a
question we would have to get right forever. Hard delete has no such question.

**(c) was rejected**: it is the cheapest change and the wrong one. Levels that
fall make ADR-0027's badges incoherent — a level 6 rider wearing a badge only
level 8 could have earned — and it would punish the rider for using the privacy
control we gave them.

**One statement, not two.** The delete and the offsetting row are a single
`with gone as (delete … returning …) insert into xp_events …`, so a partial
failure cannot lose either half: there is no window in which the ride is gone
and its XP is not back. The ledger's existing `unique (user_id, source, ref)` on
the ride's own id is what makes a replay impossible to double-count.

## Consequences

- The arithmetic is a wash by construction: `(S − xp) + (L + xp) = S + L`. A
  zero-XP ride writes a zero-amount row, which the ledger already allows and
  already does for `sprint_win`, `dj_track`, `coached` and `game_win`. Two
  deletes write two rows under two refs.
- The trophy case's `xp.rides` bucket becomes *rides plus the offsetting rows*.
  That number is hand-summed into `xp.total` alongside lounge, sessions and
  achievements, and leaving the offsets out would have made the case's Lifetime
  figure disagree with the level beside it — the same bug one layer up.
  "Riding" is the honest label: the offsets are riding XP.
- A rider who deletes every ride they ever saved keeps their level. This is
  intended, and it is not a cheat: the ledger row is only ever written *from* a
  ride that existed with that XP.
- `ride_deleted` joins the `xp_events_source_check` vocabulary by an
  expand-only migration ([ADR-0019](0019-tagged-releases-and-a-self-converging-vm.md)):
  widening a check constraint is safe to run under the previous image, which
  never writes the value. Roll back and levels stay right — `user_total_xp`
  reads the whole ledger regardless of source; only the trophy case's Lifetime
  row would read low for a rider who deleted a ride under the newer image.
- No achievement may ever be defined on this source. It counts rows and pays
  XP, but "rides you deleted" is not work, and the badge catalogue measures
  work. `bySource` is keyed by source, so the existing counts are unaffected.
- Revisit trigger: an XP source that can legitimately be *revoked* — a
  retracted sprint win, a ride found to be a duplicate. The ledger's `amount`
  is `>= 0` by constraint, so there is no negative row today, and this decision
  is not the precedent for one: it is an offset, and the sign points the same
  way the level does.
