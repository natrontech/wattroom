package feedback

import (
	"testing"
)

func TestPublicRouteRedactsEveryNameCarryingShape(t *testing.T) {
	// One case per route shape that carries a name (#2240). The room and the
	// DM peer were the only two the prefix list knew about; the crew invite
	// code is the sharpest of the rest, because knowing it is the permission
	// to join.
	for route, want := range map[string]string{
		"/ride":               "/ride",
		"/crews/directory":    "/crews/directory",
		"/settings/profile":   "/settings/profile",
		"/r/mfw-5":            "/r/…",
		"/r/mfw-5/sessions":   "/r/…/sessions",
		"/messages/dm/u-123":  "/messages/dm/…",
		"/messages/r/mfw-5":   "/messages/r/…",
		"/dm/u-123":           "/dm/…",
		"/u/2f1c-velvet":      "/u/…",
		"/crew/3ab9":          "/crew/…",
		"/crew/3ab9/settings": "/crew/…/settings",
		"/c/K7M2QX":           "/c/…",
		"/history/9c81":       "/history/…",
		// A room somebody called "training". Redacting by shape rather than
		// by word is the difference between this and a leak.
		"/r/training":              "/r/…",
		"/r/chat/chat":             "/r/…/chat",
		"/u/settings":              "/u/…",
		"/r/":                      "/r/",
		"/r/mfw-5?with=velvet":     "/r/…",
		"/ride#velvet":             "/ride",
		"/not-a-route-at-all":      "/…",
		"/r/mfw-5/../u/velvet":     "/r/…/…/u/…",
		"/settings/profile/velvet": "/settings/profile/…",
	} {
		if got := publicRoute(route); got != want {
			t.Errorf("publicRoute(%q) = %q, want %q", route, got, want)
		}
	}
}
