# Audit 2026-09-17 — the server's HTTP API surface and the hub

**Slice.** Everything under `server/`: the credential surface (auth, tokens,
account, keyset, secrets), rooms and crews with the jukebox, board and audio
that hang off them, the hub and the live seam (protocol, metrics, av), the
social API (dms, friends, chat, gamify, notify, feedback, gifs, unfurl), and a
rider's own data (rides, stats, progression, recap, fitexport, strava, og,
avatars, customworkouts, housekeeping, mcp). Five read-only code auditors, one
per area, against `.claude/rules/errors.md`, `docs/ARCHITECTURE.md`,
`docs/SPEC.md`, WATTROOM.md's privacy rules and the ADRs each area cites.
Commit `59d176ce`.

**Excluded.** The web app under `web/src` — swept on 2026-09-16, and nothing
here re-reports a frontend finding. The BLE layer (hardware). The desktop
shell. Nothing was run against a live server: every finding was read at its
`path:line`, and the two filed as security were re-read by the auditor of
record before filing.

**Filing rule.** Every `bug`, and every finding of medium or high severity, got
its own issue. Low-severity findings went into one bundle per area so an agent
can take an area in one PR. Two findings are decisions and carry
`needs-human-input`: an agent must not build what they describe.

**Overlap.** Five earlier records cover parts of this ground — 2026-09-08
(auth, durable privacy, hub protocol, outbound fetch, strava), 2026-09-09
(mcp-tokens), 2026-09-10 (api-contract, auth-account). The api-contract record
in particular was read before filing and nothing it already fixed was
re-reported; where a finding is the same *shape* as one of its (#1984 folding a
database failure into a 404), the new issue says so and names the package that
did not get the pass.

## Fixed in the same run

- #2225 → #2226 — **the undo of a dismissed friend request forged the
  request.** `POST /api/friends/{id}/restore` inserted unconditionally and
  `status` defaults to `'pending'`, so two calls — restore, then accept —
  befriended a rider who was never asked, with neither the friend code ADR-0012
  makes the permission to ask nor a shared room. That hands over DMs, presence,
  shared rides and the rider's page. The insert is now conditional on the
  tombstone it claims to be undoing.
- #2227 → #2228 — **the rides routes took a mutating request without the Origin
  check.** `tokens.ReadSource` resolved through `auth.User`, which checks
  nothing, whenever a session cookie was present; the CSRF boundary lives in
  `auth.RequireUser` alone. Every mutating route of every service on that
  source was outside it, `DELETE /api/rides/{id}` included.

## Filed

Hub and the live seam:

- #2229 `setMetrics` reads a rider's role outside the room lock while an HTTP
  handler writes it — a data race whose copy lands in the saved ride
- #2230 an empty room freezes its timeline and never scores the sprint it was
  running
- #2231 the sprint podium's best five seconds spans a gap in a rider's samples
- #2232 a jukebox command inside the throttle is refused in silence (#659's
  shape, on the path that fix did not cover)
- #2233 the n-in-1-out tick is guarded by a test that cannot go red
- #2234 Watt Golf hides the meter for the whole game, because the gap between
  holes is zero
- #2235 five smaller drifts, bundled

Rooms, crews and the jukebox:

- #2241 `GET /api/rooms/{slug}` names an unlisted room to a signed-out caller,
  where its own sibling `PublicIdentity` refuses
- #2242 a database failure reads as "No such clip" and as "Join the room"
- #2243 the weekly board publishes a category built from two numbers nobody
  chose (ADR-0048)
- #2244 four ceilings, three status codes, and SPEC pins one
- #2245 **decision**: does a listed room's door admit to the room, or to its
  whole crew?
- #2246 ARCHITECTURE overstates what `visible_rooms` guarantees; three query
  comments predate ADR-0038
- #2247 nothing asserts a crew admin cannot moderate a room they never joined
- #2248 four smaller drifts, bundled

The social surface:

- #2236 another rider's XP breakdown hands back the progress the strip removes
  (ADR-0027)
- #2237 a failed Giphy call logs the API key into the ring a rider's report
  staples on
- #2238 the flight recorder's buffer reaches a public issue unfenced and
  unbounded
- #2239 **decision**: a rider nobody may look up still has their face served to
  anyone who knows their id
- #2240 five smaller drifts, bundled

A rider's own data:

- #2249 `GET /api/rides/best` without `?except` always answers nothing
- #2250 the export zip is the one rider-data download with no `Cache-Control`
- #2251 `POST /api/rides` is the one rider-created row with no ceiling and no
  rate limit
- #2252 a ride that grew after the session closed is neither re-uploaded nor
  re-judged
- #2253 five smaller drifts, bundled

The credential surface:

- #2254 the recovery ceiling's map has no cap, and its key is an address a
  stranger types
- #2255 the OAuth callback does unbounded outbound work, with no ceiling and no
  timeout
- #2256 `/api/auth/providers` never says whether passkeys work on this server
- #2257 ADR-0017 promises a bearer reads the trophy case, and it has not since
  #1736
- #2258 six smaller drifts, bundled

## Checked and found sound

The part that stops the next audit re-deriving it.

