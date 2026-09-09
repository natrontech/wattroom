# Audit: authentication and the account — 2026-09-10

**Slice.** Signing in (the providers' OAuth flow, passkeys, the dev door, the desktop hand-off, sessions and logout), the credential set (ADR-0029: connect and disconnect, the last-way-in rule, the recovery address, the account alarms of ADR-0030), the settings tree's account surfaces (`/settings/profile`, `/settings/notifications`, `/settings/your-data`), and the server side (cookies, CSRF, the per-address ceilings, PII in logs, the export's scope, the delete's cascade).
**Excluded**: rooms, rides, presence, friends, crews, messages (its own audit the same night), the HUD.
**Method.** One Explore agent at `bd8b9598`, read-only against WATTROOM.md, ADR-0029, ADR-0030, ADR-0040 and the rules; the three highs verified by reading the cited code before filing. No browser, no provider, no deployment.

## Filed

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| #1822 | A verified recovery address recovers nothing — one stolen session is a permanent lockout | high, decision | `needs-human-input` |
| #1823 | `POST /api/auth/desktop/redeem` is a cross-site login-CSRF; `DecodeStrict` never checked Content-Type | high, security | fixed (#1830) |
| #1824 | The per-address sign-in ceilings are bypassed by one `X-Forwarded-For` header | high, security | fixed (#1830); the Caddyfile line is left to whoever touches `deploy/` |
| #1825 | Deleting the account never hands the Strava grant back | bug | open |
| #1826 | The export omits the credential set and two profile fields the privacy page says are held | bug | open |
| #1827 | PasskeyList reads a failed list as "you have no passkeys" | bug | open |
| #1828 | Polish: the delete confirm under-names what goes, removing the address has no confirm, `clearEmail` alarms before it clears, the cookie list is one short, the ride-mail switch is on the wrong page, three unauthenticated POSTs have no origin test | medium/low | open |
| #1829 | ADR-0030's reason for having no sign-in alert is half spent | decision | `needs-human-input` |

Already filed and cited: #1611, #1554, #1547, #1507, #1089, #1607, #1314.

## Checked and found sound

- **Session cookies and revocation** — HttpOnly and SameSite=Lax unconditionally, Secure tied to the deploy scheme; 32 bytes of `crypto/rand` with only the SHA-256 stored; logout is a server-side row delete that still checks Origin; expired sessions are swept by housekeeping.
- **CSRF for the mutating handlers** — one boundary in `RequireUser`, `isMutatingMethod` documented, the one known GET exception tracked (#678). The three handlers outside it are the ones #1823 and #1828 name.
- **OAuth** — state matched in constant time against an HttpOnly cookie, the link intent carried inside the state, unknown provider 404 first, the redirect URI server-built; linking never mints a session, refuses an identity owned elsewhere, and handles the 23505 race on both paths.
- **The `next=` deep link** never touches the server; the stash is client-side and parsed the way the browser will, including the backslash form #1610 found.
- **The dev door** takes effect only on a local origin, a public base URL is a boot refusal, and the GET refuses `Sec-Fetch-Site: cross-site`. **The synthetic door** is POST-only, bearer, constant-time, absent from `/api/auth/providers`, budgeted.
- **Passkeys** — single-use challenges taken before the expiry check, the store swept before the ceiling is tested, RP from `baseURL` with extra origins an allowlist, an opaque user handle, the sign counter written back, exclusions on register, a 10-per-account 429, a rune-safe name cut.
- **The credential-set invariant** — one query under `LockUser` in a transaction, shared by both removal paths; `TestConcurrentRemovalsKeepOneCredential` proves the race; the check answers before Strava's grant is revoked.
- **Email verification** — one write path, promotion is a single UPDATE that is its own expiry check, the budget spends before the taken-check so the oracle costs mail, a failed send is rolled back and refunded, GET renders a form so a scanner cannot confirm, no-referrer and no-store on the confirm page.
- **The alarm** — every ADR-0030 trigger through one function, gated on a verified address, the replacement alert reaching the address being replaced, sending detached from the account action.
- **PII in logs** — no token, address, cookie or code on any log line in `auth/`, `account/`, `notify/`; no `Message: err.Error()`.
- **Security headers** on every response; unknown `/api` paths get the API's 404, not the SPA shell.
- **SPA gating and the four states** — only `unauthorized` nulls `me`; the login page has all four states including "server unreachable"; the verify gate traps Tab but not Escape and re-polls on `visibilitychange`.
- **Phone width** — all six settings routes plus `/` and `/login` are in the sweep.
- **Delete's cascade** — every table that references `users(id)` cascades except `crews.owner_id` (RESTRICT, handled by `ReleaseCrews`) and `track_plays.queued_by` (SET NULL, correct).

## Not checked

- **Anything under a real OAuth provider** — read, never driven; no test completes a callback end to end (still true since the 2026-09-08 audit).
- **Whether the login-CSRF reproduced in a browser** — read from the code; a standard `enctype="text/plain"` form CSRF; closed by two belts and a test rather than by observation.
- **The desktop shell's own half** of the hand-off (`wattroom://` handling), the budgets' window semantics, the mail as it renders, `secrets.Cipher` — out of the slice or covered elsewhere.
