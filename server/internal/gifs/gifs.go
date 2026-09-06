// Package gifs is the GIF picker's back half (#878, ADR-0032): a thin proxy
// in front of Tenor. It exists so the API key stays on the server and so one
// account cannot spend the whole key's quota; it stores nothing.
//
// What it hands back is deliberately narrow — a direct media URL on a host
// the chat client already renders inline (#279). Anything Tenor returns that
// the client would refuse to draw is dropped here rather than sent onward as
// a broken tile.
package gifs

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// Users is the sign-in gate. Searching is not room-scoped — the picker opens
// in a DM as readily as in a room — so an account is the whole requirement.
type Users interface {
	RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool)
}

const (
	// One screenful of the grid, and Tenor's own default.
	pageSize = 24
	// A search box, not an essay.
	maxQueryRunes = 100
	// Tenor's `next` cursor, echoed back on scroll. Bounded because it
	// reaches an outbound URL.
	maxCursorBytes = 200
	// The window and its ceiling. A debounced keystroke is one search, so
	// this is generous for a person and tight for a script.
	rateWindow = time.Minute
	rateLimit  = 40
)

// Direct-media hosts Tenor serves from, and the same set `gifUrl()` in
// web/src/lib/chat/media.ts renders inline. A result outside it is dropped:
// the grid would show a broken tile, and sending it would post a bare URL.
var tenorHosts = regexp.MustCompile(`^(media\d*|c)\.tenor\.com$`)

// Gif is one tile: what the grid draws, and what gets sent when it is picked.
type Gif struct {
	ID string `json:"id"`
	// The full-size GIF. Picking a tile posts exactly this string as the
	// message, which MessageText then renders as the GIF itself.
	URL string `json:"url"`
	// The small one the grid draws — a search is 24 of these at once.
	Preview string `json:"preview"`
	Width   int    `json:"width"`
	Height  int    `json:"height"`
	// Tenor's description, so the tile and the sent image have alt text.
	Alt string `json:"alt"`
}

type searchResponse struct {
	Results []Gif  `json:"results"`
	Next    string `json:"next,omitempty"`
}

type Service struct {
	users Users
	log   *slog.Logger
	key   string
	// Overridable for tests; the production value is set in New.
	apiBase string
	httpc   *http.Client
	now     func() time.Time

	mu     sync.Mutex
	recent map[string][]time.Time
}

// New returns nil when no Tenor key is configured, which leaves the route
// unmounted and `gifsEnabled` false on /api/me — the picker button never
// renders rather than 404ing on click (ux.md, capability gating).
func New(users Users, log *slog.Logger) *Service {
	key := os.Getenv("WATTROOM_TENOR_KEY")
	if key == "" {
		return nil
	}
	return &Service{
		users:   users,
		log:     log,
		key:     key,
		apiBase: "https://tenor.googleapis.com/v2",
		httpc:   &http.Client{Timeout: 10 * time.Second},
		now:     time.Now,
		recent:  map[string][]time.Time{},
	}
}

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/gifs", s.handleSearch)
}

