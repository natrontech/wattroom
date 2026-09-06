// Package unfurl turns a link somebody pasted into a preview card (#866,
// ADR-0031). The browser cannot do it — almost nothing sends CORS headers to
// a page that is not its own — so the server fetches, and fetching a URL a
// stranger typed is an SSRF primitive. guard.go is the policy that makes it a
// bounded one; this file is the endpoint, the cache and the rider's ration.
//
// Nothing here is authoritative. A refused fetch, a timeout, a page with no
// metadata: all of them mean "no card", never an error the rider has to read.
// A dead preview costs nothing — the link still works.
package unfurl

import (
	"context"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// UserSource is the sign-in gate — the same shape rooms and dms consume.
// Previews are for members of the app (ADR-0009), not for the internet.
type UserSource interface {
	RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool)
}

const (
	// cacheTTL: a link pasted in a busy room is fetched once, not once per
	// reader. Long enough that a conversation about one article costs the
	// article one request; short enough that a fixed title fixes itself.
	cacheTTL = 30 * time.Minute
	// A miss for the same rider costs the third party one request, so the
	// ration is per rider and generous enough to load a screenful of chat.
	riderEvery   = 400 * time.Millisecond
	maxCacheKeys = 2048
	maxRiderKeys = 4096
)

type entry struct {
	card Card
	// ok=false is cached too: a page that offers nothing must not be re-asked
	// every time somebody scrolls past the line that links it.
	ok  bool
	exp time.Time
}

type Service struct {
	users  UserSource
	log    *slog.Logger
	client *http.Client

	mu      sync.Mutex
	cache   map[string]entry
	lastAsk map[string]time.Time
	now     func() time.Time
	// The ration's spacing, a field so a test can measure the cache and the
	// ration separately instead of one masking the other.
	every time.Duration
}

func New(users UserSource, log *slog.Logger) *Service {
	return &Service{
		users:   users,
		log:     log,
		client:  newClient(),
		cache:   map[string]entry{},
		lastAsk: map[string]time.Time{},
		now:     time.Now,
		every:   riderEvery,
	}
}

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/unfurl", s.handleUnfurl)
	mux.HandleFunc("GET /api/unfurl/image", s.handleImage)
}

// handleUnfurl answers with the card for one link, or 204 when there is
// nothing to draw. Never an error status for "that page had no metadata" —
// the client draws a card or it doesn't, and either is a normal outcome.
func (s *Service) handleUnfurl(w http.ResponseWriter, r *http.Request) {
	me, ok := s.users.RequireUser(w, r, "Sign in to see link previews.")
	if !ok {
		return
	}
	raw := r.URL.Query().Get("url")
	target, err := url.Parse(raw)
	if err != nil || checkURL(target) != nil {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"That is not a link WattRoom can preview.", "url")
		return
	}
	// The fragment is the reader's business, not the page's — dropping it
	// keeps one cache entry per page instead of one per anchor.
	target.Fragment = ""
	key := target.String()

	if cached, hit := s.cached(key); hit {
		s.respond(w, cached)
		return
	}
	if !s.allow(rationKey(me)) {
		// Ration spent. Not an error the rider should see as one: no card,
		// and their next scroll asks again.
		w.WriteHeader(http.StatusNoContent)
		return
	}
	card, found := s.fetch(r.Context(), key)
	s.remember(key, card, found)
	s.respond(w, entry{card: card, ok: found})
}

