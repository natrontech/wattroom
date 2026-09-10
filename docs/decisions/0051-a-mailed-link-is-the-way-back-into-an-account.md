# 0051 — A mailed link is the way back into an account, and a mail account can therefore take one

- Status: accepted
- Date: 2026-09-10
- Builds on: [ADR-0029](0029-one-account-a-set-of-credentials.md), which made
  the account a set of credentials and the verified address its recovery
  attribute — and left the recovery half unbuilt
- Extends: [ADR-0030](0030-what-wattroom-emails.md) — a second link mail
  beside the address confirmation, and one more trigger on the alarm

## Context

ADR-0029 called the verified email "the way back in when every provider and
passkey is gone", WATTROOM.md's Auth row repeats it, and the address gate says
it to every new rider's face. Nothing implemented it. Until this ADR,
`server/internal/auth` had one route table with no recovery route on it, and
`server/cmd/` held `seed` and nothing else — no operator tool either.

The audit that found it (#1822) also found the attack that makes it matter, and
it needs no exotic access. Holding one session — a laptop left open, a shared
browser, a phone lent out — an attacker sends two ordinary requests:

1. `POST /api/auth/passkey/register/*` — their own passkey, now on the account.
2. `DELETE /api/me/identities/google` — the rider's only provider, gone.
   `refuseIfLastCredential` counts credentials, not owners, and there are two.

Removing a credential ends every other session (#1607), so the rider is signed
out everywhere while the attacker keeps the session they came in with. Both
alarm mails fire correctly and both link to `/settings/profile`, behind the
sign-in the rider no longer has. The verified address — the one thing the rider
still controls — did nothing at all.

Three ways out were on the table (#1822): build the recovery flow; amend
ADR-0029 and WATTROOM.md to say the address only alarms; or split the work
behind a session list. The second is the honest option only if recovery is
genuinely unwanted, and it still owes the alarm mail something a locked-out
rider can press. The third parks a live lockout behind a feature.

The reason the first needed a decision rather than a ticket: **recovery by mail
makes a mail-account compromise an account compromise.** Whoever reads the
inbox can mint a WattRoom session, and no credential on the account prevents
it. That is a real reduction in the security of an account whose passkey is
hardware-bound, and it is not the kind of thing to discover later in a diff.

## Decision

**Build it: `POST /api/auth/recover` and `POST /api/auth/recover/finish`, and
accept the mail trade explicitly.** A verified address recovers the account. A
rider who can read that inbox can always get back in; a rider who cannot is
not locked out by us, only by their mail provider.

The trade is accepted on the numbers of this app. A lockout is permanent, it
is reachable by one borrowed laptop, and it costs the rider every ride they
ever recorded. A mail-account takeover already yields most of a person's
digital life and is exactly the threat their mail provider is built to
resist — WattRoom is not the weakest link in that chain and should not pretend
to be its guardian. This is the same trade every consumer product makes, and
saying so in writing is the point of this file.

The shape, all of it inherited from the confirmation ceremony beside it
(`server/internal/auth/email.go`) so there is one idiom rather than two:

- **The token is hashed, single-use and time-bounded.** SHA-256 in
  `users.recover_hash`, an expiry in `users.recover_expires`, on the
  confirmation link's 24-hour clock. A leaked table recovers nobody.
- **Its own pair of columns**, not the verification ones: the two ceremonies
  overlap in time and unlock different things — one moves an address, the
  other mints a session. Two nullable columns, expand/contract per
  [ADR-0019](0019-tagged-releases-and-a-self-converging-vm.md).
- **The answer is identical for a known and an unknown address**: 204, no
  body, and the work detached onto a goroutine so the response time does not
  differ either. "Type an address, learn whether it is a rider" is the
  enumeration surface ADR-0029 declined when it refused identifier-first
  sign-in; building it on this endpoint would be a strange place to change
  our mind.
- **Two ceilings, both spent before the database is touched** (the #1605
  ordering): one per client address on the door, one per email address asked
  about, plus the account's existing hourly mail budget once the account is
  known. A ceiling that is spent after the existence check is an existence
  oracle at request rate.
- **Only a confirmed address recovers.** An unverified one is somebody's typo
  (ADR-0030), including the hand-typed pre-#781 rows.
- **The link ends every session, then mints one.** In that order: the request
  carries no session of its own, so "every session but this one" would end the
  session being minted, and a stale cookie in that browser must not be the one
  thing that survives a recovery. The rider who followed the link holds
  exactly one session, which is the whole point against an attacker holding
  another.
- **GET renders a button; POST spends the token.** A mail scanner that
  prefetches links must not be handed a session — the hazard the confirmation
  and unsubscribe forms already guard against, and the worst of the three to
  lose.
- **A moved or removed address takes the live token with it.** Otherwise the
  previous inbox keeps a way in after it stops being the account's address.
- **Spending a link alarms the address** (ADR-0030's list gains a seventh
  trigger), and **every alarm with a button now names the way back in.** An
  alarm that only links to `/settings/profile` tells a locked-out rider what
  happened and nothing they can do about it, which is the gap #1822 opened
  with.

## Consequences

- **A mail-account compromise is an account compromise.** Written down, above,
  as the price of the flow. Nothing in the product may make it worse — no
  "recover by mail" that skips the confirm click, no long-lived token, no
  second address, and no recovery of an unverified address ever.
- A rider with **no** confirmed address is still unrecoverable. That is
  ADR-0029's accepted residue, not new here, and it is one more argument for
  the address gate.
- **Recovery is a way in that no credential can revoke.** A rider who wants
  the strongest account WattRoom offers cannot have "passkey only, no mail
  path" — removing the address removes the alarms too (#1638). A session list
  (#1607's follow-up) would let a rider see and end a foreign session
  themselves, which is the better answer to a stolen session and is not
  blocked by this.
- A stranger who knows a rider's address can spend that address's hourly link
  budget and delay a real recovery by up to an hour. Accepted over the
  alternative, which is no ceiling on mail to an address a stranger types.
- The recovery mail is the **second** link mail, so ADR-0030's "one security
  template" now means one *alarm* template plus two link mails, both of which
  are things a rider asked for rather than reports of something that happened.
  A third would be an amendment.
- `refuseIfLastCredential` still counts credentials rather than owners, so the
  attack's first two steps still succeed. This ADR does not close them; it
  makes their outcome survivable. Refusing to remove the *last provider* while
  a passkey younger than it exists is a separate decision, still open.
- Revisit when sessions become listable, when an operator tool exists (an
  out-of-band way in would let the mail path shorten its own TTL), or the
  first time a rider's mail account is the thing that gets taken.
