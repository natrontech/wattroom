# Audit: the public surfaces (2026-09-09)

**Slice.** What a stranger, a crawler or a link-preview bot can obtain: every route that answers without a session or with only a token, the OG share cards, shared rides and the rider page, personal tokens, the unfurl proxy, the SPA fallback and its headers, robots, the health/metrics/version routes, the avatar and crew-image routes, the desktop deep link.

**Excluded.** Auth (audited twice), mail, the room socket, uploads, DMs, the shell's updater; the crew door itself (crews audit) and outbound fetching (2026-09-08).

**Method.** One read-only Explore agent at `1df63d08`+ against WATTROOM.md's privacy row, ADR-0008/0012/0017/0021/0024/0038/0039 and the rules; every unauthenticated route classified (the table is in the report on #1734–#1739). The high findings verified by reading the cited code before filing.

## Findings and where they went

| # | Finding | Kind | Disposition |
|---|---|---|---|
| 1 | The share card and the shell's `<title>` named any room to the open web; ADR-0039 says public means signed-in riders | privacy, high | #1734 → **#1746** (listed rooms only) |
| 2 | `robots.txt` allowed everything and every personal path answered 200 with the shell | privacy, high | #1734 → **#1746** |
| 3 | The crew door's image route skipped the guess budget the door spends | security | #1736 → **#1746** |
| 4 | A personal read token could read another rider's trophy case (one wiring argument) | privacy | #1736 → **#1746** |
| 5 | CSP is one directive; `script-src`/`connect-src`/`img-src` never landed | not-built | #1737 |
| 6 | No HSTS, no Permissions-Policy anywhere | security | #1737 |
| 7 | `/metrics` is mounted bare and its "aggregate by construction" comment is false | security/decision | #1738 (`needs-human-input`) |
| 8 | The share card renders a 1200×630 PNG per request with no cache or budget | security, low | #1739 |
| 9 | One route returned `err.Error()` — the one a stranger can post to | drift | #1736 → **#1746** |
| 10 | The unfurl cache is a cross-rider "has anyone opened this URL" oracle | privacy, low | #1739 |
| 11 | Personal JSON carried no `Cache-Control` | privacy, low | #1736 → **#1746** |

## Checked and found sound

- **The rider page's boundary is exactly ADR-0024**: strangers and pending-out get the unknown-id 404 with one message; presence follows ADR-0012; no watts, HR, weight or FTP in the payload.
- **A shared ride never opens to a friend**: the ride detail is owner-scoped in the query; `/u/[id]` uses ride ids only as list keys.
- **Avatars and crew images**: UUID paths, signed-in required, `private, no-cache`, nosniff, ETag.
- **Calendar tokens**: ~122 bits, constant-time compare, instant rotation, `private, no-store`, RFC 5545 escaping, never logged.
- **Personal tokens**: 32 random bytes, hashed at rest, shown once, GET-only, capped at 10, revoke 404s across accounts.
- **The desktop deep link cannot navigate anywhere**: `wattroom://auth/<token>` only, target fixed to the login handoff, asserted in the shell's smoke spec.
- **The SPA fallback caches correctly** (immutable hashed assets, `no-cache` + weak ETag on the shell); `/api/` never falls through to it; `/api/version` discloses tag, short sha and build time only; `nosniff` and the referrer policy are global and tested; the server's own mail-link pages carry `no-referrer`, `no-store` and `noindex`.
- **Error bodies are clean**: after #1746, no `err.Error()` reaches a response anywhere in the server.

## Decisions surfaced

Whether a room has a public share card at all (landed: listed-only, ADR-0039 intact); where `/metrics` lives (#1738); whether personal tokens should carry a capability column (ADR-0017's own escape hatch — noted on #1736).
