# ADR-0055: A shared ride carries numbers, not words

- Status: accepted
- Date: 2026-09-20
- Extends: [ADR-0024](0024-social-profiles.md) — the list of what a shared ride shows a friend

## Context

A finished ride now carries two things the rider says about it rather than the
trainer: an RPE and a free-text note (#2328, docs/SPEC.md "How a ride felt").
Everything a ride held before was measured — watts, seconds, kJ, an execution
score — and every existing privacy rule was written about measurements.
`rides.shared_at` is a per-ride opt-in that reveals a ride to accepted friends
(ADR-0024), and it was designed when the only thing a ride could reveal was
numbers.

Free text is a different kind of thing. "Legs were dead, third day on" and "row
with my partner, rode it off" are the notes riders actually write, and the
rider who flips a ride to shared is thinking about their watts. A switch whose
meaning quietly grows to cover a diary entry is the kind of privacy failure
nobody notices until it has already happened — and `shared_at` is set in one
statement with no chance to ask.

It also has to be decided before the column exists rather than after: once a
note has travelled to one friend's screen it has travelled, and no later
narrowing takes it back.

## Decision

**A ride's note is the rider's own, and no sharing switch in the product
carries it.** It is served only by the owner-scoped reads a rider makes about
their own ride — `GET /api/rides/{id}`, which is already keyed on
`user_id` — and by the account export, which is that rider asking for their own
data (ADR-0053, Art. 15). It is not in `ListSharedRides`, not on a rider's
page, not in a room, not in a session recap, not on the ride card image, and
not in the FIT file or the Strava upload: what leaves for Strava is the ride we
recorded, and the note is not part of it.

**The RPE travels no further than the note does, for now, but for a weaker
reason.** It is a single number and it would not be absurd to show a friend,
and it is left off every shared surface only because nothing has asked for it
and adding it is a product decision rather than a consequence of this one. The
note is private by architecture; the RPE is merely unexposed. A future ADR may
move the RPE. It may not move the note.

**The projection is the enforcement.** `ListSharedRides` and every other
non-owner read of `rides` names its columns explicitly, so a new column is
invisible to them by construction — the leak would take an edit, not an
omission. `GetRide` is the one `select r.*` and it is owner-scoped in its where
clause. A test rides a second, friended account at a shared ride and asserts
the note is not in the answer.

## Consequences

- The note is safe to write candidly, which is the only condition under which a
  rider writes one at all. A feature nobody trusts is a column full of "good
  ride".
- A rider who wants to tell a friend how a ride felt has to tell them; the app
  will not do it. That is the trade, and it is the right way round for the
  first version.
- Any later surface that reads a ride — a crew feed, a coach view, a recap —
  starts from "the note is not in this" rather than from a column list it has
  to remember to trim.
- `select *` on `rides` outside an owner-scoped query becomes a defect, not a
  shortcut. There is one today and it is owner-scoped.
- The revisit trigger is riders asking to show an RPE, not a note. If the ask
  is for the note, the answer is a different feature — a ride comment a rider
  writes knowing who reads it — and not this column loosened.
