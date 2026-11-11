package rides

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/natrontech/wattroom/server/internal/store/db"
)

// The rider's own closing card says what the ride paid (#4515): the save's
// answer and the rider's own read of the ride carry it, the day's cap says
// when it held a ride under its minutes, and no projection anybody else sees
// carries it — the list, a friend's shared ride.
func TestOnlyTheRidersOwnReadsSayWhatARidePaid(t *testing.T) {
	h := setup(t)
	type earned struct {
		Earned int  `json:"earned"`
		Held   bool `json:"held"`
	}
	read := func(body map[string]any) *earned {
		t.Helper()
		raw, ok := body["batzen"]
		if !ok {
			return nil
		}
		b, _ := json.Marshal(raw)
		var e earned
		if err := json.Unmarshal(b, &e); err != nil {
			t.Fatal(err)
		}
		return &e
	}
	var ids []string
	for i, want := range []earned{{120, false}, {60, true}} {
		status, body := call(t, h.mux, "alice", http.MethodPost, "/api/rides", rideBodyAt(7200, 250, nextStart()))
		if status != http.StatusCreated {
			t.Fatalf("save %d: %d %v", i, status, body)
		}
		if got := read(body); got == nil || *got != want {
			t.Fatalf("save %d paid %+v, want %+v", i, got, want)
		}
		id, _ := body["id"].(string)
		ids = append(ids, id)
	}
	status, body := call(t, h.mux, "alice", http.MethodGet, "/api/rides/"+ids[1], "")
	if got := read(body); status != http.StatusOK || got == nil || *got != (earned{60, true}) {
		t.Fatalf("the rider's own read: %d %+v", status, got)
	}

	if status, body := call(t, h.mux, "alice", http.MethodPatch, "/api/rides/"+ids[1], `{"sharedWithFriends":true}`); status != http.StatusOK {
		t.Fatalf("share: %d %v", status, body)
	}
	_, list := call(t, h.mux, "alice", http.MethodGet, "/api/rides", "")
	shared, err := h.store.Queries.ListSharedRides(t.Context(), db.ListSharedRidesParams{
		Rider: h.users.ByToken["alice"].ID, Viewer: h.users.ByToken["bob"].ID, Max: 10,
	})
	if err != nil || len(shared) != 1 {
		t.Fatalf("shared rides: %d (%v)", len(shared), err)
	}
	for name, v := range map[string]any{"the list": list, "a friend's shared ride": shared[0]} {
		raw, _ := json.Marshal(v)
		if strings.Contains(strings.ToLower(string(raw)), "batzen") {
			t.Fatalf("%s carries the ride's Batzen: %s", name, raw)
		}
	}
}

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
