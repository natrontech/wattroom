package keyset

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store"
)

const anID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301"

// The whole point of the type: there is no input, valid or invalid, that
// yields a cursor with one half set. A `(ts, id) < (:before, null)` pair is
// not an error Postgres reports — the comparison is NULL for every row that
// shares the boundary timestamp, so those rows are filtered and the read
// quietly goes back to skipping them (#2064, #1414). Applying a cursor is
// therefore all-or-nothing, and this is the test that says so.
func TestApplyIsAllOrNothing(t *testing.T) {
	full, err := parse("2026-09-10T10:00:00.123456Z", anID, "ride")
	if err != nil {
		t.Fatalf("a whole cursor was refused: %v", err)
	}
	var at pgtype.Timestamptz
	var id pgtype.UUID
	full.Apply(&at, &id)
	if !at.Valid || !id.Valid {
		t.Fatalf("a whole cursor applied half: at.Valid=%v id.Valid=%v", at.Valid, id.Valid)
	}
	if got := at.Time.UTC().Format(time.RFC3339Nano); got != "2026-09-10T10:00:00.123456Z" {
		t.Errorf("the cursor lost precision: %s", got)
	}

	// The first page: nothing to narrow by, and nothing written — not a
	// timestamp with an absent tie-break.
	var untouched pgtype.Timestamptz
	var untouchedID pgtype.UUID
	Cursor{}.Apply(&untouched, &untouchedID)
	if untouched.Valid || untouchedID.Valid {
		t.Error("the empty cursor wrote a half pair into the query")
	}
}

// Every way a caller can get the pair wrong, and what it is told. The noun
// rides along because "beforeId must be a ride id" and "a workout id" are
// what make the message actionable (errors.md) — the shape is not the point.
func TestParseRefusals(t *testing.T) {
	for name, tc := range map[string]struct {
		before, beforeID, noun string
		field                  string
		wantIn                 string
	}{
		"time alone":      {before: "2026-09-10T10:00:00Z", noun: "ride", field: "beforeId", wantIn: "one cursor"},
		"id alone":        {beforeID: anID, noun: "ride", field: "before", wantIn: "one cursor"},
		"unparsable time": {before: "yesterday", beforeID: anID, noun: "ride", field: "before", wantIn: "RFC 3339"},
		"ride id":         {before: "2026-09-10T10:00:00Z", beforeID: "nope", noun: "ride", field: "beforeId", wantIn: "a ride id"},
		"workout id":      {before: "2026-09-10T10:00:00Z", beforeID: "nope", noun: "workout", field: "beforeId", wantIn: "a workout id"},
	} {
		t.Run(name, func(t *testing.T) {
			cur, err := parse(tc.before, tc.beforeID, tc.noun)
			if err == nil {
				t.Fatal("accepted")
			}
			if cur != (Cursor{}) {
				t.Error("a refused cursor came back non-empty")
			}
			if err.field != tc.field {
				t.Errorf("field = %q, want %q", err.field, tc.field)
			}
			if !strings.Contains(err.Error(), tc.wantIn) {
				t.Errorf("message %q does not say %q", err.Error(), tc.wantIn)
			}
			// The sentence is unpunctuated here; FromQuery is what makes it
			// one of the API's sentences.
			if last := err.Error()[len(err.Error())-1]; last == '.' {
				t.Error("the bare sentence carries the API's period")
			}
		})
	}
}

// Neither half is the first page, not a refusal.
func TestNeitherHalfIsTheFirstPage(t *testing.T) {
	cur, err := Parse("", "", "ride")
	if err != nil {
		t.Fatalf("the first page was refused: %v", err)
	}
	if cur != (Cursor{}) {
		t.Error("the first page came back as a cursor")
	}
}

// The API voice: errors.md's 400 with the machine code, an actionable
// sentence and the parameter at fault, so a client can say which half it got
// wrong rather than guessing.
func TestFromQueryAnswersTheErrorShape(t *testing.T) {
	rec := httptest.NewRecorder()
	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/rides?before=2026-09-10T10:00:00Z", nil)
	if _, ok := FromQuery(rec, r, "ride"); ok {
		t.Fatal("half a cursor was accepted")
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d", rec.Code)
	}
	var body struct {
		Error, Message, Field string
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Error != "validation_error" || body.Field != "beforeId" {
		t.Errorf("got %+v", body)
	}
	if body.Message == "" || body.Message[len(body.Message)-1] != '.' {
		t.Errorf("message %q is not one of the API's sentences", body.Message)
	}
}

// A whole cursor in a query string reaches the query.
func TestFromQueryReadsAWholeCursor(t *testing.T) {
	rec := httptest.NewRecorder()
	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/rides?before=2026-09-10T10%3A00%3A00.5Z&beforeId="+anID, nil)
	cur, ok := FromQuery(rec, r, "ride")
	if !ok {
		t.Fatalf("refused: %d %s", rec.Code, rec.Body)
	}
	var at pgtype.Timestamptz
	var id pgtype.UUID
	cur.Apply(&at, &id)
	if !at.Valid || !id.Valid {
		t.Fatal("the cursor did not reach the query")
	}
}

// The cursor a full page hands back: sub-second precision kept, UTC so it
// carries no "+" a caller has to percent-encode, and both names present —
// a client that sees one and not the other cannot page at all.
func TestNextWritesAWholePairAtFullPrecision(t *testing.T) {
	at := pgtype.Timestamptz{
		Time:  time.Date(2026, 9, 10, 12, 0, 0, 123456000, time.FixedZone("CEST", 2*60*60)),
		Valid: true,
	}
	id, err := store.ParseUUID(anID)
	if err != nil {
		t.Fatal(err)
	}
	body := map[string]any{}
	Next(body, at, id)
	if got := body["nextBefore"]; got != "2026-09-10T10:00:00.123456Z" {
		t.Errorf("nextBefore = %v — precision or zone lost", got)
	}
	if got := body["nextBeforeId"]; got != anID {
		t.Errorf("nextBeforeId = %v", got)
	}
}

// A cursor this package emits is one it accepts back — the round trip is the
// contract every one of these lists asks its clients to honour.
func TestTheEmittedCursorParsesBack(t *testing.T) {
	at := pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true}
	id, err := store.ParseUUID(anID)
	if err != nil {
		t.Fatal(err)
	}
	body := map[string]any{}
	Next(body, at, id)
	before, _ := body["nextBefore"].(string)
	beforeID, _ := body["nextBeforeId"].(string)
	back, perr := parse(before, beforeID, "ride")
	if perr != nil {
		t.Fatalf("the cursor this list handed out was refused on its way back: %v", perr)
	}
	if !back.at.Time.Equal(at.Time) {
		t.Errorf("the round trip moved the cursor: %v -> %v", at.Time, back.at.Time)
	}
}
