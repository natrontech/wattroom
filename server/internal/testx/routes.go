package testx

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// Route is one pattern a package mounts: "GET /api/crews/{id}".
type Route struct{ Method, Pattern string }

func (r Route) String() string { return r.Method + " " + r.Pattern }

var mounted = regexp.MustCompile(`mux\.HandleFunc\("([A-Z]+) ([^"]+)"`)

// MountedRoutes reads every mux.HandleFunc pattern in the calling package's
// own non-test source (#2876 L9-12). A sweep built on it covers a route the
// moment the route is mounted; a hand-kept list covers what its author
// remembered, and the ADR-0058 re-key carried seven crew routes past one.
func MountedRoutes(t testing.TB) []Route {
	t.Helper()
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	var routes []Route
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		src, err := os.ReadFile(f) //nolint:gosec // the package's own source
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range mounted.FindAllStringSubmatch(string(src), -1) {
			routes = append(routes, Route{Method: m[1], Pattern: m[2]})
		}
	}
	if len(routes) == 0 {
		t.Fatal("no mux.HandleFunc found in this package's source — the pattern no longer finds them")
	}
	return routes
}
