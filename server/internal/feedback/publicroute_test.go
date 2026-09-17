package feedback

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPublicRouteRedactsEveryNameCarryingShape(t *testing.T) {
	// One case per route shape that carries a name (#2240). The room and the
	// DM peer were the only two the prefix list knew about; the crew invite
	// code is the sharpest of the rest, because knowing it is the permission
	// to join.
	for route, want := range map[string]string{
		"/ride":                    "/ride",
		"/rooms/directory":         "/rooms/directory",
		"/settings/profile":        "/settings/profile",
		"/r/mfw-5":                 "/r/…",
		"/r/mfw-5/sessions":        "/r/…/sessions",
		"/messages/dm/u-123":       "/messages/dm/…",
		"/messages/r/mfw-5":        "/messages/r/…",
		"/dm/u-123":                "/dm/…",
		"/u/2f1c-velvet":           "/u/…",
		"/crew/3ab9":               "/crew/…",
		"/crew/3ab9/settings":      "/crew/…/settings",
		"/c/K7M2QX":                "/c/…",
		"/history/9c81":            "/history/…",
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

// The route tree is the specification: every screen the app has, with its
// parameters filled in by a name no public issue may repeat. A route shape
// added to web/src/routes without a thought for this file fails here rather
// than in a world-readable issue title.
func TestPublicRouteRedactsTheWholeRouteTree(t *testing.T) {
	const marker = "velvet-was-here"
	dir := filepath.Join("..", "..", "..", "web", "src", "routes")
	if _, err := os.Stat(dir); err != nil {
		t.Fatalf("route tree not readable at %s: %v", dir, err)
	}
	var routes int
	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || d.Name() != "+page.svelte" {
			return nil
		}
		rel, err := filepath.Rel(dir, filepath.Dir(path))
		if err != nil {
			return err
		}
		route := "/"
		if rel != "." {
			var segs []string
			for _, seg := range strings.Split(filepath.ToSlash(rel), "/") {
				switch {
				case strings.HasPrefix(seg, "("): // a SvelteKit group: no URL of its own
				case strings.HasPrefix(seg, "["): // a parameter: a name stands here
					segs = append(segs, marker)
				default:
					segs = append(segs, seg)
				}
			}
			route += strings.Join(segs, "/")
		}
		routes++
		if got := publicRoute(route); strings.Contains(got, marker) {
			t.Errorf("publicRoute(%q) = %q — a public issue would name somebody", route, got)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk route tree: %v", err)
	}
	if routes < 20 {
		t.Fatalf("walked %d routes — the tree is not where this test thinks it is", routes)
	}
}

// The other half of the same seam: a literal segment missing from the
// allowlist is not a disclosure, but it does turn a readable screen into
// `/…` and costs triage the one fact the issue is allowed to carry.
func TestRouteSegmentsCoverTheRouteTree(t *testing.T) {
	dir := filepath.Join("..", "..", "..", "web", "src", "routes")
	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		name := d.Name()
		if !d.IsDir() || path == dir || strings.HasPrefix(name, "(") || strings.HasPrefix(name, "[") {
			return nil
		}
		if !routeSegments[name] {
			t.Errorf("route segment %q is in web/src/routes but not in routeSegments", name)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk route tree: %v", err)
	}
}
