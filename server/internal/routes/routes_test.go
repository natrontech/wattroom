package routes

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/secrets"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
	"github.com/natrontech/wattroom/server/internal/testx"
)

type harness struct {
	mux   *http.ServeMux
	store *store.Store
	users *testx.Users
	keys  *secrets.Cipher
}

// testKey is a key for tests alone, 32 bytes of one letter.
func testKey(t *testing.T, letter string) *secrets.Cipher {
	t.Helper()
	keys, err := secrets.FromKey("TEST_KEY", base64.StdEncoding.EncodeToString([]byte(strings.Repeat(letter, 32))))
	if err != nil {
		t.Fatal(err)
	}
	return keys
}

// setup serves the routes with `keys` — nil is a server with no key.
func setup(t *testing.T, keys *secrets.Cipher) *harness {
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
	New(st, users, keys, slog.New(slog.DiscardHandler)).Register(mux)
	return &harness{mux: mux, store: st, users: users, keys: keys}
}

func (h *harness) call(t *testing.T, user, method, path string, body any) (int, map[string]any) {
	t.Helper()
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(raw)
	}
	req := httptest.NewRequestWithContext(t.Context(), method, path, reader)
	if user != "" {
		req.Header.Set("X-Test-User", user)
	}
	w := httptest.NewRecorder()
	h.mux.ServeHTTP(w, req)
	var out map[string]any
	_ = json.NewDecoder(w.Body).Decode(&out)
	return w.Code, out
}

// A 3 km road climbing 20 m, and the owner's place for it: open ocean.
var (
	shape   = testx.Polyline6([][2]float64{{-48.8767, -123.3933}, {-48.8700, -123.3950}, {-48.8650, -123.3970}})
	request = map[string]any{
		"src": "gpx", "eleSource": "file", "road": testx.FlatRoad(3000, 20), "shape": shape,
		"climbs": []map[string]any{{"startM": 100, "topM": 900, "gainM": 12, "cls": nil}},
	}
)

func (h *harness) keep(t *testing.T, user string) string {
	t.Helper()
	status, body := h.call(t, user, http.MethodPost, "/api/routes", request)
	if status != http.StatusCreated {
		t.Fatalf("keep: %d %v", status, body)
	}
	id, _ := body["id"].(string)
	return id
}

// rowText is the route's whole row as Postgres prints it — every column,
// whatever it is called — so a coordinate in any of them shows.
func (h *harness) rowText(t *testing.T, id string) string {
	t.Helper()
	var text string
	if err := h.store.Pool.QueryRow(t.Context(),
		"select row_to_json(routes)::text from routes where id = $1", id).Scan(&text); err != nil {
		t.Fatal(err)
	}
	return text
}

func TestEveryRouteEndpointNeedsSignIn(t *testing.T) {
	h := setup(t, testKey(t, "k"))
	for _, route := range testx.MountedRoutes(t) {
		path := strings.ReplaceAll(route.Pattern, "{id}", "00000000-0000-0000-0000-000000000001")
		if status, _ := h.call(t, "", route.Method, path, nil); status != http.StatusUnauthorized {
			t.Errorf("%s signed out: %d, want 401", route, status)
		}
	}
}

// ADR-0063: the place is sealed, under the key's version, and opens for its
// owner; the name every other surface shows is the road's numbers.
func TestKeepingARouteSealsItsPlace(t *testing.T) {
	h := setup(t, testKey(t, "k"))
	status, body := h.call(t, "alice", http.MethodPost, "/api/routes", request)
	if status != http.StatusCreated || body["hasPlace"] != true || body["hint"] != nil {
		t.Fatalf("keep: %d %v", status, body)
	}
	if body["generatedName"] != "Road · 3.0 km · 20 m" || body["name"] != body["generatedName"] {
		t.Fatalf("named %v / %v", body["name"], body["generatedName"])
	}
	id, _ := body["id"].(string)
	if row := h.rowText(t, id); strings.Contains(row, shape) || strings.Contains(row, hex.EncodeToString([]byte(shape))) {
		t.Fatal("the place is in the row in the clear")
	}
	var version int32
	if err := h.store.Pool.QueryRow(t.Context(), "select key_version from routes where id = $1", id).Scan(&version); err != nil || version != h.keys.Version() {
		t.Fatalf("key_version %d (%v), want %d", version, err, h.keys.Version())
	}
	if status, got := h.call(t, "alice", http.MethodGet, "/api/routes/"+id+"/shape", nil); status != http.StatusOK || got["shape"] != shape {
		t.Fatalf("the owner's shape: %d %v", status, got)
	}
	status, got := h.call(t, "alice", http.MethodGet, "/api/routes/"+id, nil)
	if status != http.StatusOK || got["road"] != base64.StdEncoding.EncodeToString(testx.FlatRoad(3000, 20)) || got["roadHash"] == "" {
		t.Fatalf("one route: %d %v", status, got)
	}
	status, list := h.call(t, "alice", http.MethodGet, "/api/routes", nil)
	if routes, _ := list["routes"].([]any); status != http.StatusOK || len(routes) != 1 {
		t.Fatalf("the list: %d %v", status, list)
	}
}

