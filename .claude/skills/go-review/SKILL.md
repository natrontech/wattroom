---
name: go-review
description: Review Go code in /server for idioms, concurrency safety, and security beyond what golangci-lint catches. Use when reviewing or writing non-trivial Go — especially hub, BLE-protocol, or stats-pipeline code.
---

# Go review — what lint can't see

golangci-lint (gosec, errorlint, noctx, bodyclose, errcheck with type assertions) already runs in CI. Do not re-report what it catches. Review for the things that need judgment:

## Concurrency (the hub is the hot spot)

- Every goroutine has a defined owner and exit condition. A `go func()` with no way to stop is a leak — name where it terminates.
- No blocking sends/writes while holding a mutex. The hub pattern is: lock → copy what you need → unlock → do I/O on the copy (see `room.run()`).
- Slow consumers must never stall the room tick. Timeouts or drop-the-message, never unbounded blocking.
- Shared state changes go through the owning goroutine or a mutex — never both patterns for the same field.
- Tests for concurrent code: deterministic, no `time.Sleep` synchronization; prefer `testing/synctest` for timer-driven logic.

## Errors & context

- `context.Context` flows from the request; no `context.Background()` inside request paths (background jobs get their own with timeout).
- Errors are wrapped with `%w` and carry what the operator needs (room code, rider id) — but never secrets or tokens.
- Errors either handled or returned, never both (no log-and-return double reporting).

## Security (this app's specifics)

- WS messages are untrusted input: validate bounds (watts 0–3000, seq monotonic) before they touch room state or the DB.
- Anything derived from `r.URL`/path values is attacker-controlled — never into SQL (sqlc params only), file paths, or log injection (slog handles quoting, but don't build strings).
- Rate/size limits on client → server messages; a hostile client must not be able to grow server memory unboundedly.
- Privacy rules are load-bearing: metrics never leave the room, no new endpoint exposes another user's data. Flag ANY loosening.

## Shape

- Accept interfaces, return structs; interfaces defined where consumed, not implemented.
- No package-level mutable state. `internal/` for everything not deliberately public.
- New dependency = justification in the PR; stdlib-first is a locked decision.
