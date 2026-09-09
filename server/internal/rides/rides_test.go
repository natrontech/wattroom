package rides

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
)

type fakeUsers struct{ byToken map[string]db.User }

func (f *fakeUsers) User(r *http.Request) (db.User, bool) {
	u, ok := f.byToken[r.Header.Get("X-Test-User")]
	return u, ok
}

func (f *fakeUsers) RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool) {
	u, ok := f.User(r)
	if !ok {
		http.Error(w, `{"error":"unauthorized","message":"`+signInMessage+`"}`, http.StatusUnauthorized)
	}
	return u, ok
}

type harness struct {
	mux   *http.ServeMux
	store *store.Store
	users *fakeUsers
}

func setup(t *testing.T) *harness {
	t.Helper()
	st := storetest.Open(t)

	users := &fakeUsers{byToken: map[string]db.User{}}
	for _, name := range []string{"alice", "bob"} {
		u, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{
			DisplayName: name, FtpWatts: 250, WeightKg: 70,
		})
		if err != nil {
			t.Fatalf("create user: %v", err)
		}
		users.byToken[name] = u
		t.Cleanup(func() {
			_, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID)
		})
	}
	mux := http.NewServeMux()
	New(st, users, slog.New(slog.DiscardHandler)).Register(mux)
	return &harness{mux: mux, store: st, users: users}
}

// save posts one ride and returns its id — the only way to get a row with a
// real sample blob behind it, which is what the detail endpoint reads.
func (h *harness) save(t *testing.T, user string, seconds, watts int) string {
	t.Helper()
	status, body := call(t, h.mux, user, http.MethodPost, "/api/rides", rideBody(seconds, watts))
	if status != http.StatusCreated {
		t.Fatalf("create: %d %v", status, body)
	}
	id, _ := body["id"].(string)
	return id
}

// roomRide turns a saved solo ride into a room session's ride with one medal
// on it — what the POST endpoint cannot make, and what the detail page has to
// name. The room's cleanup is alice's: rooms.owner_id cascades.
func (h *harness) roomRide(t *testing.T, id, medal string) pgtype.UUID {
	t.Helper()
	rideID, err := store.ParseUUID(id)
	if err != nil {
		t.Fatalf("ride id: %v", err)
	}
	alice := h.users.byToken["alice"].ID
	room, err := h.store.Queries.CreateRoom(t.Context(), db.CreateRoomParams{
		Slug: "ride-" + id[:8], Name: "Pain Cave", OwnerID: alice,
	})
	if err != nil {
		t.Fatalf("create room: %v", err)
	}
	if _, err := h.store.Pool.Exec(t.Context(),
		"update rides set room_id = $1 where id = $2", room.ID, rideID); err != nil {
		t.Fatalf("attach room: %v", err)
	}
	if err := h.store.Queries.CreateMedal(t.Context(), db.CreateMedalParams{
		RoomID: room.ID, UserID: alice, RideID: rideID, Kind: medal,
	}); err != nil {
		t.Fatalf("create medal: %v", err)
	}
	return rideID
}