**The error contract holds almost everywhere.** No `Message: err.Error()` in
any package read. `httpx.Fail` is used consistently for "the database did not
answer" rather than collapsing it into a 404 or a 403 — `dms.handleSend` and
`handleEdit` carry the comment naming the audit that caught that class. Every
handler in the social packages calls `RequireUser`/`RequireMember` as its first
statement, and the only unauthenticated route found there is the token-scoped
unsubscribe. `httpx.DecodeStrict` bounds at 64 KiB, refuses unknown fields and
refuses the three CORS-simple encodings, which is what closed #1823 globally.

**Privacy in the hub.** Metrics, ping, FTP, weight and XP are room-scoped, each
with a comment justifying it; `OwnConnection` is its own message so an address
can never ride the broadcast roster, and a test asserts its absence over the
wire; `SensorPairing` and pokes are addressed per socket rather than folded
into the tick. AV tokens are 30 minutes, minted per connection with a nonce
identity, and grant exactly `roomJoin`/`canPublish`/`canSubscribe` — no
`roomRecord`, so "AV is never recorded" is enforced by the grant and not only
by policy. The LiveKit webhook verifies the HMAC before parsing and recomputes
HS256 whatever the header's `alg` says.

**The tick really is n-in-1-out.** One marshal per room per tick, the same
`[]byte` handed to every socket; the only per-socket message is the workout
definition, marshalled lazily at most once per tick for the sockets owing the
hash. Room state never touches the database: the hub's only I/O is through
consumer-defined interfaces and every call site releases the room lock first.
`h.mu` is never held while taking `rm.mu`. Maps and slices handed to another
goroutine are rebuilt or drained-with-carry rather than shared. (#2233 is about
the *test*, not the implementation.)

**The room gates against SPEC's two matrices.** Room edit/delete/role/remove/
transfer/grants/ICS-rotate are owner-only; plan/move/cancel are moderator; RSVP
and own-prefs are member; crew rename/icon/picture/code/role are admin; crew
transfer is owner. All match. Crew roles never reach a room-scoped gate, which
is SPEC's sharpest crew line — #2247 is that it is untested, not that it is
wrong. The ban is asked once at both levels, fails closed, and `DeleteMembership`
refuses to delete a banned row so leaving is not an escape. Ceiling races
(room create, hand-over, planning, track and clip quotas) all take the row lock
inside the transaction that inserts, with the lock order documented.

**The SSRF guard's core.** `safeDial` resolves, judges every answer and dials
the IP literal it judged, so there is no rebind window, and keep-alives are
disabled so every redirect hop re-runs it. Ports are checked on the rider's URL
and in `CheckRedirect`; hops, dial, response and total time are all bounded; no
cookie or rider-derived header leaves. The unfurl cache is keyed on
`(rider, url)`, which is the #1739 oracle genuinely closed. #2240's two items
are edges, not the core.

**The DM friendship gate** is in SQL, not in Go: `SendDm` and `SaveDmImage`
both carry `friendships.status='accepted'` as a `where exists`, reads are
pair-scoped, and the attached-image check closes the storage-bound escape.

**Ownership of a rider's own data.** Every handler that reads or writes a ride,
a workout or an upload scopes by the caller's user id in the `where` clause, so
someone else's row is a 404 rather than a 403. Rides are private by default;
`ListSharedRides` hands friends exactly ADR-0024's list with no watts, no HR,
no FTP and no weight. The per-second record with heart rate is refused to a
personal token on all three routes that could carry it.

**The Strava boundary.** The MCP tools expose WattRoom-recorded data only —
no `exportState`, no `remoteActivityId`, no `lastError` — so no Strava-issued
value reaches a model's context. `exportFailure` never serves the provider's
body or the key, with a test. `ForgetRemoteActivityIds` drops the remote's ids
on disconnect per API Policy §7.4.

**The formulas, number by number against docs/SPEC.md.** Power zones, category
thresholds, XP and the streak's cap, the FTP suggestion and its 1.02 floor,
NormPower's 30 s rolling fourth-power mean with its sub-20-minute fallback,
Load, the 42/7-day EWMAs and Form, the five form zones, the 28-day cold start,
SuggestToday's five rules in SPEC's order, and the ±5 % / ±10 W band as one
shared constant both sides read. Each has a test with a worked number.

**Retention and the day boundary.** `housekeeping.Run` sweeps at boot and on
the tick, each sweep budgeted and batched, one failure not taking the others.
`stats/zone.go` is genuinely the single decision point for the day boundary, so
the week-streak query and the ride-week query cannot disagree.

**The credential mechanics.** Session cookie bytes, hashing, expiry and the
401-vs-500 split; `RequireUser` as the one CSRF gate (#2227 was a wrapper that
went around it, not a hole in the gate); the four hand-checked `SameOrigin`
routes that must work without a session, all asserted in a boundary audit test;
the passkey ceremony's binding, verified against go-webauthn's own source; the
last-credential invariant under one row lock; ADR-0051's recovery clause by
clause, including the identical 204 for known and unknown addresses with the
work detached so the timing matches; the desktop handoff's single use, 90
seconds, constant-time compare and bounded map; AES-256-GCM sealing with a
boot refusal on an unusable key.
