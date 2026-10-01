package rides

import (
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5"
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

// A saved ride wears the rider's outfit: a bought item on it is theirs to
// keep from then on, past the undo (#3154, docs/SPEC.md "Wardrobe").
func TestASavedRideWearsTheOutfit(t *testing.T) {
	h := setup(t)
	alice := h.users.ByToken["alice"].ID
	if _, err := h.store.Pool.Exec(t.Context(), `
		with owned as (insert into wardrobe (user_id, item_id, source) values ($1, 'finish.metallic', 'bought'), ($1, 'hub.buzz', 'bought'))
		insert into outfits (user_id, loadout) values ($1, '{"finish":"finish.metallic"}')`, alice); err != nil {
		t.Fatal(err)
	}
	if status, body := call(t, h.mux, "alice", http.MethodPost, "/api/rides", rideBodyAt(1800, 250, nextStart())); status != http.StatusCreated {
		t.Fatalf("save: %d %v", status, body)
	}
	var worn []string
	rows, err := h.store.Pool.Query(t.Context(), "select item_id from wardrobe where user_id = $1 and first_worn_at is not null", alice)
	if err == nil {
		worn, err = pgx.CollectRows(rows, pgx.RowTo[string])
	}
	if err != nil || len(worn) != 1 || worn[0] != "finish.metallic" {
		t.Fatalf("worn after the ride: %v (%v), want the finish alone — the hub stayed in the garage", worn, err)
	}
}
