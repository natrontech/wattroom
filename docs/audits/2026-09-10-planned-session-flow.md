# Audit: planning a session together, end to end — 2026-09-10

**The flow.** A crew owner plans a group session in a room, the crew hears about it, people say whether they are coming, the moment arrives, the session runs, and afterwards there is a recap — walked as the riders walk it, across the Sessions place and the picker, the sidebar's "next" line, Home's What's next, the calendar feed, the planned-session mail and the hour-before reminder, the in-app notification, the RSVP, the start, the recap, and the server behind each.
**Excluded**: the ride screens, the trainer, chat internals beyond the reminder and recap lines, AV, the jukebox.
**Method.** One Explore agent at `fa20c658`, read-only against WATTROOM.md, docs/SPEC.md, ADR-0020, ADR-0021, ADR-0022, ADR-0030, ADR-0036, ADR-0038, ADR-0042 and the rules; the high and the security finding verified by reading the cited SQL and Go before filing. Nothing was run.

## Filed

By the rule _bug or high_; the phone-owner case went to the open decision #1767 rather than a new issue, and the SPEC row was fixed in this record's PR.

| #     | Finding                                                                                                                                  | Severity                      | Status                                          |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------- |
| #1903 | Moving a session re-arms the reminder, which then mails "in an hour" whatever the gap                                                    | high                          | fixed (#1914): the mail measures the gap        |
| #1904 | A crew ban does not reach the calendar feed or the session mail                                                                          | security                      | fixed (#1914): both queries ask `visible_rooms` |
| #1905 | A started plan is never marked, so it re-offers itself after the ride                                                                    | bug                           | open                                            |
| #1906 | The session-mail switch is offered to an unverified address, and names one of four mails                                                 | bug                           | fixed (#1914)                                   |
| #1907 | The room's chat read from outside drops the start-time reminder                                                                          | bug                           | open                                            |
| #1908 | The Sessions place silently shows only ten plans                                                                                         | bug                           | open                                            |
| #1909 | "Start now" reads the browser clock while the timeline reminder reads the server's                                                       | bug                           | fixed (#1914)                                   |
| #1910 | A rider who said they are in hears nothing when the session starts                                                                       | not built (ADR-0042 names it) | open                                            |
| #1911 | Polish: the cancel confirm's mail promise, the picker's dead room chooser and unprefilled move, Home's What's next with nothing to press | low                           | open                                            |
| #1767 | Decision: an owner on a phone is shown the member's empty state and cannot plan                                                          | decision                      | `needs-human-input` (case added)                |

Fixed here: docs/SPEC.md's roles row gave the phone spectator a `–` for "say you are in"; the button and the handler both allow it, and an RSVP is a statement of intent, not a capability of the device.

## The flow as it stands

1. **Plan** — sidebar → room → Sessions → the picker (shelf grouped recent/suggested/yours/library, seven day chips or a date, a time box); the server validates the name, the workout JSON and the window (now−1 min to +3 months). The seams: an owner on a phone never sees the button (#1767); a room chooser survives from the retired cross-room planner (#1911).
2. **The room hears** — a "planned" line on the timeline and a presence ping, so every rail re-fetches: the sidebar's "next: …", Home's What's next, the room's own list. Only the first plan per room reaches Home (#1693).
3. **The rider hears** — mail per rider's timezone with one-click unsubscribe under a per-room budget; the ICS feed carries it to any calendar. The switch used to accept a pending address (#1906); a crew ban used to stop neither (#1904).
4. **RSVP** — any member, no maybe; the first four names and a count; the room reloads after your own action, everyone else on the next ping.
5. **The moment** — an hour out the reminder mails; ten minutes out a "due" line lands in the room's chat on the server clock; fifteen minutes out "Start now" appears for the coach — on the browser clock until #1909. The reminder is missing from `/messages` (#1907); a rider not in the room gets no start-time push (#1910).
6. **Start** — `pick` then `start`; nothing marks the plan (#1905). A late rider joins the running session from the Lounge or Training.
7. **After** — the tick builds the recap from sampled presence, one row upserted, posted back as a collapsed card in the timeline and under past sessions; 90 days, pruned. A plan nobody started evaporates at the 30-minute grace and leaves no trace, consistent with ADR-0034.

## Checked and found sound

- **Timezones end to end** — local wall-clock in the picker, UTC on the wire, `timestamptz` in the row, per-rider rendering from a reported (never asked) zone validated against embedded tzdata, the reminder naming no clock time by design, ICS in `Z` basic format.
- **Exactly-once reminders** — the claim is the update; a double tick, a restart or a second instance cannot re-mail; bounded batches, eight workers, a per-session budget.
- **A plan whose workout was deleted** — the JSON is copied at plan time; an unparseable one gets a toast rather than a dead button.
- **Who may plan and cancel** matches SPEC's matrix (owner or coach, crew ban honoured, tested).
- **Recap privacy and retention** — presence and time only; a purged rider is stripped from every roster by trigger; the export narrows to the requester's own rows.
- **Four states** on the Sessions place's two lists and the picker; bearer feeds with `no-store`, constant-time compare, rotation on both tokens.

## Not checked

Nothing was executed; the phone-width claims about the Sessions place and the picker are read from markup — and no room place is in `phone-width.spec.ts`'s route list, so that surface has no automated width guard. Not read: `hub/tick.go` beyond the recap hand-off, the XP and medal pipeline, the desktop shell's notification bridge, the HTML mail template, and the e2e specs other than the phone sweep.
