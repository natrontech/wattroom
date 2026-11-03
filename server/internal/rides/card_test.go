package rides

import (
	"bytes"
	"encoding/json"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

func cardRequest(t *testing.T, h *harness, user, id string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/rides/"+id+"/card.png", nil)
	if user != "" {
		r.Header.Set("X-Test-User", user)
	}
	w := httptest.NewRecorder()
	h.mux.ServeHTTP(w, r)
	return w
}

func TestCardOwnerGetsAPNG(t *testing.T) {
	h := setup(t)
	id := h.save(t, "alice", 600, 240)
	w := cardRequest(t, h, "alice", id)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	if got := w.Header().Get("Content-Type"); got != "image/png" {
		t.Fatalf("content type = %q", got)
	}
	// A rider's whole ride shape: never a shared cache's to keep.
	if got := w.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("cache-control = %q", got)
	}
	// Named the way the FIT download is (#1549), so a folder of them reads.
	if cd := w.Header().Get("Content-Disposition"); !strings.HasSuffix(cd, `-openers.png"`) || !strings.Contains(cd, "wattroom-20") {
		t.Fatalf("card filename: %q", cd)
	}
	img, err := png.Decode(bytes.NewReader(w.Body.Bytes()))
	if err != nil {
		t.Fatalf("decode PNG: %v", err)
	}
	if got := img.Bounds().Size(); got.X != 1080 || got.Y != 1080 {
		t.Fatalf("card is %v, want 1080 square", got)
	}
}

// The card is the ride, so it is the ride's own access rules — the same ones
// the FIT export has, and for the same reason (ADR-0008, ADR-0017).
func TestCardAuthorization(t *testing.T) {
	h := setup(t)
	id := h.save(t, "alice", 600, 240)
	if status, _ := call(t, h.mux, "alice", http.MethodPatch, "/api/rides/"+id, `{"sharedWithFriends":true}`); status != http.StatusOK {
		t.Fatalf("share: %d", status)
	}
	if w := cardRequest(t, h, "", id); w.Code != http.StatusUnauthorized {
		t.Errorf("anonymous = %d", w.Code)
	}
	// Shared with friends is not shared with the world: a card of somebody
	// else's ride reads as absent, never as forbidden.
	if w := cardRequest(t, h, "bob", id); w.Code != http.StatusNotFound {
		t.Errorf("other user = %d", w.Code)
	}
	for _, tc := range []struct {
		name, id string
		want     int
	}{{"invalid", "nope", 400}, {"missing", "00000000-0000-0000-0000-000000000000", 404}} {
		t.Run(tc.name, func(t *testing.T) {
			if w := cardRequest(t, h, "alice", tc.id); w.Code != tc.want {
				t.Errorf("status = %d, want %d", w.Code, tc.want)
			}
		})
	}
}

// A road ride's card is its poster, named in the generated name's numbers
// (#3142, #3055) for what was ridden (#4229): the replay of this ride's two
// minutes at 250 W covers about 890 m of a 5 km road (#3149). Never the owner's own name for the road, even on a ride saved
// before road rides were kept under the generated one.
func TestARoadRideCardIsNamedByWhatWasRidden(t *testing.T) {
	h := setup(t)
	routeID, _ := storeRoute(t, h, "alice")
	status, got := call(t, h.mux, "alice", http.MethodPost, "/api/rides", freeRideOn(routeID, 8, ""))
	if status != http.StatusCreated {
		t.Fatalf("save: %d %v", status, got)
	}
	id, _ := got["id"].(string)
	if _, err := h.store.Pool.Exec(t.Context(), `update rides set workout_name = 'My street to work' where id = $1`, id); err != nil {
		t.Fatal(err)
	}
	w := cardRequest(t, h, "alice", id)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	if cd := w.Header().Get("Content-Disposition"); !strings.Contains(cd, "road-0-9-km-") || strings.Contains(cd, "street") {
		t.Errorf("the poster is named %q; want the ridden 0.9 km, never the road's 5.0 or the owner's name", cd)
	}
	if _, err := png.Decode(bytes.NewReader(w.Body.Bytes())); err != nil {
		t.Fatalf("decode PNG: %v", err)
	}
	// And the ride's page knows it rode a road, so its button offers the poster.
	if _, detail := call(t, h.mux, "alice", http.MethodGet, "/api/rides/"+id, ""); detail["distanceM"] == nil {
		t.Errorf("the ride's page carries no distance: %v", detail)
	}
}

