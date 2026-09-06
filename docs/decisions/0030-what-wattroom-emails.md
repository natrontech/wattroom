# 0030 — Two classes of mail: an unconditional alarm and one opt-in ride switch

- Status: accepted
- Date: 2026-09-06
- Builds on: [ADR-0029](0029-one-account-a-set-of-credentials.md), which made
  the account a set of credentials and the address its recovery attribute
- Extends: WATTROOM.md "Privacy" — that row governs what leaves the platform
  as metrics; this one governs what leaves it as mail

## Context

WattRoom sends three emails, all plain text, written in two bursts. #194 and
#265 (2026-08-31) built the whole capability: Resend as one authenticated POST,
`WATTROOM_RESEND_KEY` gating the service to nil when absent, a `notify_planned`
opt-in, an unsubscribe token and the RFC 8058 one-click header — then the mail
for a planned session and the one for a session that moved. #787 (2026-09-06)
added the third, the address confirmation ADR-0029 needed. There is no
template and no layout; `send()` posts `{from,to,subject,text}` and each caller
formats its own body.

Two pressures now push on that from opposite directions, and nothing in the
repository settles either.

**The account grew doors, and nothing announces them.** ADR-0029 made an
account a set of credentials — providers and passkeys, counted together — and
made the verified address the way back in when all of them are gone. Neither
half is watched. A stolen session can register a permanent passkey without a
sound, and confirming a replacement address tells nobody at the address being
replaced. Those are the two textbook silent-takeover paths, and the mail that
would catch them is the mail we do not send.

**Every feature wants an email.** Friend requests, DMs, weekly summaries,
digests, a nudge when a room is quiet. Each is individually defensible and
collectively fatal: the app that sends them is the app riders route to a
folder, and the folder catches the alarm too. Restraint is not politeness
here. It is the only thing that keeps the alarm audible.

The constraint on how any of it looks is unusual enough to belong in the
decision rather than the implementation. `web/src/app.css` is CSS variables,
`light-dark()`, Tailwind v4 and two web fonts, and **none of that survives an
email client** — no variables, no `light-dark()`, `<style>` stripped on some
Gmail paths, no Chakra Petch in Outlook. Whatever the mail looks like is a
hand-maintained copy of the palette, which is the situation `httpx.WritePage`
already accepted for the pages a mail link opens (#832).

## Decision

**Email only what a rider must act on while they are not in the app.**
Anything they will see the next time they open it stays in the app. This is
the whole rule; the rest of this ADR is what it implies.

**Two classes exist, and there is no third.** A mail that fits neither is not
sent.

*Security mail* is transactional, unconditional and carries no unsubscribe
header — an alarm with an off switch is a decoration. It goes only to a
verified address.

*Ride mail* is bulk: it carries the RFC 8058 header, it is off until a rider
turns it on, and it covers sessions in rooms they belong to.

**Security mail is one template with one variable line, not one template per
event.** A heading, the line that says what changed, and one link to the place
that undoes it. The triggers it serves:

- a passkey was added, or removed
- a provider was connected, or disconnected
- the recovery address was replaced — **sent to the old address**, which is the
  gap that motivates this class more than any other
- the account was deleted, as a receipt; the purge is irreversible and the
  mail is the only evidence it happened

Six call sites, one body, one place to read to answer "do we mail on this?".
Adding a seventh is a normal change; adding a second security template is an
amendment to this ADR, because the moment there are two there are ten.

**Ride mail keeps exactly one switch — the `notify_planned` boolean that
already exists.** Planned, moved, cancelled and a start-time reminder all ride
it. Per-event checkboxes fail the 95% rule in `.claude/rules/ux.md`: a rider
who wants to hear that a session was planned wants to hear that it was
cancelled. A second switch is an amendment.

**Named and never sent**: a mail for a chat message or a DM; a mail for a
friend request; digests, weekly summaries and streak nudges; anything
marketing; and any mail at all to an address that has not been verified, the
sole exception being that address's own confirmation link. An unverified
address is someone's typo until proven otherwise, and account activity is not
something to narrate to it.

**No new-sign-in alerts, for now.** There is no session list and no "sign out
everywhere", so the mail would be anxiety with nothing to press. It becomes a
good idea the day sessions are listable, and not before.

**Rendering: one HTML template, inline styles, table layout, sent alongside the
plain-text body** in the same Resend call. The palette is copied into Go by
hand — the third copy after `app.css` and `httpx.WritePage` — and is one fixed
look, not the rider's chosen theme. ADR-0005's rule survives the copy: the
watt magenta marks the live thing the mail is about (a workout name, a start
time), and never the chrome around it. Security mail does not come from the
bulk sender's address.

## Consequences

- The alarm exists at all, which it does not today, and it is enumerable: one
  template and one list of triggers is a thing a reviewer can hold against a
  diff that adds a way into an account.
- A rider with no verified address gets no alarm. That is the same residue
  ADR-0029 already accepted for recovery, and it argues for the verification
  gate rather than against this.
- The palette is now copied three times and a theme change will not reach the
  inbox. Accepted knowingly: no build step joins Go and CSS, and the mail is
  deliberately not themed, so the copy is a constant rather than drift.
- More mail types is more surface for the mail cannon in #827 — a signed-in
  account can already trigger unbounded confirmation mail. The ceiling lands
  with or before the new mails, not after.
- The reminder is the one item that is not cheap: it needs a scheduler and a
  per-rider timezone, because `notify.go` renders times in the server's zone
  and a reminder in the wrong zone is worse than no reminder. It sequences
  last for that reason, and the timezone is its prerequisite, not the others'.
- Revisit on org or team accounts, which introduce an invitation — mail to
  someone who is not yet a rider, a class this shape has no room for — and on
  a session list, which makes the sign-in alert actionable.
