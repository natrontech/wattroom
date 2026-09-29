package rides

import (
	"net/http"
	"testing"
)

// Two saves in one UTC day pay at most the day's cap (#3152, docs/SPEC.md
// "Wardrobe"): two hours at FTP is 120 Batzen each, and the second pays the
// 60 the day has left. Minted in the save's own transaction, under the lock
// the save already takes.
func TestTwoSavesPayAtMostTheDaysBatzen(t *testing.T) {
	h := setup(t)
	for i := range 2 {
		if status, body := call(t, h.mux, "alice", http.MethodPost, "/api/rides", rideBodyAt(7200, 250, nextStart())); status != http.StatusCreated {
			t.Fatalf("save %d: %d %v", i, status, body)
		}
	}
	var riding, welcome int64
	if err := h.store.Pool.QueryRow(t.Context(), `
		select coalesce(sum(amount) filter (where source = 'ride'), 0),
		       coalesce(sum(amount) filter (where source = 'welcome'), 0)
		from wallet_events where user_id = $1`, h.users.ByToken["alice"].ID).Scan(&riding, &welcome); err != nil {
		t.Fatal(err)
	}
	if riding != 180 || welcome != 100 {
		t.Fatalf("two 2 h rides minted %d Batzen and a welcome of %d, want the day's 180 and 100", riding, welcome)
	}
}
