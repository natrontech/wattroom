package riders

import (
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store/db"
)

// The logbook is the caller's own: their rides, their hours, their streak and
// their voice time, and nobody else's numbers in it.
func TestTheLogbookIsTheRidersOwn(t *testing.T) {
	h := setup(t)
	h.ride(t, "alice", crewFixture{}, 300, false)
	h.ride(t, "alice", crewFixture{}, 200, false)
	h.ride(t, "bob", crewFixture{}, 900, false)
	for who, seconds := range map[string]int64{"alice": 600, "bob": 60} {
		if err := h.store.Queries.AddVoiceSeconds(t.Context(), db.AddVoiceSecondsParams{
			Seconds: seconds, UserIds: []pgtype.UUID{h.users.ByToken[who].ID},
		}); err != nil {
			t.Fatal(err)
		}
	}

	status, book := h.get(t, "alice", "/api/me/logbook")
	if status != http.StatusOK {
		t.Fatalf("alice's logbook: %d %v", status, book)
	}
	want := map[string]float64{"totalXp": 500, "rides": 2, "rideSec": 3600, "voiceSec": 600, "streakWeeks": 1}
	for key, value := range want {
		if book[key] != value {
			t.Errorf("%s = %v, want %v (whole book %v)", key, book[key], value, book)
		}
	}

	// A rider with nothing yet reads zeroes, not an error.
	if status, book := h.get(t, "cara", "/api/me/logbook"); status != http.StatusOK || book["voiceSec"] != 0.0 || book["streakWeeks"] != 0.0 {
		t.Errorf("an empty logbook: %d %v", status, book)
	}
	if status, _ := h.get(t, "", "/api/me/logbook"); status != http.StatusUnauthorized {
		t.Errorf("signed out: %d, want 401", status)
	}
}
