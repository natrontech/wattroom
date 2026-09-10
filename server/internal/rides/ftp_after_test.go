package rides

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store"
)

// ftpAfterOf reads the column straight out of the row: the list endpoint does
// not carry it (the trend does, over in progression), and what this asserts is
// what got stored.
func (h *harness) ftpAfterOf(t *testing.T, id string) *int16 {
	t.Helper()
	rideID, err := store.ParseUUID(id)
	if err != nil {
		t.Fatalf("ride id: %v", err)
	}
	var watts *int16
	if err := h.store.Pool.QueryRow(t.Context(),
		"select ftp_after_watts from rides where id = $1", rideID).Scan(&watts); err != nil {
		t.Fatalf("read ftp_after_watts: %v", err)
	}
	return watts
}

// An ordinary ride produces no FTP, and its column says so. The ramp is the
// only thing that stamps one (#1572), so a null here is the default every
// other ride keeps for good.
func TestAnOrdinaryRideProducesNoFtp(t *testing.T) {
	h := setup(t)
	id := h.save(t, "alice", 120, 200)
	if got := h.ftpAfterOf(t, id); got != nil {
		t.Fatalf("a ride nobody stamped produced %d W", *got)
	}
}

// The ramp's half: the rider accepted the number, so the ride the test became
// carries it — while ftp_watts stays the FTP the ride was SCORED against,
// which is the whole reason the column exists.
func TestARampStampsTheFtpItProduced(t *testing.T) {
	h := setup(t)
	id := h.save(t, "alice", 120, 200)
	path := "/api/rides/" + id + "/ftp-after"

	status, body := call(t, h.mux, "alice", http.MethodPut, path, `{"ftpAfter":275}`)
	if status != http.StatusOK {
		t.Fatalf("stamp: %d %v", status, body)
	}
	if body["ftpAfter"] != float64(275) {
		t.Fatalf("the answer does not name the number: %v", body)
	}
	got := h.ftpAfterOf(t, id)
	if got == nil || *got != 275 {
		t.Fatalf("stored %v, want 275", got)
	}

	// The ride-time FTP is untouched: the line stays a history (#222) and the
	// stamp is a second, different fact about the same ride.
	_, list := call(t, h.mux, "alice", http.MethodGet, "/api/rides", "")
	rideList, _ := list["rides"].([]any)
	first, _ := rideList[0].(map[string]any)
	if first["ftp"] != float64(250) {
		t.Fatalf("the stamp moved the FTP the ride was scored against: %v", first)
	}

	// Re-testing writes over it rather than adding a second number — the
	// column is one fact about one ride, and a retried stamp must land.
	if status, body := call(t, h.mux, "alice", http.MethodPut, path, `{"ftpAfter":260}`); status != http.StatusOK {
		t.Fatalf("restamp: %d %v", status, body)
	}
	if got := h.ftpAfterOf(t, id); got == nil || *got != 260 {
		t.Fatalf("restamped to %v, want 260", got)
	}
}

func TestFtpAfterRefusals(t *testing.T) {
	h := setup(t)
	id := h.save(t, "alice", 120, 200)
	path := "/api/rides/" + id + "/ftp-after"

	tests := []struct {
		name string
		user string
		path string
		body string
		want int
	}{
		{"signed out", "", path, `{"ftpAfter":275}`, http.StatusUnauthorized},
		{"missing number", "alice", path, `{}`, http.StatusBadRequest},
		{"unknown field", "alice", path, `{"ftp":275}`, http.StatusBadRequest},
		{"malformed id", "alice", "/api/rides/nope/ftp-after", `{"ftpAfter":275}`, http.StatusBadRequest},
		// The schema CHECK holds the same bounds; refusing here is what keeps
		// it from surfacing as a 500 (errors.md).
		{"under the floor", "alice", path, `{"ftpAfter":49}`, http.StatusBadRequest},
		{"over the ceiling", "alice", path, `{"ftpAfter":601}`, http.StatusBadRequest},
		{"not the owner", "bob", path, `{"ftpAfter":275}`, http.StatusNotFound},
		{"the floor itself", "alice", path, `{"ftpAfter":50}`, http.StatusOK},
		{"the ceiling itself", "alice", path, `{"ftpAfter":600}`, http.StatusOK},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if status, body := call(t, h.mux, tt.user, http.MethodPut, tt.path, tt.body); status != tt.want {
				t.Fatalf("status %d, want %d: %v", status, tt.want, body)
			}
		})
	}

	// A ride that is not there reads as absent, not as forbidden — the same
	// answer bob got for a ride that is someone else's.
	missing := fmt.Sprintf("/api/rides/%s/ftp-after", "11111111-1111-1111-1111-111111111111")
	if status, body := call(t, h.mux, "alice", http.MethodPut, missing, `{"ftpAfter":275}`); status != http.StatusNotFound {
		t.Fatalf("unknown ride: %d %v", status, body)
	}
}
