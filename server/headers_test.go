package main

import (
	"crypto/sha256"
	"encoding/base64"
	"slices"
	"strings"
	"testing"
	"testing/fstest"
)

func hashSource(script string) string {
	sum := sha256.Sum256([]byte(script))
	return "'sha256-" + base64.StdEncoding.EncodeToString(sum[:]) + "'"
}

// The build's inline scripts are allowed by hash and nothing else is (#2965):
// every executable inline script on every page, once each, and not a script
// with a src (that is 'self'), not a JSON-LD data block (never executed) and
// not a file that is not a page.
func TestInlineScriptHashesAreTheBuildsExecutableInlineScripts(t *testing.T) {
	theme := "\n\t\t\t// The rider's theme before the bundle runs\n\t\t\tdocument.documentElement.dataset.theme = 'dark';\n\t\t"
	boot := "\n\t\t\t\t{\n\t\t\t\t\t__sveltekit_x = { base: \"\" };\n\t\t\t\t}\n\t\t\t"
	landingBoot := "\n\t\t\t\t{ __sveltekit_x = { base: new URL(\".\", location).pathname.slice(0, -1) }; }\n\t\t\t"
	module := "import('/_app/immutable/entry/start.js')"
	ldJSON := `{"@context":"https://schema.org","@type":"Article"}`
	page := func(scripts ...string) *fstest.MapFile {
		return &fstest.MapFile{Data: []byte("<!doctype html><html><head>" + strings.Join(scripts, "") + "</head><body></body></html>")}
	}
	dist := fstest.MapFS{
		"spa.html":      page("<script>"+theme+"</script>", "<script>"+boot+"</script>"),
		"index.html":    page(`<script type="application/ld+json">`+ldJSON+"</script>", "<script>"+theme+"</script>", "<script>"+landingBoot+"</script>"),
		"vs/zwift.html": page(`<script src="/_app/immutable/x.js"></script>`, `<script type="module">`+module+"</script>"),
		"changelog.md":  {Data: []byte("<script>not a page</script>")},
	}

	got := inlineScriptHashes(dist)
	want := []string{hashSource(theme), hashSource(boot), hashSource(landingBoot), hashSource(module)}
	slices.Sort(want)
	if !slices.Equal(got, want) {
		t.Fatalf("inline script hashes = %v, want %v", got, want)
	}

	policy := directives(t, enforcedCSP(got))["script-src"]
	if strings.Contains(policy, "'unsafe-inline'") {
		t.Errorf("script-src still allows every inline script: %s", policy)
	}
	for _, h := range want {
		if !strings.Contains(policy, h) {
			t.Errorf("script-src %q is missing %s", policy, h)
		}
	}
	if !strings.HasPrefix(policy, "'self' ") || !strings.HasSuffix(policy, " blob: https://www.youtube.com") {
		t.Errorf("script-src %q lost what it allowed besides the hashes", policy)
	}
}
