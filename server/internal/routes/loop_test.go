package routes

import (
	"maps"
	"net/http"
	"testing"
)

// A route says whether it ends where it began (#3680), as the browser that
// parsed it told the server: its heights and turns cannot. One stored before
// that says neither.
func TestARouteKeepsWhetherItIsALoop(t *testing.T) {
	h := setup(t, nil)
	for _, c := range []struct {
		name string
		loop any
		want any
	}{
		{"a loop", true, true},
		{"point to point", false, false},
		{"never told", nil, nil},
	} {
		body := maps.Clone(request)
		if c.loop != nil {
			body["loop"] = c.loop
		}
		status, made := h.call(t, "alice", http.MethodPost, "/api/routes", body)
		if status != http.StatusCreated {
			t.Fatalf("%s: keep: %d %v", c.name, status, made)
		}
		if made["loop"] != c.want {
			t.Errorf("%s: the create answered loop = %v, want %v", c.name, made["loop"], c.want)
		}
		_, got := h.call(t, "alice", http.MethodGet, "/api/routes/"+made["id"].(string), nil)
		if got["loop"] != c.want {
			t.Errorf("%s: the read says loop = %v, want %v", c.name, got["loop"], c.want)
		}
	}
}
