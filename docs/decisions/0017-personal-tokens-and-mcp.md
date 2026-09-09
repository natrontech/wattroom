# 0017 — Coach access: personal read tokens + a hand-rolled MCP endpoint

- Status: accepted
- Date: 2026-08-31

## Context

#222's last slice: a rider's personal coach AI (Claude via MCP, or any HTTP
client) should read the same progression data the UI shows. WattRoom is
passwordless (social OAuth only, WATTROOM.md) and its API is cookie-authed —
neither works for a headless agent. Something must authenticate machines
without loosening the human auth story.

## Decision

**Personal access tokens, read-only, per rider.** A token is 32 random bytes
(`wrt_` + hex), shown exactly once at creation, stored only as a SHA-256 hash.
Riders create and revoke them on the profile page; deleting the account
cascades them away. A token authenticates **only reads of the owner's own
data**: the shared token source accepts bearer auth solely for `GET`, so no
token can ever post rides, join rooms, or touch another rider — the
room-scoped privacy seams don't even see tokens.

**MCP: a minimal, hand-rolled streamable-HTTP endpoint (`POST /mcp`).** The
official Go SDK is a new dependency for what is, at this surface, ~200 lines
of JSON-RPC: `initialize`, `tools/list`, `tools/call` over single POST
round-trips (no SSE streaming, no sessions — every call is stateless and
bearer-authed). Stdlib-first is a locked decision and the shape fits.
ponytail: if the protocol surface grows (subscriptions, resources, sampling),
swap the hand-rolled layer for the official SDK rather than extending it.

**The tools mirror the HTTP API, not a second data path.** `get_progression`
returns exactly what `GET /api/progression` serves (the assembly function is
shared); `list_rides` mirrors the ride-summary list. If the UI can show it,
the coach can read it — and nothing more.

## Consequences

- A leaked token exposes the owner's own training data, read-only, until
  revoked. Acceptable for alpha; scoped tokens or expiry can layer on later
  without schema changes (add columns, not tables).
- Hand-rolled MCP means tracking spec drift ourselves. The endpoint pins the
  protocol version it answers with and stays POST-only — the narrowest
  compliant shape; clients that require SSE streams are out of scope until
  the SDK swap.
- last_used_at gives riders a "is this token dead?" signal on the profile at
  the cost of one row update per authenticated call — fine at alpha scale.

## Amendment — what a bearer reaches, and what it never does (2026-09-09, #1757)

Tokens are minted on **Settings › Data**, not the profile page. A bearer
authenticates `GET /api/progression`, `GET /api/rides`, `GET /api/rides/best`,
`GET /api/me/trophies` and `POST /mcp` (whose two tools, `get_progression` and
`list_rides`, mirror the first two). It never authenticates a write, and since
#1746 never a route keyed on another rider's id.

Two rulings the original text did not make:

- **Heart rate never crosses a bearer.** ADR-0008 keeps HR out of any shared
  artifact, and a rider's own model provider is a third party; the per-second
  record (`GET /api/rides/{id}`) and the `.fit` (`…/export`) refuse a bearer
  with a 403. A per-token opt-in, or the capability column below, is the
  relaxation on offer (#1760) — not the default.
- **Nothing Strava handed back crosses a bearer either.** The delivery record
  (`export.remoteId`, `export.error`) rides only the detail, which a bearer
  cannot open; RESEARCH §13.5 names ingestion into a context window, and the
  cost of being wrong is asymmetric.

The MCP transport budgets calls per account and guesses per address, bounds
a tool call to ten seconds, and refuses a batch with `-32600` (batching left
the protocol in 2025-06-18).