func call(t *testing.T, mux *http.ServeMux, user, method, path, body string) (int, map[string]any) {
	t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequestWithContext(t.Context(), method, path, reader)
	if user != "" {
		req.Header.Set("X-Test-User", user)
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	var decoded map[string]any
	_ = json.NewDecoder(w.Body).Decode(&decoded)
	return w.Code, decoded
}

// Each body starts at its own second: a save at the same start is the same
// ride now (FindRideAt), and two rides a test means two start times.
var rideBodies atomic.Int64

func rideBody(seconds, watts int) string {
	samples := make([]string, seconds)
	for i := range samples {
		samples[i] = fmt.Sprintf(`{"watts":%d,"cadence":90}`, watts)
	}
	start := time.Now().Add(-time.Hour - time.Duration(rideBodies.Add(1))*time.Second)
	return fmt.Sprintf(
		`{"workoutName":"Openers","workoutJson":"{\"name\":\"Openers\",\"steps\":[{\"type\":\"steady\",\"seconds\":%d,\"target\":0.8}]}","startedAt":%q,"samples":[%s]}`,
		seconds, start.Format(time.RFC3339), strings.Join(samples, ","))
}

// The list is paged by start (#1549): the second page begins strictly
// before the oldest row the client holds.
func TestRideListPagesByStart(t *testing.T) {
	h := setup(t)
	for range 3 {
		if status, _ := call(t, h.mux, "alice", http.MethodPost, "/api/rides", rideBody(120, 200)); status != http.StatusCreated {
			t.Fatalf("save: %d", status)
		}
	}
	status, body := call(t, h.mux, "alice", http.MethodGet, "/api/rides", "")
	rides, _ := body["rides"].([]any)
	if status != http.StatusOK || len(rides) != 3 || body["more"] != false {
		t.Fatalf("first page: %d %v", status, body)
	}
	newest, _ := rides[0].(map[string]any)
	newestStart, _ := newest["startedAt"].(string)
	status, body = call(t, h.mux, "alice", http.MethodGet, "/api/rides?before="+url.QueryEscape(newestStart), "")
	older, _ := body["rides"].([]any)
	if status != http.StatusOK || len(older) != 2 {
		t.Fatalf("page before the newest: %d %v", status, body)
	}
	for _, row := range older {
		if fields, _ := row.(map[string]any); fields["id"] == newest["id"] {
			t.Fatalf("the newest ride came back on the page before it")
		}
	}
	if status, body = call(t, h.mux, "alice", http.MethodGet, "/api/rides?before=yesterday", ""); status != http.StatusBadRequest || body["error"] != "validation_error" {
		t.Fatalf("garbage before: %d %v", status, body)
	}
}

func TestSoloRideSaveAndList(t *testing.T) {
	h := setup(t)

	if status, _ := call(t, h.mux, "", http.MethodPost, "/api/rides", rideBody(120, 200)); status != http.StatusUnauthorized {
		t.Fatalf("anon: %d", status)
	}

	// 120 s at 200 W against 0.8×250 = 200 W target: execution 1.0, 24 kJ.
	status, body := call(t, h.mux, "alice", http.MethodPost, "/api/rides", rideBody(120, 200))
	if status != http.StatusCreated {
		t.Fatalf("create: %d %v", status, body)
	}
	kj, _ := body["kj"].(float64)
	execution, _ := body["execution"].(float64)
	if kj != 24 || execution < 0.99 {
		t.Fatalf("scoring: %v", body)
	}
	if body["room"] != nil && body["room"] != false {
		t.Fatalf("solo ride marked as room ride: %v", body)
	}

	status, body = call(t, h.mux, "alice", http.MethodGet, "/api/rides", "")
	rides, _ := body["rides"].([]any)
	if status != http.StatusOK || len(rides) != 1 {
		t.Fatalf("list: %d %v", status, body)
	}

	// Under a minute is a misclick, same rule the room saver uses.
	if status, body = call(t, h.mux, "alice", http.MethodPost, "/api/rides", rideBody(30, 200)); status != http.StatusBadRequest || body["field"] != "samples" {
		t.Fatalf("short ride: %d %v", status, body)
	}
	// Out-of-range watts bounce.
	bad := strings.Replace(rideBody(60, 200), `"watts":200`, `"watts":9000`, 1)
	if status, body = call(t, h.mux, "alice", http.MethodPost, "/api/rides", bad); status != http.StatusBadRequest || body["field"] != "samples" {
		t.Fatalf("bad watts: %d %v", status, body)
	}
}

func TestShareWithFriends(t *testing.T) {
	h := setup(t)
	status, body := call(t, h.mux, "alice", http.MethodPost, "/api/rides", rideBody(120, 200))
	if status != http.StatusCreated {
		t.Fatalf("create: %d %v", status, body)
	}
	id, _ := body["id"].(string)
	path := "/api/rides/" + id

	shared := func() any {
		_, body := call(t, h.mux, "alice", http.MethodGet, "/api/rides", "")
		rides, _ := body["rides"].([]any)
		first, _ := rides[0].(map[string]any)
		return first["sharedWithFriends"]
	}
	// Private by default.
	if shared() != false {
		t.Fatalf("new ride not private")
	}

	tests := []struct {
		name string
		user string
		path string
		body string
		want int
	}{
		{"signed out", "", path, `{"sharedWithFriends":true}`, http.StatusUnauthorized},
		{"missing flag", "alice", path, `{}`, http.StatusBadRequest},
		{"unknown field", "alice", path, `{"shared":true}`, http.StatusBadRequest},
		{"malformed id", "alice", "/api/rides/nope", `{"sharedWithFriends":true}`, http.StatusBadRequest},
		{"not the owner", "bob", path, `{"sharedWithFriends":true}`, http.StatusNotFound},
		{"owner shares", "alice", path, `{"sharedWithFriends":true}`, http.StatusOK},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if status, body := call(t, h.mux, tt.user, http.MethodPatch, tt.path, tt.body); status != tt.want {
				t.Fatalf("status %d, want %d: %v", status, tt.want, body)
			}
		})
	}
	if shared() != true {
		t.Fatalf("share did not stick")
	}
	// And back — the undo path.
	if status, _ := call(t, h.mux, "alice", http.MethodPatch, path, `{"sharedWithFriends":false}`); status != http.StatusOK {
		t.Fatalf("unshare: %d", status)
	}
	if shared() != false {
		t.Fatalf("unshare did not stick")
	}
}

