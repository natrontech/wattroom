package playlists

import (
	"net/http"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// Every route this package mounts refuses the signed-out (#2876 L9-12), read
// from the source: only the crew playlist's GET had a signed-out case, and
// its writes, the personal playlists and the channel queue had none. None of
// these is public, so there is no list of exceptions.
func TestEveryPlaylistRouteRefusesTheSignedOut(t *testing.T) {
	h := setup(t)
	crew := h.crew(t, "alice")
	for _, route := range testx.MountedRoutes(t) {
		id := store.UUIDString(crew.id)
		if strings.HasPrefix(route.Pattern, "/api/channels/") {
			id = crew.voice()
		}
		path := strings.NewReplacer(
			"{id}", id,
			"{playlist}", "00000000-0000-4000-8000-000000000001",
			"{trackID}", "00000000-0000-4000-8000-000000000002",
		).Replace(route.Pattern)
		body := ""
		if route.Method != http.MethodGet && route.Method != http.MethodDelete {
			body = "{}"
		}
		if status, _ := h.call(t, "", route.Method, path, body); status != http.StatusUnauthorized {
			t.Errorf("%s signed out: %d, want 401", route, status)
		}
	}
}
