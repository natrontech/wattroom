# 0040 — Desktop sign-in happens in the browser, and the session is handed back

- Status: accepted
- Date: 2026-09-08
- Amends: [0029](0029-one-account-a-set-of-credentials.md)'s picture of where a session is born — one more door, the same credentials
- Constrained by: [0037](0037-a-desktop-shell-for-what-the-browser-cannot-reach.md) — the shell holds no product code, and its bridge stays small
- Answers: [#1188](https://github.com/natrontech/wattroom/issues/1188)

## Context

The first installed build could not sign anyone in. Passkeys sat on _Waiting
for your passkey…_ forever: Electron has no WebAuthn UI, and the half of
`app.configureWebAuthn` that serves iCloud Keychain and 1Password passkeys is
Electron 45, alpha at the time of writing, and needs the Associated Domains
entitlement, a provisioning profile embedded in the bundle, and an
`apple-app-site-association` file served by wattroom.ch. GitHub and Strava
opened their login pages inside the window, and each one dead-ends there:
GitHub asks for the rider's GitHub passkey, the same wall; Strava's Sign in
with Google is refused by Google from any Electron window.

Every desktop app that faces this does the same thing: sign in in the system
browser, come back through a URL scheme.

## Decision

**In the shell, `/login` has one button: sign in with your browser.** It
generates a nonce, keeps it, and opens the ordinary login page in the system
browser with `?desktop=<nonce>`. The rider signs in there however they like —
passkey, GitHub, Strava, the same credentials ADR-0029 fixed. Nothing about
those flows changes.

**Once signed in with a nonce in the query, the browser hands the result back.**
The page asks `POST /api/auth/desktop/handoff` for a one-time token bound to
that nonce and opens `wattroom://auth/<token>`. The shell registers the scheme
and does one thing with the link: load `/login?handoff=<token>` on its own
origin. The page redeems the token with the nonce it kept
(`POST /api/auth/desktop/redeem`), and the server mints the shell **its own
session**. Signing out of the browser leaves the app signed in, and the other
way round.

**The nonce is the security of it.** A token is single-use and lives ninety
seconds, but that alone leaves a login-CSRF open: an attacker mints a token in
their own browser and gets a victim's app to open the link, and the victim is
now signed into the attacker's account. The shell only redeems with the nonce
it generated, the server compares in constant time, and a wrong nonce burns
the token. The `wattroom://` handler accepts the `auth` path and a token
shaped like one; anything else is dropped, never loaded.

**Passkeys inside the shell stay hidden** until Electron 45 and the Apple side
land. The rider's passkey still signs them in — in the browser, which is where
it lives.

## Consequences

- Two endpoints, an in-memory token map (one process, ADR-0002; ninety
  seconds is not a table), and `wattroom://` registered by every installer.
  #296's app-ness box has its first real link.
- The shell's bridge is unchanged: the whole thing is the web app opening an
  off-origin URL, which the shell already hands to the browser, and the shell
  loading one URL on its own origin.
- A rider without the app installed who reaches `/login?desktop=` by accident
  is told so and pointed at the download page; the link does nothing there.
- Revisit when Electron 45 is stable: Touch ID and platform passkeys inside
  the shell would make this the fallback rather than the only door.

## Amendment — the nonce proves the shell, not the request (2026-09-10, #1823)

"The nonce is the security of it" was true of the *shell* and not of the
endpoint. `POST /api/auth/desktop/redeem` is plain HTTP with no session to
check, and a caller who holds both the token and the nonce is not necessarily
the shell: an attacker who minted the pair in their own browser could put them
in a `text/plain` form on their own page, and a victim's browser would post
them without a preflight and be signed into the attacker's account. Two
things close that, and both are now the rule: `httpx.DecodeStrict` refuses the
three form encodings a browser sends without a preflight, for every handler,
and redeem refuses a foreign `Origin` the way every mutating route behind a
session already does. The nonce still does what it did — a victim's shell
never redeems a token it did not ask for.