func TestRideDetail(t *testing.T) {
	h := setup(t)
	id := h.save(t, "alice", 120, 200)
	path := "/api/rides/" + id

	tests := []struct {
		name string
		user string
		path string
		want int
	}{
		{"signed out", "", path, http.StatusUnauthorized},
		{"malformed id", "alice", "/api/rides/nope", http.StatusBadRequest},
		{"not the owner", "bob", path, http.StatusNotFound},
		{"absent ride", "alice", "/api/rides/00000000-0000-0000-0000-000000000000", http.StatusNotFound},
		{"owner opens it", "alice", path, http.StatusOK},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if status, body := call(t, h.mux, tt.user, http.MethodGet, tt.path, ""); status != tt.want {
				t.Fatalf("status %d, want %d: %v", status, tt.want, body)
			}
		})
	}

	// The blob comes back as the per-second series it is stored for
	// (ADR-0016): one read, when the rider opens the ride.
	_, body := call(t, h.mux, "alice", http.MethodGet, path, "")
	samples, _ := body["samples"].([]any)
	if len(samples) != 120 {
		t.Fatalf("samples: %d, want 120", len(samples))
	}
	first, _ := samples[0].(map[string]any)
	if first["watts"] != float64(200) || first["cadence"] != float64(90) {
		t.Fatalf("sample: %v", first)
	}
	// 120 s at a flat 200 W: normalised power is the average.
	if body["normWatts"] != float64(200) || body["kj"] != float64(24) {
		t.Fatalf("numbers: %v", body)
	}
	if body["room"] != nil {
		t.Fatalf("solo ride claims a room: %v", body["room"])
	}
	if medals, _ := body["medals"].([]any); len(medals) != 0 {
		t.Fatalf("medals on a solo ride: %v", medals)
	}
}

