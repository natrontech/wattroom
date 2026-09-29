package wardrobe

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
	"github.com/natrontech/wattroom/server/internal/testx"
	"github.com/natrontech/wattroom/server/internal/wallet"
)

type harness struct {
	st    *store.Store
	users *testx.Users
	mux   *http.ServeMux
}

func setup(t *testing.T) *harness {
	t.Helper()
	st := storetest.Open(t)
	users := &testx.Users{ByToken: map[string]db.User{}}
	for _, name := range []string{"alice", "bob"} {
		u, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{DisplayName: name, FtpWatts: 250, WeightKg: 70})
		if err != nil {
			t.Fatal(err)
		}
		users.ByToken[name] = u
		t.Cleanup(func() { _, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID) })
	}
	mux := http.NewServeMux()
	New(st, users, slog.New(slog.DiscardHandler)).Register(mux)
	return &harness{st: st, users: users, mux: mux}
}

func (h *harness) id(name string) pgtype.UUID { return h.users.ByToken[name].ID }

func (h *harness) call(t *testing.T, user, method, path, body string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), method, path, strings.NewReader(body))
	if user != "" {
		req.Header.Set("X-Test-User", user)
	}
	w := httptest.NewRecorder()
	h.mux.ServeHTTP(w, req)
	var out map[string]any
	_ = json.NewDecoder(w.Body).Decode(&out)
	return w.Code, out
}

func (h *harness) balance(t *testing.T, name string) int64 {
	t.Helper()
	n, err := wallet.Balance(t.Context(), h.st.Queries, h.id(name))
	if err != nil {
		t.Fatal(err)
	}
	return n
}

// grant puts an item in a garage the way a future unlock would.
func (h *harness) grant(t *testing.T, name, item, source string) {
	t.Helper()
	if _, err := h.st.Queries.AddWardrobeItem(t.Context(), db.AddWardrobeItemParams{UserID: h.id(name), ItemID: item, Source: source}); err != nil {
		t.Fatal(err)
	}
}

// earn mints one ride's Batzen, so the refusal can count in rides.
func (h *harness) earn(t *testing.T, name string, amount int32) {
	t.Helper()
	ride, err := h.st.Queries.CreateRide(t.Context(), db.CreateRideParams{
		UserID: h.id(name), WorkoutName: "Earning",
		StartedAt: pgtype.Timestamptz{Time: time.Now().Add(-time.Hour).Truncate(time.Second), Valid: true},
		Seconds:   3600, AvgWatts: 200, Kj: 720, Execution: 0.9, FtpWatts: 250, Samples: []byte("x"), Curve: []byte(`{}`),
	})
	if err == nil {
		err = wallet.MintRide(t.Context(), h.st.Queries, h.id(name), ride, amount)
	}
	if err != nil {
		t.Fatal(err)
	}
}

// docs/SPEC.md "Wardrobe": S is 60, M 150; the welcome is 100.
func TestBuying(t *testing.T) {
	h := setup(t)
	buy := func(user, item string) (int, map[string]any) {
		return h.call(t, user, http.MethodPost, "/api/me/wardrobe/"+item, "")
	}
	tests := []struct {
		name, user, item string
		status           int
		message          string
	}{
		{"signed out", "", "finish.metallic", http.StatusUnauthorized, ""},
		{"an item that does not exist", "alice", "finish.gold", http.StatusNotFound, ""},
		{"an earned item", "alice", "frame.zweihundert", http.StatusBadRequest, "Earned, not sold."},
		{"an item that comes with a frame", "alice", "wheels.army", http.StatusBadRequest, "It comes with its frame."},
		{"the welcome buys an S", "alice", "finish.metallic", http.StatusCreated, ""},
		{"twice", "alice", "finish.metallic", http.StatusConflict, "It is already yours."},
		{"an M on the 40 left, no ride yet", "alice", "finish.chrome", http.StatusConflict,
			"You need 110 more Batzen — every minute ridden at your FTP earns one."},
	}
	for _, tt := range tests {
		status, body := buy(tt.user, tt.item)
		if status != tt.status || (tt.message != "" && body["message"] != tt.message) {
			t.Fatalf("%s: %d %v, want %d %q", tt.name, status, body, tt.status, tt.message)
		}
	}
	if got := h.balance(t, "alice"); got != 40 {
		t.Fatalf("alice holds %d after one S, want 40", got)
	}

	// The refusal counts in rides like the last one.
	h.earn(t, "alice", 60) // 100 held, 50 short
	if _, body := buy("alice", "finish.chrome"); body["message"] != "You need 50 more — about one ride like your last one." {
		t.Fatalf("one ride short: %v", body["message"])
	}
	if _, body := buy("alice", "frame.ordonnanz"); body["message"] != "You need 2300 more — about 39 rides like your last one." {
		t.Fatalf("an XXL out of reach: %v", body["message"])
	}
}

// Two purchases at once each read the balance before either writes: without
// the rider's row lock both pass the check and the balance goes below zero
// (#3154's acceptance).
func TestConcurrentPurchasesNeverGoNegative(t *testing.T) {
	h := setup(t)
	h.balance(t, "alice") // the welcome, 100: one S of 60 fits, two do not
	var cheap []string
	for _, it := range items {
		if it.Tier == "S" && len(cheap) < 8 {
			cheap = append(cheap, it.ID)
		}
	}
	var wg sync.WaitGroup
	statuses := make([]int, len(cheap))
	for i, item := range cheap {
		wg.Go(func() { statuses[i], _ = h.call(t, "alice", http.MethodPost, "/api/me/wardrobe/"+item, "") })
	}
	wg.Wait()
	bought := 0
	for _, s := range statuses {
		if s == http.StatusCreated {
			bought++
		}
	}
	if got := h.balance(t, "alice"); bought != 1 || got != 40 {
		t.Fatalf("%d purchases at once bought %d and left %d, want one and 40 (%v)", len(cheap), bought, got, statuses)
	}
}

