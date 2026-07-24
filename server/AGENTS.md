# server/ — Go rules (all agents)

Rules an agent would otherwise get wrong; cross-cutting rules live in the root AGENTS.md.

- **Hub discipline**: live room state exists ONLY inside `internal/hub`. Never add DB calls, HTTP calls, or blocking I/O inside the tick loop or while holding a room mutex — lock, copy, unlock, then do I/O.
- Every `go func()` names its exit condition. Goroutines that "run forever" need a `ponytail:` comment stating the ceiling.
- WS input is untrusted: bounds-check metrics (watts, seq) before they touch state. New message types go in `internal/protocol` + `make protocol`.
- Trainer/BLE knowledge lives client-side; the server never speaks FTMS/WCPS.
- `log/slog` only, always with room/rider context keys; never log tokens or PII beyond rider display ids.
- DB (when it lands): sqlc + pgx only — no ORM, no string-built SQL. Migrations via goose in `migrations/`.
- Tests: table tests, `-race` always; timer-driven logic uses `testing/synctest`, never `time.Sleep`.
- Errors: wrap with `%w`; handle or return, never both.
- Run the review checklist in `.claude/skills/go-review/SKILL.md` (plain markdown — applies to any agent) on non-trivial hub/protocol changes.
