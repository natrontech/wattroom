package account

import (
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

// A crew owner deleting their account takes their old rooms with them — and
// must not take the crew's channels' rows (#2561). M9 did not copy what a
// room held: it gave the same rows a channel and a crew and left room_id in
// place, and those rows cascaded from rooms. So the text channel's history,
// the crew's plans, another member's medal and the crew's playlist all went
// with the departing owner, while the crew passed on to its successor empty.
func TestPurgingARoomOwnerKeepsTheCrewsChannelRows(t *testing.T) {
	h := setup(t)
	ctx := t.Context()
	// Alice's crew, and her room in it. Bob stays in the crew, so it passes to
	// him rather than ending.
	place := h.createCrew(t, "alice", "bob")
	crew, text := place.crew, place.text
	roomID := h.legacyRoom(t, "alice", crew)

	// The rows as the M9 backfill left them: the room still on them, and the
	// channel and crew beside it.
	exec := func(what, sql string, args ...any) {
		t.Helper()
		if _, err := h.store.Pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", what, err)
		}
	}
	exec("line", `insert into chat_messages (room_id, channel_id, user_id, text, created_at)
		values ($1, $2, $3, 'bobs history', now())`, roomID, text, h.id("bob"))
	ride := h.createRide(t, "bob", place, "Openers", gzipped(t, `[]`))
	exec("ride", `update rides set room_id = $1 where id = $2`, roomID, ride)
	exec("medal", `insert into medals (room_id, crew_id, user_id, ride_id, kind)
		values ($1, $2, $3, $4, 'diesel')`, roomID, crew, h.id("bob"), ride)
	exec("plan", `insert into scheduled_sessions (room_id, crew_id, channel_id, workout_name, workout_json, starts_at, created_by)
		values ($1, $2, $3, 'Crew Thursday', '{}', $4, $5)`,
		roomID, crew, place.voice, pgtype.Timestamptz{Time: time.Now().Add(48 * time.Hour), Valid: true}, h.id("bob"))
	exec("playlist", `insert into playlists (room_id, crew_id, name) values ($1, $2, 'Crew Mix')`, roomID, crew)

	if w := h.call(t, "alice", http.MethodDelete, "/api/me"); w.Code >= 300 {
		t.Fatalf("delete account: %d %s", w.Code, w.Body.String())
	}

	for _, check := range []struct {
		what, sql string
		args      []any
	}{
		{"the text channel's history", "select count(*) from chat_messages where channel_id = $1 and text = 'bobs history' and room_id is null", []any{text}},
		{"bob's medal", "select count(*) from medals where crew_id = $1 and user_id = $2 and room_id is null", []any{crew, h.id("bob")}},
		{"the crew's plan", "select count(*) from scheduled_sessions where crew_id = $1 and workout_name = 'Crew Thursday' and room_id is null", []any{crew}},
		{"the crew's playlist", "select count(*) from playlists where crew_id = $1 and name = 'Crew Mix' and room_id is null", []any{crew}},
	} {
		var n int
		if err := h.store.Pool.QueryRow(ctx, check.sql, check.args...).Scan(&n); err != nil {
			t.Fatalf("%s: %v", check.what, err)
		}
		if n != 1 {
			t.Errorf("%s went with the departing room owner (%d rows left)", check.what, n)
		}
	}
}
