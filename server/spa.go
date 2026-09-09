// Serving the embedded SPA: the immutable assets with a year of cache, the
// index for every route the client owns, and the share previews og.go paints
// over it.
package main

import (
	// The zone database, embedded rather than the host's (#858): session mail
	// formats times in each rider's zone, and a distroless image is not where
	// that should depend on what the base layer happens to ship.
	_ "time/tzdata"

	"io/fs"
	"net/http"

	"strings"

	"github.com/natrontech/wattroom/server/internal/og"
)

// immutablePrefix is the SvelteKit build's content-hashed output. A file
// under it never changes meaning: a new build writes a new name, so a stale
// copy is unreachable rather than wrong. index.html is deliberately NOT in
// here — it is the fallback that names the current hashes, and spaHandler
// rewrites it per request to splice in og meta.
const immutablePrefix = "/_app/immutable/"

// spaHandler serves the embedded SvelteKit build; SPA-route fallbacks get
// index.html with og meta spliced in at request time (the embedded FS is
// read-only, and only the server knows what a /r/{slug} link points at).
func spaHandler(social *og.Service) http.Handler {
	dist, err := fs.Sub(webdist, "webdist")
	if err != nil {
		panic(err)
	}
	return serveSPA(dist, social)
}

// serveSPA is spaHandler with the build handed in, so a test can supply one:
// a dev checkout embeds an empty webdist, and the branch that matters most
// here is the one that only fires for a file that exists.
func serveSPA(dist fs.FS, social *og.Service) http.Handler {
	fileServer := http.FileServerFS(dist)
	index, _ := fs.ReadFile(dist, "index.html") // nil before `make web` (dev placeholder)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if p := strings.TrimPrefix(r.URL.Path, "/"); p != "" && p != "index.html" {
			if _, err := fs.Stat(dist, p); err == nil {
				// An embedded file has a zero ModTime, so http.ServeContent
				// emits neither Last-Modified nor ETag: without a header of
				// our own the browser has no validator to revalidate with and
				// re-downloads the whole shell on every cold load. SvelteKit
				// hashes everything under _app/immutable/ into its filename,
				// which is exactly what an immutable cache wants — the same
				// header chat and DM images already carry. Pinning these for a
				// year is only safe while the document naming them
				// revalidates; see the fallback below (#966).
				if strings.HasPrefix(r.URL.Path, immutablePrefix) {
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				} else {
					// Everything else keeps its name across builds —
					// favicon.png, changelog.md — so with no validator either
					// it must be revalidated, not guessed at (#966).
					w.Header().Set("Cache-Control", "no-cache")
				}
				fileServer.ServeHTTP(w, r)
				return
			}
		}
		if index == nil {
			r.URL.Path = "/" // no frontend build embedded; keep the old 404-ish behavior
			fileServer.ServeHTTP(w, r)
			return
		}
		// The document that names the current hashes has to be re-checked on
		// every visit. It went out with no directive and no validator, so a
		// browser was free to keep it — and once the hashes it names are
		// pinned for a year, a rider is stuck on that release until they hard
		// reload (#966). `no-cache` is "store it, but ask first", not "do not
		// store": the shell is a few KB and only it has to be revalidated.
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(social.Inject(index, r))
	})
}