func TestRideDetailNamesItsRoomAndMedals(t *testing.T) {
	h := setup(t)
	id := h.save(t, "alice", 120, 200)
	h.roomRide(t, id, "diesel")

	status, body := call(t, h.mux, "alice", http.MethodGet, "/api/rides/"+id, "")
	if status != http.StatusOK {
		t.Fatalf("detail: %d %v", status, body)
	}
	room, _ := body["room"].(map[string]any)
	if room["slug"] != "ride-"+id[:8] || room["name"] != "Pain Cave" {
		t.Fatalf("room: %v", body["room"])
	}
	medals, _ := body["medals"].([]any)
	if len(medals) != 1 {
		t.Fatalf("medals: %v", medals)
	}
	if medal, _ := medals[0].(map[string]any); medal["kind"] != "diesel" || medal["roomName"] != "Pain Cave" {
		t.Fatalf("medal: %v", medals[0])
	}
}

func TestDeleteRide(t *testing.T) {
	h := setup(t)
	id := h.save(t, "alice", 120, 200)
	path := "/api/rides/" + id

	tests := []struct {
		name string
		user string
		path string
		want int
	}{
		{"signed out", "", path, http.StatusUnauthorized},
		{"malformed id", "alice", "/api/rides/nope", http.StatusBadRequest},
		{"not the owner", "bob", path, http.StatusNotFound},
		{"absent ride", "alice", "/api/rides/00000000-0000-0000-0000-000000000000", http.StatusNotFound},
		{"owner deletes it", "alice", path, http.StatusNoContent},
		{"and it is gone", "alice", path, http.StatusNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if status, body := call(t, h.mux, tt.user, http.MethodDelete, tt.path, ""); status != tt.want {
				t.Fatalf("status %d, want %d: %v", status, tt.want, body)
			}
		})
	}

	// Gone from the table, not just from the endpoint.
	rideID, err := store.ParseUUID(id)
	if err != nil {
		t.Fatalf("ride id: %v", err)
	}
	var count int
	if err := h.store.Pool.QueryRow(t.Context(),
		"select count(*) from rides where id = $1", rideID).Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 0 {
		t.Fatalf("the row survived the delete")
	}
	_, body := call(t, h.mux, "alice", http.MethodGet, "/api/rides", "")
	if rides, _ := body["rides"].([]any); len(rides) != 0 {
		t.Fatalf("deleted ride still listed: %v", body)
	}
}

// A ride's medals are its evidence: they go when it goes, by the FK, never by
// a cleanup pass someone has to remember to write.
func TestDeleteRideTakesItsMedals(t *testing.T) {
	h := setup(t)
	id := h.save(t, "alice", 120, 200)
	rideID := h.roomRide(t, id, "hammer")

	if status, body := call(t, h.mux, "alice", http.MethodDelete, "/api/rides/"+id, ""); status != http.StatusNoContent {
		t.Fatalf("delete: %d %v", status, body)
	}
	medals, err := h.store.Queries.ListRideMedals(t.Context(), rideID)
	if err != nil {
		t.Fatalf("list medals: %v", err)
	}
	if len(medals) != 0 {
		t.Fatalf("medals outlived their ride: %v", medals)
	}
}

// A retried save is the same ride (audit 2026-09-09): the recovery card
// re-posts a ride whose answer was lost, and the row has no key of its own.
func TestSavingTheSameRideTwiceIsOneRide(t *testing.T) {
	h := setup(t)
	body := rideBody(120, 200)
	status, first := call(t, h.mux, "alice", http.MethodPost, "/api/rides", body)
	if status != http.StatusCreated {
		t.Fatalf("first save: %d %v", status, first)
	}
	status, second := call(t, h.mux, "alice", http.MethodPost, "/api/rides", body)
	if status != http.StatusOK || second["id"] != first["id"] {
		t.Fatalf("second save: %d %v, want 200 with the same id %v", status, second, first["id"])
	}
	status, list := call(t, h.mux, "alice", http.MethodGet, "/api/rides", "")
	if rides, _ := list["rides"].([]any); status != http.StatusOK || len(rides) != 1 {
		t.Fatalf("rides after two saves: %d %v, want one", status, list)
	}
}
