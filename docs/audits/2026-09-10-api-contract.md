# Audit: the HTTP API contract — 2026-09-10

**Slice.** Every handler registered on the mux under `server/internal/**` — auth, account, rooms (crews, schedule, calendar, grants, images), rides, riders, workouts, dms, friends, presence, jukebox/tracks/playlists/board, notify, feedback, strava, av, hud, whats-new, health — against `.claude/rules/errors.md` and `server/internal/httpx/`: the one error shape and its machine codes, validation at the boundary with SPEC's bounds, 404-not-403 for what is not yours, no `err.Error()` in a response, no PII on a log line, the CSRF boundary, and each family's happy / 400 / 404 / 401 test coverage.
**Excluded**: the WebSocket protocol (`hub/ws.go`, `hub/lobby.go`), `/mcp` and the synthetic token (2026-09-09), the desktop shell, the outbound halves of strava and unfurl, the frontend half of errors.md.
**Method.** One Explore agent at `5c511190`, read-only against the rule, `httpx`, ADR-0040 with its #1823 amendment, and the five overlapping records of the two previous days so their open items were not re-filed; every finding verified by reading the cited code before filing. Nothing was run against a live server.

## Filed

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| #1981 | Room and crew bans evict by the raw request string: a well-formed upper-case id passed `ParseUUID`, wrote the row, and never closed the socket | high, security | fixed (#1992) |
| #1982 | The HTTP chat door has no ceiling while its socket twin allows one line a second and DMs got per-account budgets in #1836 | high, security | fixed (#1994) |
| #1983 | gamify and progression read a session-lookup failure as "not signed in" — the one code the app never retries | bug | fixed (#1992) |
| #1984 | Nine `ErrNoRows` checks in dms, friends, riders and rooms fold a database failure into a 404 or 403 | bug | fixed (#1992): split, `Fail` with a log line; the socket `Authorize` returns the error |
| #1985 | `/api/healthz` and the LiveKit webhook answer outside the errors.md shape | bug | fixed (#1992) |
| #1986 | Name limits counted in bytes, so an accented name got a third of its length; the numbers lived nowhere in SPEC | bug | fixed (#1992): runes at seven sites, one SPEC paragraph |
| #1987 | A chat line whose image belongs to another room is a 500 with a retry that could never work | bug | fixed (#1992): checked first, a 400 on `imageId` |
| #1988 | Opening a room in a crew you are not in answers 403 where every other crew route says 404 | security | fixed (#1992) |
| #1989 | The webhook rejection logged the caller's address — the one piece of PII in a log ring a feedback report staples to an issue | security | fixed (#1992) |
| #1990 | A failed export streams a silent, truncated zip under a 200 | bug | fixed (#1993): built whole first, `Content-Length`, a 500 on failure |
| #1991 | Polish: two unreachable 403 branches in tracks, two hand-written 500s in dm reactions, one raw UUID in a log | low | fixed (#1992) |

Known and open, cited rather than re-filed: #1547, #1737, #1089, #1739, and the open items of the 2026-09-10 auth-account, crews-reaudit, jukebox and messages records.

## Checked and found sound

- **`httpx` itself** — `WriteError`/`WriteFieldError`/`WriteJSON`/`Fail` are the one shape; `DecodeStrict` bounds at 64 KiB, refuses unknown fields and the three CORS-simple encodings ADR-0040's amendment names, table-tested; `ReadImageUpload` sniffs rather than believes and is the single trust boundary for all four image routes, tested at exactly `MaxImageBytes` and one over.
- **`rides` is the model family** — owner scoping in the `WHERE` so someone else's ride is 404 with the comment saying why; the bearer-token narrowing a 403 with a reason; `before`/`except` parsed and refused; the sample loop bounds watts, cadence, heart rate, bias and count against named constants; the export retry answers 409 rather than a 200 that promises nothing; the one bare decoder documented, `MaxBytesReader`-bounded and behind `RequireUser`.
- **`customworkouts`** — validates before the store, a bad id is 404 not 400, `owner_id` in the `WHERE`, and `workout.Parse`'s depth / repeat / segment budget genuinely bounds the nested-repeat expansion the 2026-09-09 audit found.
- **`rooms/schedule`** — `plannableAt` on both write paths, room-scoped reschedule and delete with `ErrNoRows` → 404 and everything else → `Fail`, the started-once 409 from the row count, one RSVP handler for `PUT` and `DELETE`.
- **`rooms/grants` and the crew reads** — `crewByID` enforces 404-not-403; the door, the join and the door image spend one per-address budget; the pre-emptive ban of nobody is a 404.
- **`dms` reads** — pair-scoped in SQL, every failure through `Fail`, the #1818 budgets in place.
- **`riders` and `gamify` payloads** — one message for "no such rider" and "not yours"; progress and counts zeroed for a non-self viewer; medals re-scoped to shared rooms.
- **The CSRF boundary** — `RequireUser` refuses a foreign `Origin` on every mutating verb in one place; logout checks it directly because it must work without a session; every mutating handler in the slice reaches the session through it or a `rooms.Require*` wrapper.
- **Query-param bounds** — chat `limit` 1–500, tracks `limit`/`offset` clamped inside int32, the directory offset clamped.
- **No `err.Error()` reaches a response** — the 2026-09-09 finding still holds; `workout.RefusalMessage` is the one sanctioned path for an error's text and says so.

## Test coverage by family

Every family has its happy path and its 401; rooms, rides, riders, workouts, dms, friends, chat, tokens, auth and the playlist family have all four. Gaps, all low and none on a money or security path: `account` has no validation or not-found case, `av` no 400 for a malformed webhook body or bad slug, `progression` neither, `gamify` no 400 for a malformed rider id, and `tracks` carries 26 happy-path assertions against 2 validation ones across five distinct 400 branches.

## Not checked

- The WebSocket handshake's refusals (`hub/ws.go`, `hub/lobby.go`) use `http.Error` — the same shape drift as #1985, but a browser's `WebSocket` never exposes a handshake body, so it was not filed; `lobby.go`'s 404 for "presence unavailable" is worth a look by whoever next owns that file.
- Anything requiring the app to run: every finding was read off the code and none reproduced against a live server; the ceilings' window semantics (`budget` is fixed-window by design, documented there); the frontend's handling of the new 429s on the chat door beyond `api.ts`'s generic branch.