// handleSearch answers both halves of the picker: a query searches, no query
// returns what Tenor is featuring — the grid has something in it before the
// rider types, because mid-ride they will not (ux.md).
func (s *Service) handleSearch(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Sign in to search GIFs.")
	if !ok {
		return
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if utf8.RuneCountInString(query) > maxQueryRunes {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"That search is too long.", "q")
		return
	}
	cursor := r.URL.Query().Get("pos")
	if len(cursor) > maxCursorBytes {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error",
			"That is not a page of results.")
		return
	}
	if !s.allow(store.UUIDString(user.ID)) {
		httpx.WriteError(w, http.StatusTooManyRequests, "rate_limited",
			"That is a lot of GIF searching. Wait a moment, then try again.")
		return
	}
	results, next, err := s.fetch(r.Context(), query, cursor)
	if err != nil {
		s.log.Warn("tenor search failed", "err", err, "query", query)
		httpx.WriteError(w, http.StatusServiceUnavailable, "rate_limited",
			"GIF search is not answering right now. Try again in a moment.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, searchResponse{Results: results, Next: next})
}

// allow is the per-account ceiling on outbound calls: one key pays for every
// rider, so one rider must not be able to empty it.
//
// ponytail: one mutex over a map of hit times. This guards an outbound HTTP
// call, not a hot path — per-account buckets if it ever becomes one.
func (s *Service) allow(userID string) bool {
	now := s.now()
	cutoff := now.Add(-rateWindow)
	s.mu.Lock()
	defer s.mu.Unlock()
	// Accounts that searched once and left would otherwise sit here forever.
	if len(s.recent) > 1000 {
		for id, hits := range s.recent {
			if len(trim(hits, cutoff)) == 0 {
				delete(s.recent, id)
			}
		}
	}
	hits := trim(s.recent[userID], cutoff)
	if len(hits) >= rateLimit {
		s.recent[userID] = hits
		return false
	}
	s.recent[userID] = append(hits, now)
	return true
}

// trim drops the hits that have aged out. The slice is time-ordered, so the
// survivors are always a suffix.
func trim(hits []time.Time, cutoff time.Time) []time.Time {
	for i, at := range hits {
		if at.After(cutoff) {
			return hits[i:]
		}
	}
	return nil
}

// tenorResponse is the sliver of Tenor's v2 payload the picker needs.
type tenorResponse struct {
	Results []struct {
		ID                 string `json:"id"`
		ContentDescription string `json:"content_description"`
		MediaFormats       map[string]struct {
			URL  string `json:"url"`
			Dims []int  `json:"dims"`
		} `json:"media_formats"`
	} `json:"results"`
	Next string `json:"next"`
}

func (s *Service) fetch(ctx context.Context, query, cursor string) ([]Gif, string, error) {
	endpoint := "/featured"
	params := url.Values{
		"key":        {s.key},
		"client_key": {"wattroom"},
		"limit":      {strconv.Itoa(pageSize)},
		// Hard-coded, not a room setting: 95% of riders want the same answer
		// and the other 5% are not a preference we want to offer (ux.md).
		"contentfilter": {"high"},
		"media_filter":  {"gif,tinygif"},
	}
	if query != "" {
		endpoint = "/search"
		params.Set("q", query)
	}
	if cursor != "" {
		params.Set("pos", cursor)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.apiBase+endpoint+"?"+params.Encode(), nil)
	if err != nil {
		return nil, "", err
	}
	resp, err := s.httpc.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("tenor: %s", resp.Status)
	}
	var body tenorResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&body); err != nil {
		return nil, "", fmt.Errorf("decode: %w", err)
	}
	results := make([]Gif, 0, len(body.Results))
	for _, result := range body.Results {
		full, ok := renderable(result.MediaFormats["gif"].URL)
		if !ok {
			continue
		}
		preview, ok := renderable(result.MediaFormats["tinygif"].URL)
		if !ok {
			preview = full
		}
		dims := result.MediaFormats["tinygif"].Dims
		gif := Gif{ID: result.ID, URL: full, Preview: preview, Alt: result.ContentDescription}
		if len(dims) == 2 {
			gif.Width, gif.Height = dims[0], dims[1]
		}
		results = append(results, gif)
	}
	return results, body.Next, nil
}

// renderable keeps the proxy honest: only an HTTPS direct-media URL on a
// Tenor host, which is exactly what the client agrees to draw.
func renderable(raw string) (string, bool) {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || !tenorHosts.MatchString(parsed.Host) {
		return "", false
	}
	if !strings.HasSuffix(parsed.Path, ".gif") && !strings.HasSuffix(parsed.Path, ".webp") {
		return "", false
	}
	return parsed.String(), true
}