func (s *Service) respond(w http.ResponseWriter, e entry) {
	if !e.ok {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	// Per rider, not shared: the card is the same for everyone, but this
	// response rode their session and no cache in between should keep it.
	w.Header().Set("Cache-Control", "private, max-age=600")
	httpx.WriteJSON(w, http.StatusOK, e.card)
}

// fetch does the guarded GET and reads the head. Every failure is the same
// answer — no card — logged at debug because a link that does not unfurl is
// the ordinary case, not an incident.
func (s *Service) fetch(ctx context.Context, target string) (Card, bool) {
	ctx, cancel := context.WithTimeout(ctx, fetchTimeout)
	defer cancel()
	res, err := s.get(ctx, target)
	if err != nil {
		s.log.Debug("unfurl fetch", "err", err, "url", target)
		return Card{}, false
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode != http.StatusOK {
		return Card{}, false
	}
	if !isHTML(res.Header.Get("Content-Type")) {
		// A PDF or a zip has no Open Graph, and reading half a megabyte of it
		// to discover that would be the point of the cap.
		return Card{}, false
	}
	// res.Request.URL is where the redirect chain ended — the right base for
	// a relative og:image, and the right host to name on the card.
	card := parse(io.LimitReader(res.Body, maxHTMLBytes), res.Request.URL)
	if !card.Filled() {
		return Card{}, false
	}
	return card, true
}

// handleImage proxies a preview thumbnail through our own origin. A chat is
// a room full of other people's links, and an <img> straight at their hosts
// would hand every reader's address to each of them the moment the pane
// scrolls — the exposure media.ts already refuses for pasted GIFs.
//
// This is not a second SSRF surface: it dials through the same guard as the
// unfurl above, for the same signed-in riders, so it grants no reach the
// endpoint beside it does not already grant.
func (s *Service) handleImage(w http.ResponseWriter, r *http.Request) {
	me, ok := s.users.RequireUser(w, r, "Sign in to see link previews.")
	if !ok {
		return
	}
	target := r.URL.Query().Get("url")
	if u, err := url.Parse(target); err != nil || checkURL(u) != nil {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error", "That is not an image WattRoom can load.")
		return
	}
	if !s.allow(rationKey(me) + ":img") {
		httpx.WriteError(w, http.StatusTooManyRequests, "conflict", "Too many previews at once — give it a moment.")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), fetchTimeout)
	defer cancel()
	res, err := s.get(ctx, target)
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That preview image could not be loaded.")
		return
	}
	defer func() { _ = res.Body.Close() }()
	kind, _, _ := mime.ParseMediaType(res.Header.Get("Content-Type"))
	if res.StatusCode != http.StatusOK || !strings.HasPrefix(kind, "image/") {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That preview image could not be loaded.")
		return
	}
	w.Header().Set("Content-Type", kind)
	// Bytes from a stranger's host, served from our origin: a polyglot that
	// declares itself an image must never be re-read as HTML.
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	w.Header().Set("Cache-Control", "private, max-age=3600")
	// Truncating at the cap is deliberate: a half-drawn thumbnail is a better
	// outcome than an unbounded copy from a host that never stops sending.
	if _, err := io.Copy(w, io.LimitReader(res.Body, maxImageBytes)); err != nil {
		s.log.Debug("unfurl image copy", "err", err)
	}
}

func isHTML(contentType string) bool {
	kind, _, err := mime.ParseMediaType(contentType)
	if err != nil {
		// No Content-Type at all: old servers do this and are usually HTML.
		// The byte cap and the tokenizer make being wrong cheap.
		return contentType == ""
	}
	return kind == "text/html" || kind == "application/xhtml+xml"
}

// rationKey is the rider's ration key. Their id, never their name.
func rationKey(u db.User) string { return store.UUIDString(u.ID) }

func (s *Service) cached(key string) (entry, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.cache[key]
	if !ok || s.now().After(e.exp) {
		return entry{}, false
	}
	return e, true
}

func (s *Service) remember(key string, card Card, ok bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	// A bound, not an eviction policy: the map is a cache, and dropping all
	// of it costs one round of refetching. An LRU here would be machinery
	// for a map that holds titles.
	if len(s.cache) >= maxCacheKeys {
		s.cache = map[string]entry{}
	}
	s.cache[key] = entry{card: card, ok: ok, exp: s.now().Add(cacheTTL)}
}

// allow is the per-rider ration, same shape as the hub's input throttle:
// one ask per riderEvery, and the map is dropped rather than swept when it
// grows — every entry in it is a timestamp that expires in a moment anyway.
func (s *Service) allow(key string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	if now.Sub(s.lastAsk[key]) < s.every {
		return false
	}
	if len(s.lastAsk) >= maxRiderKeys {
		s.lastAsk = map[string]time.Time{}
	}
	s.lastAsk[key] = now
	return true
}
