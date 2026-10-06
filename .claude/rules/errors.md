# Errors are UX

A good error says what went wrong, why, and what to do. "Something went wrong" is a bug.

## API (Go)

Every error has one shape:

```go
type ErrorResponse struct {
    Error   string `json:"error"`           // validation_error | invalid_request | unauthorized | forbidden | not_found | conflict | rate_limited | internal_error
    Message string `json:"message"`         // human, actionable
    Field   string `json:"field,omitempty"` // for form validation
}
```

- Validate in the first lines of every handler; bounds come from docs/SPEC.md.
- Log the internals with `slog`; return a safe message. Never `Message: err.Error()`.
- Status: 400 validation, 401 no or expired auth, 403 not your crew or a channel you may not enter, 404, 409 duplicate, 429 over a per-account ceiling, 503 a shared resource is full, 500 unexpected. 429 and 503 carry `rate_limited`: the rider's move is to wait and retry, and their input was not at fault.
- Every endpoint test covers the happy path, 400, 404 and 401.

## WS refusals (Go)

A refused command sends `protocol.Error{Code, Message}`.

- `Code` comes from the same closed set; there is no second vocabulary. A full queue is `rate_limited`.
- One prefix is allowed, to route: `<surface>_<code>` (e.g. `jukebox_rate_limited`) lands the message beside the control the rider touched. Add one only for a surface with its own place to show a refusal.
- A deliberate tap the rider watches (chat, the deck, a poke) answers when refused. Fire-and-forget taps (a cheer, a reaction, a soundboard fire) stay quiet.

## Frontend

- Every API call shows its failure; every page has loading, error-with-retry, empty and content states.
- A field error goes inline under the field, a submit failure in a banner atop the form, a background result in a toast.
- Reversible actions run at once with an undo toast.
- Ask for confirmation only when an action cannot be undone **and** its cost is paid outside the click: by stored data (delete a crew, a channel, the account, rides), by another person (revoke a coach's token) or by a link someone else's software subscribes to (reset a calendar link). Never ask when the only cost is clicking again (leave a voice channel, unpair a trainer, close a session).
  - Hiding a control in an expander is not a confirmation, and how many people are affected doesn't change the rule.
  - The confirm names the breakage and the way back ("Every calendar subscribed to the old link stops updating. Each one has to subscribe again with the new link."); its button names the act ("Reset the link"). `confirm()` in `$lib/confirm.svelte` owns "Keep it", the danger token and the focus order; a call site may only swap in "Keep riding" or "Keep going".
- Never render a button that will fail: without LiveKit, the jukebox or a trainer, disable it with a one-line hint or hide it.
- Ride-critical errors (trainer lost, socket dropped) are persistent dashboard status, never a toast.
