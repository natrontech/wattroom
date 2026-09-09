// Serving the embedded SPA: the immutable assets with a year of cache, the
// index for every route the client owns, and the share previews og.go paints
// over it.
package main

import (
	// The zone database, embedded rather than the host's (#858): session mail
	// formats times in each rider's zone, and a distroless image is not where
	// that should depend on what the base layer happens to ship.
	_ "time/tzdata"

	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"io/fs"
	"net/http"
	"path/filepath"
	"strings"
	"sync"

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
//
// Two things the bare file server did not do (audit 2026-09-09):
//
//   - a validator. An embedded file has a zero ModTime, so http.ServeContent
//     emits neither Last-Modified nor ETag, and "no-cache" with no validator
//     cannot produce a 304: the 114 KB changelog.md was re-downloaded on
//     every visit to /home, and the shell on every cold load. Every
//     non-hashed file and the index fallback now carry a weak ETag over
//     their bytes — weak, because the same bytes go out gzipped or not.
//   - compression. The eager shell is ~460 KB raw and ~170 KB gzipped, and
//     the binary served it raw, leaving the 2.75× to an edge proxy in a repo
//     this one cannot see or test (deploy/Caddyfile says as much). Text
//     responses are gzipped here for any client that asks.
func serveSPA(dist fs.FS, social *og.Service) http.Handler {
	index, _ := fs.ReadFile(dist, "index.html") // nil before `make web` (dev placeholder)
	s := &spa{dist: dist, files: http.FileServerFS(dist), index: index, social: social}
	return compressed(s)
}

type spa struct {
	dist   fs.FS
	files  http.Handler
	index  []byte
	social *og.Service
	// Weak ETags of the non-hashed files, hashed once: the build never
	// changes under a running process.
	etags sync.Map
}

func (s *spa) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if p := strings.TrimPrefix(r.URL.Path, "/"); p != "" && p != "index.html" {
		if _, err := fs.Stat(s.dist, p); err == nil {
			// SvelteKit hashes everything under _app/immutable/ into its
			// filename, which is exactly what an immutable cache wants — the
			// same header chat and DM images already carry. Pinning these for
			// a year is only safe while the document naming them revalidates;
			// see the fallback below (#966).
			if strings.HasPrefix(r.URL.Path, immutablePrefix) {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			} else {
				// Everything else keeps its name across builds — favicon.png,
				// changelog.md — so it must be revalidated, not guessed at
				// (#966): the ETag is what http.ServeContent answers a 304 with.
				w.Header().Set("Cache-Control", "no-cache")
				if tag := s.etagOf(p); tag != "" {
					w.Header().Set("ETag", tag)
				}
			}
			s.files.ServeHTTP(w, r)
			return
		}
	}
	if s.index == nil {
		r.URL.Path = "/" // no frontend build embedded; keep the old 404-ish behavior
		s.files.ServeHTTP(w, r)
		return
	}
	// The document that names the current hashes has to be re-checked on
	// every visit. It went out with no directive and no validator, so a
	// browser was free to keep it — and once the hashes it names are
	// pinned for a year, a rider is stuck on that release until they hard
	// reload (#966). `no-cache` is "store it, but ask first", not "do not
	// store": the shell is a few KB and only it has to be revalidated. The
	// og meta varies by path, so the tag is over the bytes actually sent.
	body := s.social.Inject(s.index, r)
	tag := weakETag(body)
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("ETag", tag)
	if strings.Contains(r.Header.Get("If-None-Match"), tag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(body)
}

func (s *spa) etagOf(path string) string {
	if cached, ok := s.etags.Load(path); ok {
		if tag, ok := cached.(string); ok {
			return tag
		}
	}
	data, err := fs.ReadFile(s.dist, path)
	if err != nil {
		return ""
	}
	tag := weakETag(data)
	s.etags.Store(path, tag)
	return tag
}

func weakETag(b []byte) string {
	sum := sha256.Sum256(b)
	return `W/"` + hex.EncodeToString(sum[:8]) + `"`
}

// compressed gzips text responses for clients that ask, and leaves the rest
// alone: already-compressed types, range requests, and anything that is not
// a 200. ponytail: a gzip.Writer per request, default level; precompressing
// at build time is the upgrade if this ever shows in a profile.
func compressed(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") ||
			r.Header.Get("Range") != "" || !compressible(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Add("Vary", "Accept-Encoding")
		gw := &gzipResponse{ResponseWriter: w}
		next.ServeHTTP(gw, r)
		gw.close()
	})
}

// compressible is the build's text: scripts, styles, the shell, the
// changelog. An extensionless path is the SPA fallback, which is HTML.
func compressible(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case "", ".js", ".css", ".html", ".md", ".svg", ".json", ".txt", ".map", ".webmanifest":
		return true
	}
	return false
}

type gzipResponse struct {
	http.ResponseWriter
	gz          *gzip.Writer
	wroteHeader bool
}

func (g *gzipResponse) WriteHeader(code int) {
	if !g.wroteHeader {
		g.wroteHeader = true
		if code == http.StatusOK {
			h := g.Header()
			h.Del("Content-Length")
			h.Set("Content-Encoding", "gzip")
			g.gz = gzip.NewWriter(g.ResponseWriter)
		}
	}
	g.ResponseWriter.WriteHeader(code)
}

func (g *gzipResponse) Write(b []byte) (int, error) {
	if !g.wroteHeader {
		g.WriteHeader(http.StatusOK)
	}
	if g.gz != nil {
		return g.gz.Write(b)
	}
	return g.ResponseWriter.Write(b)
}

func (g *gzipResponse) close() {
	if g.gz != nil {
		_ = g.gz.Close()
	}
}
