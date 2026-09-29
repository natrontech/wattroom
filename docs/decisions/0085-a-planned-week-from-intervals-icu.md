# 0085 — A planned week from intervals.icu, pulled once, read-only, kept nowhere

- Status: accepted; settles the intervals.icu half of [#2327](https://github.com/natrontech/wattroom/issues/2327) — decided by Jan on 2026-09-29, built in [#3578](https://github.com/natrontech/wattroom/pull/3578)
- Date: 2026-09-30 (decided 2026-09-29)
- Beside:
  - [ADR-0035](0035-stored-credentials-are-sealed-with-a-key-from-the-environment.md): the one third-party credential WattRoom keeps, and why it is write-scoped;
  - WATTROOM.md: our own workout JSON is the model, and `.zwo`/`.erg` is converted into it, never run.
- Canon: AGENTS.md — Strava data never enters a model context, a fixture or an issue; intervals.icu's OAuth announcement — a personal API key is for your own data, and an app used by many people uses OAuth

## Context

A rider with a coach already has a plan, and on most accounts it lives in
intervals.icu. #2327 brought `.zwo`/`.erg` files in through `/workouts/import`
(#2391). Its other half was the plan itself: this week's workouts, without
exporting and uploading them one at a time.

The question the repository could not answer was the credential. There were
two ways in. A personal API key is one paste, but intervals.icu hands it out
for your own data, and it opens the whole account, read and write. That
includes activities, which on most accounts arrive in intervals.icu from
Strava. Holding riders' keys would mean WattRoom stores a credential that can
read Strava Data, and it would be our code's care, not the key, that kept
those out of every export, log line and fixture. The other way is OAuth
through a client WattRoom registers, with a scope as narrow as the job.

## Decision

**One pull, through OAuth scoped to `CALENDAR:READ`.** A "Pull my planned
workouts" button on `/workouts/import` sends the rider to intervals.icu's
consent page. The server exchanges the code, reads the next seven days of
planned workouts (`events`, `category=WORKOUT`, each as `.zwo`), and lets the
token go. `CALENDAR:READ` reaches planned workouts and nothing else, so "never
activities" is enforced by the token rather than by our care. This is
ADR-0035's precedent turned the other way: the Strava token we keep can write
and cannot read; this one can read one thing and cannot write.

**Store nothing.** The token is a local in the callback and is never
persisted. The week waits in memory for 10 minutes, for the rider who asked,
and is read once. After that the pull is gone, and "Pull again" starts over.
There is no sealed column, nothing to revoke, and nothing in the export. What
a rider saves from the week becomes an ordinary workout of theirs.

**A converter, not a second format.** Each pulled `.zwo` goes through the same
importer as a file: previewed in the browser, with what could not be carried
said and never dropped, and bounded by SPEC. It is saved through
`POST /api/workouts`. A pull is capped at 50 workouts and at the importer's own
1 MB a file. An event with no file, one that cannot be read or one over a cap
is counted and named, not skipped in silence.

**Hidden until a client is configured.** Without `WATTROOM_OAUTH_INTERVALS_ID`
and `_SECRET` the section is not drawn, so a click never fails (errors.md).
Registering the client is the operator's step (#3575): it means accepting
intervals.icu's terms on the operator's account.

**Not built:** a standing sync, a background job, an upload to intervals.icu,
or a stored token.

## Consequences

- A rider signs in to intervals.icu on every pull. That is the price of
  holding nothing. If it grates in alpha, keeping the token sealed under
  ADR-0035 is a later amendment, with its own revocation path and export
  line. It is not a quiet change to this one.
- A planned workout edited upstream after the pull does not follow. The rider
  pulls again.
- Tests run against a hand-written fake intervals.icu. No real payload goes
  into a fixture, prompt or comment, the same rule the Strava data follows.
- intervals.icu becomes a service a rider's browser is sent to and our server
  calls, so the privacy page's third parties name it before the client is
  registered.
