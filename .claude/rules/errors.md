# Errors are UX

A good error says what went wrong, why, and what to do. "Something went wrong" is a bug.

## API contract (Go)

Every API error returns one shape:

```go
type ErrorResponse struct {
    Error   string `json:"error"`           // machine code: validation_error | invalid_request | unauthorized | forbidden | not_found | conflict | rate_limited | internal_error
    Message string `json:"message"`         // human, actionable
    Field   string `json:"field,omitempty"` // for form validation
}
```

- Validate at the boundary — first lines of every handler. Bounds from docs/SPEC.md, never invented.
- Log internal details (`slog` with context keys), return a safe message. Never `Message: err.Error()`.
- Status codes: 400 validation, 401 no/expired auth, 403 not-your-crew (or a channel you may not enter), 404, 409 duplicate, 429 over a per-account ceiling, 503 a shared resource is full, 500 unexpected. The last three all carry `rate_limited`: the rider's move is the same in each case — wait, then try again — and the code says so without pretending the refusal was their input's fault.
- Every endpoint test covers: happy path, validation → 400, not found → 404, no auth → 401.

## WS command refusals (Go)

A refused WS command sends `protocol.Error{Code, Message}` — the same two halves, minus `Field`: a socket frame has no form to point at, and no status code to carry either, so `Code` is the whole machine answer.

- **`Code` comes from the same closed set.** There is no second vocabulary: `jukebox_queue_full` and its six siblings told a client nothing the set does not, and no rule knew them (2026-09-17 audit). A queue that is full is `rate_limited`, like the 503 it would be over HTTP — the rider's move is to wait and try again, and nothing about their paste was wrong.
- **One prefix is allowed, and it routes rather than classifies**: `<surface>_<code>`, e.g. `jukebox_rate_limited`. The client lands the message beside the control the rider touched instead of in the voice channel's own refusal slot, and the part after the prefix is still one of the set. Add a prefix only for a surface that has its own place to show a refusal.
- **A deliberate tap that a rider watches for a result answers when it is refused** (#1762, #2232): chat, the deck, a poke. Fire-and-forget taps — a cheer, a reaction, a soundboard fire — stay quiet, because the rider has lost nothing.

## Frontend

- Every API call handles failure with user feedback; a page never renders blank on error (loading / error-with-retry / empty / content — always all four states).
- Placement: field-level → inline under the field; submit failure → banner atop the form; background action result → toast.
- **Undo over confirm**: reversible actions run immediately with an undo toast. Confirmation dialogs only for the genuinely destructive (delete a crew or a channel, delete account, purge rides).
- **When there is no undo to offer** (#1493). The axis is undo-ability, not data loss, so the case the line above leaves open is the action that is irreversible without destroying anything: revoking a coach's token, resetting a crew's calendar link. **Ask when an action cannot be undone _and_ its cost is paid outside the click** — by stored data, or by another person, or by a link someone else's software is already subscribed to. Ask nothing when the only cost is that the rider clicks again: leaving a voice channel, unpairing a trainer, closing a session are re-doable and stay immediate.
  - **Friction is not a question.** An _Advanced_ expander and a per-item button are discovery friction: they say where a control is, never what it breaks. A rider who went looking for "Reset calendar link" and opened the expander to find it still does not know that every calendar subscribed to the old one goes quiet. Placement never substitutes for the ask.
  - **Count the shape, not the people.** "It only breaks one tool the rider set up themselves" does not narrow it — a coach token was minted _for a coach_, and it is their tooling that stops, on their schedule, without their being told. One click, someone else's breakage, is one shape and takes one treatment; a rule whose boundary is how many others were affected cannot be applied to the next action.
  - **A confirm is held to the first line of this file**: what happens, why, and what to do. The body names the breakage and the way back — "Every calendar subscribed to the old link stops updating. Each one has to subscribe again with the new link." The action button names the act ("Reset the link"), and `confirm()` in `$lib/confirm.svelte` owns the safe answer's spelling ("Keep it"), the danger token and the focus order — call sites do not restate them. The one thing a call site may name is the mid-effort answer, "Keep riding" or "Keep going", and the type admits no other (#2887).
- Never render a button that will fail: if LiveKit/jukebox/trainer isn't available, the affordance is disabled with a one-line hint or hidden — not a 503 on click.
- Ride-critical errors (trainer disconnect, WS drop) surface as persistent status on the dashboard, not a transient toast — the rider is on a bike, sweating, three meters away.