// ADR-0063: with no key the server keeps heights only and refuses the place —
// never a coordinate in the clear, which is the opposite of ADR-0035's
// fallback for a Strava token, on purpose.
func TestWithoutAKeyNoCoordinateReachesTheTable(t *testing.T) {
	h := setup(t, nil)
	status, body := h.call(t, "alice", http.MethodPost, "/api/routes", request)
	if status != http.StatusCreated || body["hasPlace"] != false || body["hint"] != noKeyHint {
		t.Fatalf("keep without a key: %d %v", status, body)
	}
	id, _ := body["id"].(string)
	row := h.rowText(t, id)
	// A bytea column prints as hex, so the shape is looked for that way too.
	for _, piece := range []string{shape, shape[:8], hex.EncodeToString([]byte(shape[:8])), "48.87", "123.39"} {
		if strings.Contains(row, piece) {
			t.Fatalf("%q reached the table with no key to seal it:\n%s", piece, row)
		}
	}
	if !strings.Contains(row, `"geom_sealed":null`) || !strings.Contains(row, `"key_version":null`) {
		t.Fatalf("a place was stored with no key:\n%s", row)
	}
	if status, got := h.call(t, "alice", http.MethodGet, "/api/routes/"+id+"/shape", nil); status != http.StatusNotFound || got["message"] != noKeyHint {
		t.Fatalf("the shape of a heights-only route: %d %v", status, got)
	}
}

func TestSomebodyElsesRouteIsAbsent(t *testing.T) {
	h := setup(t, testKey(t, "k"))
	id := h.keep(t, "alice")
	for _, c := range []struct {
		method, path string
		body         any
	}{
		{http.MethodGet, "/api/routes/" + id, nil},
		{http.MethodGet, "/api/routes/" + id + "/shape", nil},
		{http.MethodPatch, "/api/routes/" + id, map[string]string{"name": "mine now"}},
		{http.MethodDelete, "/api/routes/" + id, nil},
	} {
		if status, body := h.call(t, "bob", c.method, c.path, c.body); status != http.StatusNotFound || body["error"] != "not_found" {
			t.Errorf("bob %s %s: %d %v, want 404", c.method, c.path, status, body)
		}
	}
	if status, list := h.call(t, "bob", http.MethodGet, "/api/routes", nil); status != http.StatusOK || len(list["routes"].([]any)) != 0 { //nolint:errcheck // a 200 carries the list
		t.Errorf("bob's list holds alice's route: %v", list)
	}
	if status, _ := h.call(t, "alice", http.MethodGet, "/api/routes/not-a-uuid", nil); status != http.StatusBadRequest {
		t.Errorf("a malformed id: %d, want 400", status)
	}
}

func TestKeepingARouteRefusesWhatIsNotOne(t *testing.T) {
	h := setup(t, testKey(t, "k"))
	with := func(key string, value any) map[string]any {
		out := map[string]any{}
		for k, v := range request {
			out[k] = v
		}
		out[key] = value
		return out
	}
	tests := []struct {
		name  string
		body  map[string]any
		field string
	}{
		{"a source that is not a file type", with("src", "kml"), "src"},
		{"heights from nowhere", with("eleSource", "guess"), "eleSource"},
		{"a road under 2 km", with("road", testx.FlatRoad(1000, 0)), "road"},
		{"bytes that are not a road", with("road", []byte("hello")), "road"},
		{"a climb past the road's end", with("climbs", []map[string]any{{"startM": 100, "topM": 4000, "gainM": 5}}), "climbs"},
		{"a climb class SPEC does not have", with("climbs", []map[string]any{{"startM": 1, "topM": 2, "gainM": 1, "cls": "V"}}), "climbs"},
		{"a shape that is not a polyline", with("shape", "not a polyline"), "shape"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status, body := h.call(t, "alice", http.MethodPost, "/api/routes", tt.body)
			if status != http.StatusBadRequest || body["field"] != tt.field || body["error"] != "validation_error" {
				t.Fatalf("%d %v, want 400 on %s", status, body, tt.field)
			}
		})
	}
	if status, _ := h.call(t, "alice", http.MethodPost, "/api/routes", map[string]any{"src": "gpx", "extra": 1}); status != http.StatusBadRequest {
		t.Errorf("an unknown field: %d, want 400", status)
	}
}