// docs/SPEC.md "Wardrobe": undo within 10 minutes, and only while unworn.
func TestUndo(t *testing.T) {
	h := setup(t)
	undo := func(item string) (int, map[string]any) {
		return h.call(t, "alice", http.MethodDelete, "/api/me/wardrobe/"+item, "")
	}
	if status, _ := h.call(t, "", http.MethodDelete, "/api/me/wardrobe/finish.metallic", ""); status != http.StatusUnauthorized {
		t.Fatalf("signed out: %d, want 401", status)
	}
	if status, _ := undo("finish.metallic"); status != http.StatusNotFound {
		t.Fatalf("an item never bought: %d, want 404", status)
	}

	// Bought, worn in the outfit (not on a ride), undone: the Batzen come back
	// and the item comes off.
	h.call(t, "alice", http.MethodPost, "/api/me/wardrobe/finish.metallic", "")
	if status, _ := h.call(t, "alice", http.MethodPut, "/api/me/outfit", `{"finish":"finish.metallic","frame":"frame.race"}`); status != http.StatusNoContent {
		t.Fatalf("wearing it: %d", status)
	}
	if status, body := undo("finish.metallic"); status != http.StatusOK || body["balance"] != float64(100) {
		t.Fatalf("undo: %d %v, want 200 and the welcome back", status, body)
	}
	outfit, err := h.st.Queries.GetUserOutfit(t.Context(), h.id("alice"))
	if err != nil || strings.Contains(string(outfit.Loadout), "finish.metallic") || !strings.Contains(string(outfit.Loadout), "frame.race") {
		t.Fatalf("the outfit after the undo: %s (%v), want the finish off and the frame on", outfit.Loadout, err)
	}
	// Bought again after the undo: a purchase of its own.
	if status, _ := h.call(t, "alice", http.MethodPost, "/api/me/wardrobe/finish.metallic", ""); status != http.StatusCreated {
		t.Fatalf("buying it again: %d", status)
	}

	// Worn on a ride: kept.
	h.call(t, "alice", http.MethodPut, "/api/me/outfit", `{"finish":"finish.metallic"}`)
	if err := MarkWorn(t.Context(), h.st.Queries, h.id("alice")); err != nil {
		t.Fatal(err)
	}
	if status, _ := undo("finish.metallic"); status != http.StatusConflict {
		t.Fatalf("worn on a ride: %d, want 409", status)
	}

	// Past the ten minutes: kept.
	h.earn(t, "alice", 60)
	if status, _ := h.call(t, "alice", http.MethodPost, "/api/me/wardrobe/hub.buzz", ""); status != http.StatusCreated {
		t.Fatalf("buying the hub: %d", status)
	}
	if _, err := h.st.Pool.Exec(t.Context(),
		"update wardrobe set acquired_at = now() - interval '11 minutes' where user_id = $1 and item_id = 'hub.buzz'", h.id("alice")); err != nil {
		t.Fatal(err)
	}
	if status, _ := undo("hub.buzz"); status != http.StatusConflict {
		t.Fatalf("eleven minutes on: %d, want 409", status)
	}

	// Earned, not bought: nothing to give back.
	h.grant(t, "alice", "frame.zweihundert", "earned")
	if status, _ := undo("frame.zweihundert"); status != http.StatusBadRequest {
		t.Fatalf("an earned item: %d, want 400", status)
	}
}

func TestTheOutfitTakesOnlyWhatYouOwn(t *testing.T) {
	h := setup(t)
	h.grant(t, "alice", "finish.metallic", "bought")
	tests := []struct {
		name, user, body string
		status           int
	}{
		{"signed out", "", `{"frame":"frame.race"}`, http.StatusUnauthorized},
		{"not an object", "alice", `["frame.race"]`, http.StatusBadRequest},
		{"starter items and free looks", "alice",
			`{"frame":"frame.race","colours":{"frame":"ink"},"params":{"tyreMm":28},"opts":{},"skin":"skin.2","body":{"height":1.7}}`, http.StatusNoContent},
		{"a bought item", "alice", `{"finish":"finish.metallic"}`, http.StatusNoContent},
		{"someone else's purchase", "bob", `{"finish":"finish.metallic"}`, http.StatusBadRequest},
		{"an item not yet bought", "alice", `{"finish":"finish.chrome"}`, http.StatusBadRequest},
		{"an item in the wrong slot", "alice", `{"frame":"finish.metallic"}`, http.StatusBadRequest},
		{"a key that is no slot", "alice", `{"engine":"v8"}`, http.StatusBadRequest},
		{"an item not yet earned", "alice", `{"frame":"frame.zweihundert"}`, http.StatusBadRequest},
		{"wheels whose frame is not owned", "alice", `{"wheels":"wheels.army"}`, http.StatusBadRequest},
	}
	for _, tt := range tests {
		if status, body := h.call(t, tt.user, http.MethodPut, "/api/me/outfit", tt.body); status != tt.status {
			t.Fatalf("%s: %d %v, want %d", tt.name, status, body, tt.status)
		}
	}
	h.grant(t, "alice", "frame.ordonnanz", "bought")
	if status, body := h.call(t, "alice", http.MethodPut, "/api/me/outfit", `{"frame":"frame.ordonnanz","wheels":"wheels.army"}`); status != http.StatusNoContent {
		t.Fatalf("wheels that come with an owned frame: %d %v", status, body)
	}
}
