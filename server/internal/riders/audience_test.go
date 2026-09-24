package riders

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/natrontech/wattroom/server/internal/gamify"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// ADR-0024 settles ONE audience for a rider's page: a shared live room, an
// accepted friendship, or a pending request from that rider — plus the rider
// themselves. Three endpoints serve it, and each used to decide it for itself:
// riders.handleGet composed ListRoomsInCommon with friendStatus in Go,
// gamify.handleRider called the SharesChannelOrFriends SQL (#2298), and
// riders.handleAvatar asked nothing at all and answered everyone (#2239).
//
// They agreed by coincidence. This is the test that would have caught them
// drifting, and the reason it lives here rather than in any package's own gate
// tests: the property is that the three ANSWER THE SAME, which none can assert
// alone.
func TestBothRoutesServeOneAudience(t *testing.T) {
	h := setup(t)
	h.crew(t, "one-audience-cave", "alice", "bob")
	h.befriend(t, "alice", "dan")
	// Every rider carries a picture, so a 404 from the avatar route is the
	// gate refusing and never "there is nothing stored".
	for _, name := range []string{"alice", "bob", "cara", "dan"} {
		h.avatar(t, name)
	}
	// dan asked cara; nothing came of it yet.
	if _, err := h.store.Queries.CreateFriendRequest(t.Context(), db.CreateFriendRequestParams{
		RequesterID: h.users.ByToken["dan"].ID, AddresseeID: h.users.ByToken["cara"].ID,
	}); err != nil {
		t.Fatalf("request: %v", err)
	}
	// Both routes on one mux, which is the only way to ask them the same
	// question in the same breath.
	gamify.New(h.store, h.users, h.users, slog.New(slog.DiscardHandler)).Register(h.mux)

	ask := func(t *testing.T, viewer, path string) int {
		t.Helper()
		req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
		req.Header.Set("X-Test-User", viewer)
		w := httptest.NewRecorder()
		h.mux.ServeHTTP(w, req)
		var ignored map[string]any
		_ = json.NewDecoder(w.Body).Decode(&ignored)
		return w.Code
	}

	for _, tc := range []struct {
		name, viewer, rider string
		want                int
	}{
		{"a stranger", "cara", "bob", http.StatusNotFound},
		{"a room-mate", "alice", "bob", http.StatusOK},
		{"a friend", "alice", "dan", http.StatusOK},
		{"the rider themselves", "alice", "alice", http.StatusOK},
		// cara is in no room and holds no friendship, so the query's self
		// clause is the only thing that opens this. The case above does not
		// cover it: alice is in a room, and the shared-room leg matches a
		// rider against themselves. Deleting the clause as redundant left
		// every other case green while a brand-new rider lost their own page
		// — and split the two routes, since gamify short-circuits self in Go.
		{"themselves, with no room and no friend", "cara", "cara", http.StatusOK},
		{"someone who asked to be friends", "cara", "dan", http.StatusOK},
		{"someone they asked", "dan", "cara", http.StatusNotFound},
	} {
		t.Run(tc.name, func(t *testing.T) {
			id := h.id(tc.rider)
			page := ask(t, tc.viewer, "/api/riders/"+id)
			trophies := ask(t, tc.viewer, "/api/riders/"+id+"/trophies")
			face := ask(t, tc.viewer, "/api/riders/"+id+"/avatar")
			if page != tc.want || trophies != tc.want || face != tc.want {
				t.Errorf("the page answered %d, the trophy case on it %d and the face on it %d; ADR-0024 grants one audience, and here it is %d",
					page, trophies, face, tc.want)
			}
		})
	}
}
