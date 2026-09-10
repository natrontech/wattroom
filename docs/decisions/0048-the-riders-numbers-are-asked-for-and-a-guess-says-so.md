# 0048 — The rider's numbers are asked for, and a guess says it is one

- Status: accepted
- Date: 2026-09-10

## Context

`users.ftp_watts` has defaulted to 200 and `weight_kg` to 75 since
`00001_init.sql`, and until #1484 nothing in the first hour asked. The
first-run card's steps were "Pair your trainer", "Name your crew", "Invite
someone"; the only FTP prompt in the app was post-hoc — the suggestion off a
90-day power curve, which needs 90 days of rides first.

FTP is not one number among many. Every workout target is a fraction of it,
and so are the execution score, the XP bonus, the category, the training load
and every later FTP suggestion (docs/SPEC.md); weight is the denominator of
every w/kg the app prints and every contest it scores. A rider who was never
asked rode `sweet-spot-2x20` at `0.9 × 200 = 180 W` and banked a season of
stats anchored to a number nobody chose — printed on Home in the same display
type, with the same authority, as a ramp-measured one.

The 95 % rule (`.claude/rules/ux.md`) pulls both ways here: nobody wants a
form on minute one, and nobody wants a season of stats built on a placeholder.
Four options were on the table (#1484) — label the guess; add a first-run
step; ask before the first workout; do nothing.

## Decision

**Ask, in the first-run card, and never gate.** A fourth step above "Take your
first ride" asks for FTP and weight, prefilled with the 200 W and 75 kg the
account already holds — keeping them is a valid answer. It is a form in place,
not a modal and not a wall: a rider who ignores it rides anyway.

**Every such number carries where it came from.** `users.ftp_source` and
`users.weight_source` hold `default` (nobody chose it — the account was
created with it), `manual` (the rider set it, by typing it or accepting a
suggestion) or `ramp` (a ramp test measured it), and `/api/me` carries both.
The source is what makes the step's "done" knowable and what makes the honesty
below possible; inferring it from "is the value still 200" is not the same
question and gets a rider who genuinely rides 200 W wrong.

**While the source says nobody chose it, the app does not present the number
as a measurement.** Home's FTP tile says "a starting guess, not a
measurement", and w/kg — two guesses divided by each other — is withheld until
at least one of the pair is the rider's own. The profile field says the same
thing where it is fixed.

A write only claims a source when a client says so outright: the first-run ask
and the ramp test's save do, and every incidental PATCH of the profile — the
Strava toggle, the email form — leaves the source alone even though it sends
the current numbers back. Otherwise a changed value is read as the rider's
own. Nothing can claim `default`: that word is the server's, for an account
nobody has answered for.

## Consequences

- The first hour asks the one question that decides whether a season of
  numbers means anything, in the place riders already read set-up steps.
- Provenance is a column, so any later surface — PreRide, a coach's view of a
  rider, an export — can ask the same question instead of re-deriving it. It
  also gives the ramp test a reason to exist beyond "a better number": it is
  the difference between `manual` and `ramp`.
- Riders who skip the step are not lied to, which is what stops the decision
  from being defeated by the 95 % who skip a form. It also means Home shows
  no w/kg at all for a brand-new account — accepted: no number is better than
  a fiction with a decimal point.
- Existing accounts were backfilled from the only evidence there is — a row
  still holding the exact default reads as `default`, anything else as
  `manual`. A rider who genuinely weighs 75 kg is told their weight is a guess
  until they save it once. The other direction would tell a rider their
  untouched 200 W was measured, which is the bug this ADR closes.
- Three words is a vocabulary, not a taxonomy. Accepting the 90-day
  suggestion records `manual` rather than earning a fourth value; if
  provenance ever needs to distinguish "measured off my own rides" from "typed
  in", that is an amendment here and one more allowed value in the CHECK.
- Revisit if the ask turns out to be skipped by most new accounts anyway
  (the label carries it, but the step is then failing) or if riders answer it
  with a number they have no way to know — at which point the ramp test, not
  a longer form, is the thing to put in front of them.
