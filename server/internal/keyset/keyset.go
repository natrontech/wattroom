// Package keyset is the one home of the `(timestamp, id)` cursor WattRoom's
// paged lists share: `/api/rides` (#2064), `/api/workouts` (#1414, #2048) and
// the MCP `list_rides` tool all hand back the last row of a full page and read
// that pair in again.
//
// It is its own package rather than part of httpx or store because it spans
// both and belongs to neither. httpx is deliberately pgtype-free — the API
// error shape plus a static page shell — and a cursor for these queries deals
// in `pgtype.Timestamptz`/`pgtype.UUID`. store has the pgtype helpers, but it
// owns the connection and the schema's lifecycle and would then also carry
// rider-facing message copy. And one of the three consumers is not HTTP at
// all: the MCP tool answers JSON-RPC -32602, so a home that presumes a
// ResponseWriter cannot serve it. What all three share is the cursor, so the
// cursor is what gets the package.
package keyset

import (
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
)

// The names on the wire, spelled once. Every list reads these two query
// parameters or JSON arguments and answers with the `next`-prefixed pair.
const (
	paramBefore   = "before"
	paramBeforeID = "beforeId"
	fieldBefore   = "nextBefore"
	fieldBeforeID = "nextBeforeId"
)

// Cursor is a position in a list ordered `by ts desc, id desc`: a timestamp
// and the id that breaks its tie, both or neither. The zero Cursor is the
// first page.
//
// The halves are unexported, and Apply is the only way out, because half a
// cursor is not something the database refuses. `(ts, id) < (:before, null)`
// does not error — the row comparison yields NULL for every row that shares
// the boundary timestamp, so those rows are filtered and the read quietly
// reverts to `ts < :before`, which is exactly the silent page-boundary skip
// #2064 and #1414 existed to fix. It cannot be expressed through this type.
type Cursor struct {
	at pgtype.Timestamptz
	id pgtype.UUID
}

// Parse reads the pair a caller handed back. Neither half is the first page
// and no error; one half, an unparsable time, or an unparsable id is a
// refusal. noun is what an id names — "ride", "workout" — because errors.md
// wants the message to say what this caller got wrong rather than a shape.
//
// The refusal comes back through the error interface, because the caller that
// has nothing to say about which half was wrong — the MCP tool, which answers
// one sentence as -32602 — should need no type switch to use it. FromQuery is
// the caller that does, and it is in here.
func Parse(before, beforeID, noun string) (Cursor, error) {
	cur, err := parse(before, beforeID, noun)
	if err != nil {
		return Cursor{}, err
	}
	return cur, nil
}

func parse(before, beforeID, noun string) (Cursor, *refusal) {
	if (before == "") != (beforeID == "") {
		missing := paramBefore
		if before != "" {
			missing = paramBeforeID
		}
		return Cursor{}, &refusal{
			sentence: paramBefore + " and " + paramBeforeID +
				" are one cursor — send the pair a previous page gave you, or neither",
			field: missing,
		}
	}
	if before == "" {
		return Cursor{}, nil
	}
	at, err := time.Parse(time.RFC3339, before)
	if err != nil {
		return Cursor{}, &refusal{sentence: paramBefore + " must be an RFC 3339 time", field: paramBefore}
	}
	id, err := store.ParseUUID(beforeID)
	if err != nil {
		return Cursor{}, &refusal{sentence: paramBeforeID + " must be a " + noun + " id", field: paramBeforeID}
	}
	return Cursor{at: pgtype.Timestamptz{Time: at, Valid: true}, id: id}, nil
}

// FromQuery is Parse over a request's query string, answering a bad cursor in
// the API error shape itself: the handler's line is `cur, ok := ...; if !ok {
// return }`, the shape RequireUser already uses. The empty pair is a valid
// zero Cursor and true.
func FromQuery(w http.ResponseWriter, r *http.Request, noun string) (Cursor, bool) {
	cur, err := parse(r.URL.Query().Get(paramBefore), r.URL.Query().Get(paramBeforeID), noun)
	if err != nil {
		// The period is added here rather than carried in the sentence: the
		// API's messages are sentences (errors.md), and the JSON-RPC messages
		// the MCP tool answers with are not.
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", err.sentence+".", err.field)
		return Cursor{}, false
	}
	return cur, true
}

// Apply narrows a query's parameters to the rows after the cursor. It takes
// the pair as two pointers, rather than returning two values, so that there
// is no call site at which one half can be assigned and the other forgotten
// — see Cursor on why the database would not complain if one were.
func (c Cursor) Apply(at *pgtype.Timestamptz, id *pgtype.UUID) {
	if !c.at.Valid {
		return
	}
	*at, *id = c.at, c.id
}

// Next writes the cursor a full page's last row leaves behind, under the
// names every client reads back.
//
// RFC3339Nano and UTC. Nano because the columns are microseconds while the
// display fields these lists also carry are coarser — seconds in the rides
// list, milliseconds on the workout shelf — and a cursor rounded down by a
// fraction steps over every row inside the interval it truncated (#2064,
// #1414). UTC so the cursor never carries a "+" a caller has to remember to
// percent-encode before handing it back.
func Next(body map[string]any, at pgtype.Timestamptz, id pgtype.UUID) {
	body[fieldBefore] = at.Time.UTC().Format(time.RFC3339Nano)
	body[fieldBeforeID] = store.UUIDString(id)
}

// refusal is a cursor a caller cannot page with, in the two voices its
// consumers speak: Error is the bare sentence a JSON-RPC -32602 carries, and
// FromQuery renders the same refusal as errors.md's 400, adding the field so
// a client can be told which half of the pair it got wrong.
type refusal struct {
	sentence string
	field    string
}

func (e *refusal) Error() string { return e.sentence }
