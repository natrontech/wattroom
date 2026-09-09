# Audit — the durable-privacy surface — 2026-09-08

Run against main @ `6b9d5ce3`. Read-only: nothing was changed, and nothing was verified in a
running app.

**Produced one issue, [#1153](https://github.com/natrontech/wattroom/issues/1153).** The rest is
the *solid* half, recorded so the next audit does not re-derive it.

## The brief

Slice: **what WattRoom keeps about a person after the ride ends** — session recaps (ADR-0034), the
account export, and account deletion.

Chosen because the [riding-path audit](2026-09-08-riding-path.md) earlier the same day named
`internal/recap` as uncovered, and both prior audits had left it alone: the
[hub/protocol pass](2026-09-08-hub-protocol.md) said it read `recap` only where the tick hands off
to it, and the [2026-09-04 pass](2026-09-04-non-riding.md) predates the table by three days. It is
also the slice where a defect is a privacy failure rather than a bug.

Excluded: the riding path and the rooms/crew surface (both swept the same day), the hub, and
credential sealing — [#1038](https://github.com/natrontech/wattroom/issues/1038) owns that and is
correctly blocked on a production check.

## The finding

**[#1153](https://github.com/natrontech/wattroom/issues/1153)** — recaps are pruned only when a
session ends, so a room or an instance that goes quiet keeps them past the promised 90 days.

The interesting part is *why* it was written that way. `queries/recaps.sql` justifies itself by
analogy: *"Swept on write, like `PruneChat` — the table never grows past it."* The analogy does not
hold, and the difference is the finding:

| | bound | self-enforcing on write? |
| --- | --- | --- |
| `PruneChat` | 500 messages per room | **Yes** — only a write can exceed a count |
| `PruneSessionRecaps` | 90 days | **No** — time expires a row with no write involved |

The rows are tiny, so this is not a growth problem; it is a retention-promise problem, and it bites
exactly when nobody is watching.

## What was checked, and found sound

| ADR-0034 promise | Verdict |
| --- | --- |
| Presence and time only — never watts, kJ, execution, HR or a per-rider workout | `protocol.SessionRecapRider` is `{id, rider, from, to, rode}` and the row adds only the workout name and the session's start/end. Nothing in `hub/recap.go` reaches for a metric |
| One interval per rider, not a list | `span` is deliberately one `from`/`to`; a flapping socket draws one bar rather than a comb |
| Readable by the room's **current members** only; leaving ends access | The only read is `recap.List`, called from `chat.handleBacklog`, which is behind `RequireMember` — so it also honours the crew ban added in #1126 |
| Deleting the room takes its recaps | `room_id … on delete cascade` |
| Deleting an account removes that rider's interval from every recap naming them | A `before delete on users` trigger, atomic with the delete because nothing here runs in a transaction. Tested against the rows themselves at `account_test.go:367`, including that another rider's interval survives |
| A session that never started leaves nothing | `tick.go:176` — `len(rm.present) > 0`, and `present` is only filled while a session runs |
| Kept 90 days | The bound exists and is one constant (`recap.RetentionDays`); **when** it runs is #1153 |
| Export (GDPR Art. 15 / revFADP Art. 25) stops at what the rider can already see | `ExportUserRecaps` narrows to the requester's own interval — other riders' intervals are their personal data, not the requester's |

The recap payload holding a **user id** rather than only a display name is what makes the account
purge possible at all, and the migration says so. It is the kind of decision that looks like a
privacy cost and is the opposite.

## What was not covered

`internal/recap` has no test file of its own — `SaveRecap` and `List` are exercised only indirectly
through the account and chat tests. That is a coverage observation, not a finding: no promise names
them and no user hits them directly.

Also untouched: the Strava upload path (still uncovered by any audit), `chat_images`' 15-minute
grace beyond noting in #1153 that it shares the on-write shape, and the credential/session half of
`internal/auth`.
