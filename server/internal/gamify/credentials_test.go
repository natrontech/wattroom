package gamify

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// bearerSource is tokens.ReadSource's shape: a session resolves first, and
// failing that a GET carrying a personal token resolves to the token's owner
// (ADR-0017). The cookie source it wraps knows nothing about the header,
// which is the whole point — only the routes handed this wrapper accept a
// bearer.
type bearerSource struct {
	cookie *testx.Users
	owner  db.User
}

func (b bearerSource) User(r *http.Request) (db.User, bool) {
	if user, ok := b.cookie.User(r); ok {
		return user, true
	}
	if r.Method == http.MethodGet && r.Header.Get("Authorization") == "Bearer wrt_test" {
		return b.owner, true
	}
	return db.User{}, false
}

func (b bearerSource) RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool) {
	user, ok := b.User(r)
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", signInMessage)
	}
	return user, ok
}

func bearerGet(t *testing.T, mux *http.ServeMux, path string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
	req.Header.Set("Authorization", "Bearer wrt_test")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

// ADR-0017 names `GET /api/me/trophies` among the five routes a bearer
// authenticates, and says in the same breath that a token never reaches a
// route keyed on another rider's id. Both halves are one wiring decision
// (#1736 repointed the whole service and took the first half with it, #2257
// split it back), so both are asserted here: mounting the rider route on the
// bearer source, or the self route on the cookie source, turns one of these
// red.
func TestOnlyTheRidersOwnTrophyCaseTakesAPersonalToken(t *testing.T) {
	s, users, alice, bob := setup(t)
	mux := http.NewServeMux()
	s.Register(mux, bearerSource{cookie: users, owner: alice})

	if rec := bearerGet(t, mux, "/api/me/trophies"); rec.Code != http.StatusOK {
		t.Errorf("bearer on own case: %d, want 200 — ADR-0017 promises this route", rec.Code)
	}
	for _, rider := range []struct {
		who string
		id  string
	}{
		{"another rider", store.UUIDString(bob.ID)},
		// The token's own owner too: it is the *route* that is keyed on an
		// id, and a bearer that may read one id may be handed another.
		{"the token's owner", store.UUIDString(alice.ID)},
	} {
		rec := bearerGet(t, mux, "/api/riders/"+rider.id+"/trophies")
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("bearer on %s's case: %d, want 401", rider.who, rec.Code)
		}
	}

	// The 401s above were the credential and not the fake refusing
	// everything: a session reaches both routes.
	if rec, _ := get(t, mux, "/api/me/trophies", "alice"); rec.Code != http.StatusOK {
		t.Errorf("session on own case: %d, want 200", rec.Code)
	}
	if rec, _ := get(t, mux, "/api/riders/"+store.UUIDString(alice.ID)+"/trophies", "alice"); rec.Code != http.StatusOK {
		t.Errorf("session on the rider route: %d, want 200", rec.Code)
	}
}