func TestRiddenIsWhatThePlacedSecondsCovered(t *testing.T) {
	at := func(m, alt float64) protocol.RiderMetrics { return protocol.RiderMetrics{M: m, Alt: alt} }
	for _, tc := range []struct {
		name          string
		samples       []protocol.RiderMetrics
		length, climb float64
	}{
		{"none placed", []protocol.RiderMetrics{at(0, 0), at(0, 0)}, 0, 0},
		{"from where the road began", []protocol.RiderMetrics{at(0, 0), at(1000, 500), at(1500, 520), at(2000, 510)}, 1000, 20},
		{"a descent climbs nothing", []protocol.RiderMetrics{at(100, 900), at(600, 850)}, 500, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if length, climb := ridden(tc.samples); length != tc.length || climb != tc.climb {
				t.Errorf("ridden = %v m, %v m up; want %v, %v", length, climb, tc.length, tc.climb)
			}
		})
	}
}

// The card wears the rider's appearance (#4098): the account's own by
// default, or the one the download picked, and never a theme the app lacks.
func TestCardTheme(t *testing.T) {
	h := setup(t)
	id := h.save(t, "alice", 600, 240)
	card := func(query string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/rides/"+id+"/card.png"+query, nil)
		r.Header.Set("X-Test-User", "alice")
		w := httptest.NewRecorder()
		h.mux.ServeHTTP(w, r)
		return w
	}
	ok := func(query string) []byte {
		t.Helper()
		w := card(query)
		if w.Code != http.StatusOK {
			t.Fatalf("%q: status = %d, body = %s", query, w.Code, w.Body.String())
		}
		return w.Body.Bytes()
	}

	// No choice on the account: Outrun, dark — and auto can't be resolved
	// here, so an auto scheme draws dark too.
	outrun := ok("")
	if !bytes.Equal(ok("?identity=outrun&family=dark"), outrun) {
		t.Error("an account that never chose a theme does not get Outrun's dark card")
	}
	tronDay := ok("?identity=tron&family=light")
	if bytes.Equal(tronDay, outrun) {
		t.Error("picking Tron Day drew the same card as Outrun")
	}

	// The account's own appearance is the default, and the query wins over it.
	alice := h.users.ByToken["alice"]
	palette, scheme := `{"kind":"preset","identity":"tron"}`, "light"
	alice.AccentPalette, alice.ColorScheme = &palette, &scheme
	h.users.ByToken["alice"] = alice
	if !bytes.Equal(ok(""), tronDay) {
		t.Error("the card ignored the account's stored appearance")
	}
	if !bytes.Equal(ok("?identity=outrun&family=dark"), outrun) {
		t.Error("the download's pick did not win over the account's appearance")
	}
	auto := ""
	alice.ColorScheme = &auto
	h.users.ByToken["alice"] = alice
	if !bytes.Equal(ok(""), ok("?identity=tron&family=dark")) {
		t.Error("an auto scheme did not draw the identity's dark half")
	}

	for _, tc := range []struct{ query, field string }{
		{"?identity=vaporwave", "identity"},
		{"?identity=tron&family=auto", "family"},
		{"?family=", "family"},
	} {
		t.Run(tc.query, func(t *testing.T) {
			w := card(tc.query)
			var body struct{ Error, Message, Field string }
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatalf("status %d, body not JSON: %s", w.Code, w.Body.String())
			}
			if w.Code != http.StatusBadRequest || body.Error != "validation_error" || body.Field != tc.field || body.Message == "" {
				t.Errorf("status %d, body %+v; want 400 validation_error on %s", w.Code, body, tc.field)
			}
		})
	}
}
