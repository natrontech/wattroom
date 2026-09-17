package tokens

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store/db"
)

// errors.md's 404 for a bearer credential (#1415): a malformed id, and —
// the whole cross-account defence — another account's id.
func TestTokenDeleteIs404ForMalformedAndForeignIds(t *testing.T) {
	mux, _ := setup(t)
	code, body := call(t, mux, "alice", http.MethodPost, "/api/tokens", `{"name":"coach"}`)
	if code != http.StatusCreated {
		t.Fatalf("create: %d %v", code, body)
	}
	id, _ := body["id"].(string)
	if code, _ := call(t, mux, "alice", http.MethodDelete, "/api/tokens/not-a-uuid", ""); code != http.StatusNotFound {
		t.Errorf("malformed id: %d, want 404", code)
	}
	if code, _ := call(t, mux, "bob", http.MethodDelete, "/api/tokens/"+id, ""); code != http.StatusNotFound {
		t.Errorf("another account's token: %d, want 404", code)
	}
	// Alice's own still works, so the 404 above was scoping, not a bug.
	if code, _ := call(t, mux, "alice", http.MethodDelete, "/api/tokens/"+id, ""); code != http.StatusNoContent {
		t.Errorf("own token: %d, want 204", code)
	}
}

// A cookie source shaped like auth.Service: `User` resolves a session and
// checks nothing, `RequireUser` is the CSRF boundary (#678). The wrapper has
// to reach the second one for a mutating request, or every service built on
// it — rides, with DELETE among its routes — loses the boundary (#2227).
type boundarySource struct{ user db.User }

func (b boundarySource) User(*http.Request) (db.User, bool) { return b.user, true }

func (b boundarySource) RequireUser(w http.ResponseWriter, r *http.Request, _ string) (db.User, bool) {
	if r.Method != http.MethodGet && r.Header.Get("Origin") == "https://evil.example" {
		w.WriteHeader(http.StatusForbidden)
		return db.User{}, false
	}
	return b.user, true
}

func TestTheReadSourceKeepsTheCSRFBoundaryOnMutatingRequests(t *testing.T) {
	// No database: the wrapper only reaches the store for a bearer header,
	// and this is about the requests that carry a cookie instead.
	source := (&Service{}).ReadSource(boundarySource{user: db.User{DisplayName: "alice"}})

	for _, method := range []string{http.MethodPost, http.MethodPatch, http.MethodPut, http.MethodDelete} {
		req := httptest.NewRequestWithContext(t.Context(), method, "/api/rides/1", nil)
		req.Header.Set("Origin", "https://evil.example")
		rec := httptest.NewRecorder()
		if _, ok := source.RequireUser(rec, req, "Sign in."); ok {
			t.Errorf("%s from another origin was allowed", method)
		}
		if rec.Code != http.StatusForbidden {
			t.Errorf("%s from another origin: %d, want 403", method, rec.Code)
		}
	}

	// The same request from our own origin still works, so the refusal above
	// was the boundary and not the wrapper refusing everything.
	req := httptest.NewRequestWithContext(t.Context(), http.MethodDelete, "/api/rides/1", nil)
	rec := httptest.NewRecorder()
	if _, ok := source.RequireUser(rec, req, "Sign in."); !ok {
		t.Fatalf("same-origin DELETE was refused: %d", rec.Code)
	}
	// And a GET still reaches the bearer path.
	get := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/rides", nil)
	if _, ok := source.RequireUser(httptest.NewRecorder(), get, "Sign in."); !ok {
		t.Fatal("a GET with a session was refused")
	}
}
