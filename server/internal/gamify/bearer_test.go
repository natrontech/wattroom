package gamify

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// bearerOnly stands in for tokens.ReadSource with a personal token present:
// it authenticates the header a bearer arrives on and nothing else, so a
// route that asks the cookie source instead shows up as a 401.
type bearerOnly struct{ user db.User }

func (b bearerOnly) User(r *http.Request) (db.User, bool) {
	return b.user, r.Header.Get("Authorization") != ""
}

func (b bearerOnly) RequireUser(w http.ResponseWriter, r *http.Request, refusal string) (db.User, bool) {
	user, ok := b.User(r)
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", refusal)
	}
	return user, ok
}

// ADR-0017's amendment makes two rulings in one paragraph, and they are
// consistent: a bearer authenticates GET /api/me/trophies, and it never
// authenticates a route keyed on another rider's id. #1736 was right about
// the second and fixed it by repointing the WHOLE service at the cookie
// source, so the first quietly stopped being true — the ADR is the only place
// that list exists, and a coach agent built from it got a 401 (#2257).
//
// Asserted here rather than left to the wiring, which is what let one change
// take both.
func TestOnlyTheRidersOwnCaseTakesABearer(t *testing.T) {
	s, _, alice, bob := setup(t)
	// A caller holding a personal token and no session: the cookie source
	// knows nobody, the bearer source knows alice.
	signedOut := &testx.Users{ByToken: map[string]db.User{}}
	svc := New(s.store, signedOut, bearerOnly{user: alice}, slog.New(slog.DiscardHandler))
	mux := http.NewServeMux()
	svc.Register(mux)

	get := func(path string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer a-personal-token")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		return rec
	}

	if rec := get("/api/me/trophies"); rec.Code != http.StatusOK {
		t.Errorf("a bearer was refused their own trophy case: %d %s — ADR-0017 names this route", rec.Code, rec.Body)
	}
	// The other half of the same paragraph, and #1736's whole point.
	if rec := get("/api/riders/" + store.UUIDString(bob.ID) + "/trophies"); rec.Code != http.StatusUnauthorized {
		t.Errorf("a bearer reached a route keyed on another rider's id: %d %s", rec.Code, rec.Body)
	}
	// Including when that id is the token holder's own: the rule is about the
	// route, not about who is asking, so there is no spelling of it that gets
	// a token onto the keyed route.
	if rec := get("/api/riders/" + store.UUIDString(alice.ID) + "/trophies"); rec.Code != http.StatusUnauthorized {
		t.Errorf("a bearer reached the keyed route by naming themselves: %d %s", rec.Code, rec.Body)
	}
}
