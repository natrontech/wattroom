package crews

import (
	"net/http"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store"
)

// errors.md asks every endpoint for its 401; the crew surface and the two
// calendar rotates had none (audit 2026-09-09).
func TestTheCrewSurfaceRefusesTheSignedOut(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Signed Out Crew")
	id := store.UUIDString(crew.ID)
	code := codeOf(crew.Code)
	for _, route := range []struct{ method, path, body string }{
		{http.MethodGet, "/api/crews/" + id, ""},
		{http.MethodPost, "/api/crew-doors/" + code + "/remember", ""},
		{http.MethodPost, "/api/crews", `{"name":"x"}`},
		{http.MethodPost, "/api/crews/join", `{"code":"ABCDEF"}`},
		{http.MethodPost, "/api/crews/" + id + "/leave", ""},
		{http.MethodPatch, "/api/crews/" + id, `{"name":"x"}`},
		{http.MethodPost, "/api/crews/" + id + "/role", `{"userId":"x","role":"admin"}`},
		{http.MethodPost, "/api/crews/" + id + "/transfer", `{"userId":"x"}`},
		{http.MethodPost, "/api/crews/" + id + "/image", ""},
		{http.MethodDelete, "/api/crews/" + id + "/image", ""},
		{http.MethodPost, "/api/crews/" + id + "/calendar/rotate", ""},
		{http.MethodPost, "/api/calendar/rotate", ""},
	} {
		if status, _ := h.call(t, "", route.method, route.path, route.body); status != http.StatusUnauthorized {
			t.Errorf("%s %s signed out: %d, want 401", route.method, route.path, status)
		}
	}
}
