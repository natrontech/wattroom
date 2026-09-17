package rides

import (
	"net/http"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// POST /api/rides/{id}/export/retry is the "one big button" errors.md asks
// for on a failed delivery, and it had no endpoint test at all (#2253):
// RequeueRideExport was exercised as a bare query, so nothing covered the
// 409 that stops a stale button sending a ride to Strava twice, or the 404
// that keeps one rider's button off another rider's ride.
func TestTheExportRetryButtonsFiveAnswers(t *testing.T) {
	h := setup(t)
	status, got := call(t, h.mux, "alice", http.MethodPost, "/api/rides", rideBody(120, 200))
	if status != http.StatusCreated {
		t.Fatalf("create: %d %v", status, got)
	}
	rideID, _ := got["id"].(string)
	id, err := store.ParseUUID(rideID)
	if err != nil {
		t.Fatal(err)
	}
	retry := func(who, path string) (int, map[string]any) {
		t.Helper()
		return call(t, h.mux, who, http.MethodPost, "/api/rides/"+path+"/export/retry", "")
	}

	// 401: not signed in.
	if status, _ := retry("", rideID); status != http.StatusUnauthorized {
		t.Errorf("signed out: %d, want 401", status)
	}
	// 400: not a ride id at all.
	if status, _ := retry("alice", "not-a-uuid"); status != http.StatusBadRequest {
		t.Errorf("junk id: %d, want 400", status)
	}
	// 404: somebody else's ride — and the same answer for a ride that does
	// not exist, so the button cannot be used to ask whether one does.
	if status, _ := retry("bob", rideID); status != http.StatusNotFound {
		t.Errorf("another rider's ride: %d, want 404", status)
	}
	// 409: nothing failed, so there is nothing to retry. This is the one that
	// stops a stale page sending a delivered ride a second time.
	if status, body := retry("alice", rideID); status != http.StatusConflict {
		t.Errorf("a ride with no failed delivery: %d %v, want 409", status, body)
	}

	// 204: a delivery that failed is queued again.
	if err := h.store.Queries.StartRideExport(t.Context(), db.StartRideExportParams{RideID: id, Destination: "strava"}); err != nil {
		t.Fatal(err)
	}
	reason := "strava: 503"
	if err := h.store.Queries.FailRideExport(t.Context(), db.FailRideExportParams{
		RideID: id, Destination: "strava", LastError: &reason, MaxAttempts: 1,
	}); err != nil {
		t.Fatal(err)
	}
	if status, body := retry("alice", rideID); status != http.StatusNoContent {
		t.Fatalf("retrying a failed delivery: %d %v, want 204", status, body)
	}
	// And pressing it twice is the 409 again, not a second queueing.
	if status, _ := retry("alice", rideID); status != http.StatusConflict {
		t.Errorf("pressing the button twice: %d, want 409", status)
	}
}

// Every endpoint owes a 401 (errors.md); the ride list had none.
func TestTheRideListRefusesTheSignedOut(t *testing.T) {
	h := setup(t)
	for _, path := range []string{"/api/rides", "/api/rides/best"} {
		if status, body := call(t, h.mux, "", http.MethodGet, path, ""); status != http.StatusUnauthorized {
			t.Errorf("GET %s signed out: %d %v, want 401", path, status, body)
		}
	}
}
