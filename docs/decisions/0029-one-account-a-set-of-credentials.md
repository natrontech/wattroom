# 0029 — One account holds a set of credentials; email is recovery, not identity

- Status: accepted
- Date: 2026-09-06
- Amends: WATTROOM.md "Auth" — passkeys join the credential set and Strava
  demotes from everyday door to fitness connection. "No passwords, ever"
  still binds.
- Builds on: [ADR-0009](0009-login-gated-app.md), which put the whole app
  behind sign-in

## Context

Production has one door. `GET /api/auth/providers` answers
`{"providers":["strava"]}`, because only `WATTROOM_OAUTH_STRAVA_*` is set —
Google and GitHub have been implemented since M2 and unreachable ever since
(#718). That single door is also the narrowest one available: new Strava apps
start single-athlete and the Standard Tier covers ten riders without review
(WATTROOM.md), so the only way in is the one that runs out first.

Widening it exposes a question the alpha has never had to answer: a rider who
signed in with Strava in August and clicks "Continue with GitHub" in September
lands in a fresh, empty second account. Linking itself works — #719/#720 made
`?link=1` attach a provider to the account you are already in, refuse an
identity that belongs to someone else, and refuse a second identity for a
provider you already have — but only for a rider who knows to link.

Two obvious fixes are both unavailable.

**Merging on a matching email** is the nOAuth / pre-account-hijacking attack
class: an attacker who gets an unverified address onto an account first
inherits the victim's federated identity when it arrives. It has a fresh CVE
this year and a decade of prior art. We will not build it.

**Identifier-first — "type your email, we show you your providers", the
Digitec Galaxus model** — assumes an email WattRoom does not have. Google is
requested with `openid profile` and GitHub with `read:user`, neither of which
carries a usable address, and Strava removed email from the athlete model
entirely; no scope brings it back. `users.email` today is hand-typed,
unverified, non-unique and frequently absent, because it exists for
planned-session mail (#117) and nothing else. Identifier-first additionally
discloses account existence to anyone who can type an address into a form.

Digitec can do it because email *is* their account key by construction —
there is no account without an order, and no order without a verified
address. Ours is the inverse: the account is created by an OAuth identity, and
the address is an afterthought.

## Decision

**One account holds a set of credentials, and no credential is the account.**
The schema already said this — `identities.user_id` is a plain indexed FK, and
`00002_auth.sql` promised "a user may link several providers; the first
sign-in creates the user, later ones attach". This makes it the stated model
and adds the invariant that follows from it: **a rider can never remove their
last credential** (#783). Providers and passkeys count together toward that
one.

**Email is a verified recovery attribute, not the login identifier** (#781).
It gets verified now, while the rider count is under ten and the backfill is a
single interstitial; at a thousand riders it is a migration campaign. Required
for new accounts, skippable-but-returning for existing ones. It does not
become the thing you type to sign in, and there is no magic link as a daily
door — recovery only. Should we later want the identifier-first screen anyway,
everything it needs will already exist and it becomes a pure UI change.

**Passkeys join as a credential type** (#782), via `go-webauthn/webauthn`.
Discoverable credentials and a plain "Sign in with a passkey" button: no
identifier field, and deliberately no conditional UI, which only pays off when
there is a username input to decorate and which reintroduces the enumeration
surface the paragraph above just declined. `authenticatorAttachment` goes
unconstrained, so software authenticators (iCloud Keychain, Google Password
Manager, 1Password) and hardware keys work through one code path. A passkey is
not a password; "no passwords, ever" is unamended.

**Strava demotes from everyday door to fitness connection.** It remains the
ride-upload integration and remains a way in for whoever already uses it, but
the login riders actually use should be the one that does not cap at ten.

**Duplicate accounts stay possible, and are answered by recognition rather
than merging** (#784): the last-used provider is remembered per browser and
marked on the sign-in screen, and a sign-in that *creates* an account says so,
at the one moment undoing it is cheap. There is deliberately no merge tool.

## Consequences

- Sign-in stops depending on any one third party. That is what makes the
  Strava tier ceiling an integration problem rather than a growth ceiling.
- A verified address becomes a takeover path worth guarding, which is why
  recovery is the only thing it unlocks and why verification tokens are
  hashed and single-use like sessions.
- `go-webauthn` costs roughly eight modules on a `go.mod` with five direct
  dependencies. Accepted knowingly: WebAuthn verification has too many small
  corners — RP ID hash, origin, UP/UV flags, challenge binding, sign counters
  — to be the place we save a dependency.
- Passkeys are domain-bound. `wattroom.ch` in production, `localhost` in dev;
  the dev provider and `?as=` are untouched and still carry local work.
- The ordering is the server's, not the gate's (#1611). `requireVerifiedEmail`
  in `server/internal/auth/session.go` refuses `POST
  /api/auth/passkey/register/start` with 403 for an account that carries the
  requirement and has not confirmed, so a client that skips the SPA does not
  skip the rule. It narrows to what a rider can actually act on: a server with
  no mailer can confirm nobody, and accounts that predate the requirement
  (`email_required = false`) are asked, never required.
- Riders who lose every credential *and* never verified an address are
  unrecoverable. That is the accepted residue of refusing to merge on
  unverified email, and the reason #781 goes first.
- Revisit if the alpha ever wants shared-device sign-in or an org/team login,
  neither of which this shape anticipates.

## Amendment, 2026-09-10 (#1822): the recovery half is built, and it has a price

"Email is a verified recovery attribute" was stated here, repeated in
WATTROOM.md and said to every new rider by the address gate — and for four
days nothing recovered anything. One stolen session could add its own passkey,
disconnect the rider's only provider, and leave the rider outside their own
account permanently; both alarm mails linked to a page behind the sign-in they
had just lost.

[ADR-0051](0051-a-mailed-link-is-the-way-back-into-an-account.md) builds the
flow this ADR promised — a hashed single-use link to the confirmed address,
which ends every session and mints one — and records the consequence this ADR
did not spell out: **a mail-account compromise is now a WattRoom account
compromise.** Read there for why that trade is accepted.

Unchanged: recovery is still the only thing the address unlocks, it is still
never the login identifier, and there is still no magic link as a daily door.