func TestRenamingAndDeletingARoute(t *testing.T) {
	h := setup(t, testKey(t, "k"))
	id := h.keep(t, "alice")
	if status, body := h.call(t, "alice", http.MethodPatch, "/api/routes/"+id, map[string]string{"name": "  Stollestich loop  "}); status != http.StatusOK || body["name"] != "Stollestich loop" {
		t.Fatalf("rename: %d %v", status, body)
	}
	_, got := h.call(t, "alice", http.MethodGet, "/api/routes/"+id, nil)
	if got["name"] != "Stollestich loop" || got["generatedName"] != "Road · 3.0 km · 20 m" {
		t.Fatalf("the owner's name replaced the generated one: %v", got)
	}
	for _, name := range []string{"", "   ", strings.Repeat("x", 81)} {
		if status, body := h.call(t, "alice", http.MethodPatch, "/api/routes/"+id, map[string]string{"name": name}); status != http.StatusBadRequest || body["field"] != "name" {
			t.Errorf("rename to %q: %d %v, want 400", name, status, body)
		}
	}
	if status, _ := h.call(t, "alice", http.MethodDelete, "/api/routes/"+id, nil); status != http.StatusNoContent {
		t.Fatalf("delete: %d", status)
	}
	if status, _ := h.call(t, "alice", http.MethodGet, "/api/routes/"+id, nil); status != http.StatusNotFound {
		t.Fatalf("a deleted route: %d, want 404", status)
	}
	var left int
	if err := h.store.Pool.QueryRow(t.Context(), "select count(*) from routes where id = $1", id).Scan(&left); err != nil || left != 0 {
		t.Fatalf("the row outlived the delete: %d (%v)", left, err)
	}
}

// A rotated key is a re-seal, not a loss (ADR-0063): every route under the
// old key moves to the new one and opens there, and a second run moves none.
func TestResealMovesRoutesToTheNewKey(t *testing.T) {
	prev, next := testKey(t, "a"), testKey(t, "b")
	h := setup(t, prev)
	id := h.keep(t, "alice")
	if prev.Version() == next.Version() {
		t.Fatal("two keys share a version")
	}
	moved, err := Reseal(t.Context(), h.store.Queries, prev, next)
	if err != nil || moved < 1 {
		t.Fatalf("re-seal moved %d (%v)", moved, err)
	}
	var sealed, stored, roadSealed []byte
	var version int32
	if err := h.store.Pool.QueryRow(t.Context(), "select geom_sealed, key_version, road, road_sealed from routes where id = $1", id).
		Scan(&sealed, &version, &stored, &roadSealed); err != nil {
		t.Fatal(err)
	}
	// The whole road moves with the shape (#3511).
	if whole, err := WholeRoad(next, stored, roadSealed, &version); err != nil || !bytes.Equal(whole, testx.FlatRoad(3000, 20)) {
		t.Fatalf("the new key opens a road of %d bytes (%v), want the one posted", len(whole), err)
	}
	if version != next.Version() {
		t.Fatalf("key_version %d, want the new key's %d", version, next.Version())
	}
	if got, err := Open(next, sealed, &version); err != nil || got != shape {
		t.Fatalf("the new key opens %q (%v)", got, err)
	}
	if _, err := Open(prev, sealed, &version); err == nil {
		t.Fatal("the old key still opens a re-sealed route")
	}
	if again, err := Reseal(t.Context(), h.store.Queries, prev, next); err != nil || again != 0 {
		t.Fatalf("a second re-seal moved %d (%v)", again, err)
	}
}
