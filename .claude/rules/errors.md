# Errors are UX

A good error says what went wrong, why, and what to do. "Something went wrong" is a bug.

## API contract (Go)

Every API error returns one shape:

```go
type ErrorResponse struct {
    Error   string `json:"error"`           // machine code: validation_error | invalid_request | unauthorized | forbidden | not_found | conflict | internal_error
    Message string `json:"message"`         // human, actionable
    Field   string `json:"field,omitempty"` // for form validation
}
```

- Validate at the boundary — first lines of every handler. Bounds from docs/SPEC.md, never invented.
- Log internal details (`slog` with context keys), return a safe message. Never `Message: err.Error()`.
- Status codes: 400 validation, 401 no/expired auth, 403 not-your-room, 404, 409 duplicate, 500 unexpected.
- Every endpoint test covers: happy path, validation → 400, not found → 404, no auth → 401.

## Frontend

- Every API call handles failure with user feedback; a page never renders blank on error (loading / error-with-retry / empty / content — always all four states).
- Placement: field-level → inline under the field; submit failure → banner atop the form; background action result → toast.
- **Undo over confirm**: reversible actions run immediately with an undo toast. Confirmation dialogs only for the genuinely destructive (delete room, delete account, purge rides).
- Never render a button that will fail: if LiveKit/jukebox/trainer isn't available, the affordance is disabled with a one-line hint or hidden — not a 503 on click.
- Ride-critical errors (trainer disconnect, WS drop) surface as persistent status on the dashboard, not a transient toast — the rider is on a bike, sweating, three meters away.
