# Audit: the AI-facing surface — MCP and personal tokens (2026-09-09)

**Slice.** `server/internal/mcp/` (the JSON-RPC transport at `POST /mcp` and its two tools), `server/internal/tokens/` (personal read tokens, the `readSource`, every route a bearer reaches), the settings card that mints tokens, and anything that talks to or about a model.

**Excluded.** Auth, the desktop handoff, the public-surfaces audit's routes.

**Method.** One read-only Explore agent at `5d6beed8` against ADR-0017, WATTROOM.md's privacy row and its Strava rule (RESEARCH §13.5), ADR-0008, ADR-0016 and the rules. The high finding verified by reading the cited code before filing.

## Findings and where they went

| # | Finding | Kind | Disposition |
|---|---|---|---|
| 1 | A read token pulled every heartbeat of every ride and the `.fit` (ADR-0008: never in a shared artifact) | privacy, high | #1757 → **#1761** (403 on the detail and the export for a bearer) |
| 2 | The Strava delivery record (`remoteId`, `error`) was bearer-reachable, so could enter a context window | privacy | #1757 → **#1761** (rides only on the detail) |
| 3 | An out-of-range `limit` was silently 30 | bug | #1758 → **#1761** (`-32602`) |
| 4 | `/mcp` had no budget and no deadline; every call is an UPDATE | security | #1758 → **#1761** (60/min per account, 30/min per address, 10 s) |
| 5 | The 401 was JSON labelled text/plain | drift | #1758 → **#1761** |
| 6 | `list_rides` could not page and dropped the id and four fields | drift | #1758 → **#1761** (`before`, `more`, the HTTP list's fields) |
| 7 | Batch and oversized bodies were `-32700`; parse errors lacked `"id": null` | drift | #1758 → **#1761** |
| 8 | ADR-0017 no longer described what exists | drift | **#1761** (amendment: the route list, the HR and Strava rulings) |
| 9 | Revoking a token is one silent, irreversible click | polish | #1759 |
| 10 | The once-shown secret has no copy button | polish | #1759 |
| 11 | The tool with an argument, the bounds and the boundary were untested | tests | #1758 → **#1761** (`TestTransportEdges`; the two-user boundary over the real tokens service stays) |
| 12 | A failed ride read was overwritten by a failed first-ride read (a slip in #1701) | bug | #1758 → **#1761** |
| 13 | The two audit test files carried each other's names | polish | **#1761** |

## Checked and found sound

- **No cookie ever authenticates `/mcp`**; CSRF is structurally impossible.
- **The GET-only rule holds**; the bearer-reachable routes are exactly progression, the ride list and best, the trophy cases (own since #1746), and `/mcp`.
- **Token hygiene**: 32 random bytes, SHA-256 at rest, shown once, never listed, capped at 10, revoke 404s across accounts, body limit after auth, no internal error or token in any reply or log line (which matters: the log ring ships into feedback issues).
- **No LLM client anywhere in the product** — WattRoom talks to no model; it only serves one.
- **The two tools** return the token owner's own summaries and progression only: no other rider's name, watts, roster, presence, medals, chat or DMs; no blob is ever read.

## Decisions surfaced

#1760: heart rate under ADR-0008 (landed: never across a bearer; a per-token opt-in or ADR-0017's capability column as the relaxation), Strava's returned id in a context window (landed: never across a bearer), and whether the coach card names the model provider.
