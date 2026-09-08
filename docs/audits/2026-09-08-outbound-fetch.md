# Audit — the outbound fetch surface — 2026-09-08

Run against main @ `6b9d5ce3`. Read-only: nothing was changed and nothing was verified in a running
app.

**Produced no issues.** That is the finding, and it is the second time today a slice has come back
clean — see the [hub/protocol pass](2026-09-08-hub-protocol.md), which set the precedent for
writing that down rather than reporting nothing.

## The brief

Slice: **every HTTP request the server makes because a rider asked it to** — link unfurling and its
image proxy (ADR-0031), the GIF picker (ADR-0032), and the OG card renderer.

Chosen because it is the classic SSRF shape — a user supplies an address, the server connects to it
— and because ADR-0031's title makes a specific, checkable claim: *"behind a pinned-address fetch"*.
No previous audit had touched it. The Strava path was swept
[separately](2026-09-08-strava.md); it fetches a fixed host and is not part of this.

## Why the guard holds

The pin is the part that is usually wrong, and it is right here. `safeDial` resolves the name
itself, filters the answers, and then dials **the address it judged** rather than the name:

> a resolver consulted twice can answer twice, and a DNS-rebind attack lives in the gap between the
> check and the connect. There is no gap here.

Everything else follows from that one decision being made properly.

| Claim | Where | Verdict |
| --- | --- | --- |
| Only http/https; `file:`, `gopher:`, `data:` refused | `checkURL` | Scheme allowlist, applied to the rider's URL *and* every redirect target |
| Private space refused | `publicIP` | `IsGlobalUnicast` and `IsPrivate` cover loopback, unspecified, multicast, link-local and RFC 1918/4193 |
| The ranges Go's predicates miss | `blockedNets` | CGNAT, the three TEST-NETs, benchmarking, 6to4, the 6to4 relay anycast, NAT64 and discard-only |
| The classic bypass | `publicIP` | **v4-mapped v6 is normalised before the CIDR check**, so `::ffff:10.0.0.1` cannot walk past it. This is the one most implementations miss |
| Re-judged per redirect | `newClient` | `CheckRedirect` re-runs `checkTarget`, *and* `DisableKeepAlives` means every hop opens a new connection through `safeDial` — so the address check is per hop for free |
| Not a port scanner | `webPorts` | A public address is still an address with an SSH daemon on it; the port allowlist is why one redirect cannot turn the chat box into a scanner |
| The fetch is ours, not theirs | `get` | Exactly two headers, neither identifying the rider nor carrying a session |
| Bounded | throughout | Redirect hops, dial timeout, response-header timeout, overall timeout, and a byte cap on every body — `Content-Length` is never trusted |

Tested, not merely asserted: `guard_test.go` exercises `127.0.0.1`, `10.1.2.3`, `::1`, `fe80::1`,
`169.254.169.254` — the cloud metadata endpoint by name — and a hostname that *resolves* inward,
which is the rebind case rather than the literal one.

## The image proxy

The one place a stranger's bytes are served from WattRoom's own origin, and it is the most carefully
built surface read in any of today's audits. Auth required, per-rider rate limit, target checked,
fetched through the guarded client, then: a five-entry content-type allowlist, `nosniff`,
`Content-Security-Policy: default-src 'none'; sandbox`, `Cache-Control: private`, and a byte cap
that truncates rather than copies forever.

**SVG is deliberately absent** from the allowlist, and the comment says why the header alone was not
considered enough — an SVG is a document, and served from our origin a rider who opens it in a tab
is running a stranger's markup as WattRoom. Choosing not to serve it at all rather than relying on
the CSP is the right instinct.

## What the GIF picker actually is

Not a second SSRF surface, and not a byte proxy at all. `GET /api/gifs` is the only route; it
queries a fixed API base. The images themselves load in the client straight from GIPHY, gated by
`renderable`: https only, host matched against `^(media\d*|i)\.giphy\.com$`, and a `.gif`/`.webp`
suffix. That is ADR-0031's rule applied — bytes from a host *we* chose load directly; bytes from a
host a rider chose go through the proxy above.

## Also checked

- **The in-memory maps are bounded.** The unfurl cache flushes at `maxCacheKeys` and the rate-limit
  buckets cap at `maxRiderKeys`, so a signed-in rider cannot grow the process by unfurling distinct
  URLs. This codebase caps its other maps for the same reason (`challengeMax` in the passkey store),
  and this one is not an exception.
- **The OG renderer's input is bounded** before it reaches the font: a room name is capped at 60
  bytes at both write paths, and `fit` shrinks and truncates to the card rather than trusting length.
- `checkTarget` skips the port policy when `s.ports` is nil, which reads like a control failing
  open — it is a documented test seam (*"nil means any (tests only)"*) and the only constructor
  always sets it. Recorded because the next reader will look twice at it too.

## What was not covered

Nothing was exercised against a hostile server: this is a code read plus the existing unit tests, so
it says nothing about behaviour against a host that redirects slowly, sends a wrong
`Content-Length`, or stalls mid-body. `internal/og`'s font rendering was read for input bounds only.
The clip fetch of [ADR-0033](../decisions/0033-a-clip-is-a-file-the-room-fetches.md) is a client
fetch of our own file and is not an outbound surface.
