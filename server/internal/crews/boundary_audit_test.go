package crews

import (
	"net/http"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// publicCrewRoutes answer a signed-out caller on purpose, each for its reason.
// Every other route this package mounts must refuse one with 401.
var publicCrewRoutes = map[string]string{
	"GET /api/crew-doors/{code}":           "the door an invite opens, before any sign-in (#1236)",
	"GET /api/crew-doors/{code}/image":     "the door's picture, beside it",
	"GET /api/crews/{id}/calendar/{token}": "a calendar feed, authorised by its token",
	"GET /api/calendar/{token}":            "a calendar feed, authorised by its token",
}

// Every route this package mounts refuses the signed-out, read from the
// source rather than listed by hand (#2876 L9-12). errors.md asks every
// endpoint for its 401; the hand list this replaced (audit 2026-09-09) covered
// twelve, and the ADR-0058 re-key carried seven more crew routes and every
// schedule write past it untested. A new route is in this sweep the moment
// it is mounted; a public one has to say why above.
func TestEveryCrewRouteRefusesTheSignedOut(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Signed Out Sweep")
	fill := strings.NewReplacer(
		"{id}", store.UUIDString(crew.ID),
		"{code}", codeOf(crew.Code),
		"{plan}", "00000000-0000-4000-8000-000000000001",
		"{pinID}", "00000000-0000-4000-8000-000000000002",
		"{token}", "not-a-token",
		"{slug}", "not-a-room",
	)
	listed := 0
	for _, route := range testx.MountedRoutes(t) {
		path := fill.Replace(route.Pattern)
		if _, public := publicCrewRoutes[route.String()]; public {
			listed++
			// And public in fact: a listed route that wants a session after
			// all would leave the list lying.
			if status, _ := h.call(t, "", route.Method, path, ""); status == http.StatusUnauthorized {
				t.Errorf("%s is listed as public but refuses the signed-out", route)
			}
			continue
		}
		body := ""
		if route.Method != http.MethodGet && route.Method != http.MethodDelete {
			body = "{}"
		}
		if status, _ := h.call(t, "", route.Method, path, body); status != http.StatusUnauthorized {
			t.Errorf("%s signed out: %d, want 401", route, status)
		}
	}
	if listed != len(publicCrewRoutes) {
		t.Errorf("%d of the %d public routes listed are still mounted", listed, len(publicCrewRoutes))
	}
}
