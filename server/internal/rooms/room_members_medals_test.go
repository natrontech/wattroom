package rooms

import (
	"fmt"
	"net/http"
	"testing"
)

// The roster's medal count is every medal the room awarded that rider, by id
// (#1371). It used to be a display-name match over the 24 most recent awards,
// which decayed as the room rode and merged two riders with one name.
func TestTheRosterCountsEveryMedalARiderWonHere(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Medal Count Room")
	h.join(t, "bob", slug)
	bob := h.users.byToken["bob"].ID
	room, err := h.store.Queries.GetRoomBySlug(t.Context(), slug)
	if err != nil {
		t.Fatalf("room: %v", err)
	}
	// A medal hangs off a ride; the ride's numbers are irrelevant here.
	var ride string
	if err := h.store.Pool.QueryRow(t.Context(),
		`insert into rides (user_id, room_id, workout_name, started_at, seconds, avg_watts, kj, execution, ftp_watts, samples)
		 values ($1, $2, 'Openers', now(), 600, 200, 120, 0.9, 250, ''::bytea) returning id`,
		bob, room.ID).Scan(&ride); err != nil {
		t.Fatalf("ride: %v", err)
	}
	for _, kind := range []string{"diesel", "hammer"} {
		if _, err := h.store.Pool.Exec(t.Context(),
			`insert into medals (room_id, user_id, ride_id, kind) values ($1, $2, $3, $4)`,
			room.ID, bob, ride, kind); err != nil {
			t.Fatalf("medal %s: %v", kind, err)
		}
	}

	status, body := h.call(t, "alice", http.MethodGet, "/api/rooms/"+slug, "")
	if status != http.StatusOK {
		t.Fatalf("room: %d", status)
	}
	members, _ := body["members"].([]any)
	counts := map[string]any{}
	for _, m := range members {
		row, _ := m.(map[string]any)
		counts[fmt.Sprint(row["displayName"])] = row["medals"]
	}
	bobName := h.users.byToken["bob"].DisplayName
	if counts[bobName] != float64(2) {
		t.Errorf("bob's medals = %v, want 2 (roster %v)", counts[bobName], counts)
	}
	aliceName := h.users.byToken["alice"].DisplayName
	if counts[aliceName] != float64(0) {
		t.Errorf("alice's medals = %v, want 0", counts[aliceName])
	}
}
