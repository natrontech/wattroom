// Package gifs is the GIF picker's back half (#878, ADR-0032 amended by #909):
// a thin proxy in front of Giphy. It exists so the API key stays on the server,
// so the key's SHARED quota survives a room full of riders, and so nothing the
// grid draws is a host the chat client would refuse to render. It stores
// nothing durable — the cache below is a quota measure, not a record.
//
// It spoke to Tenor until Google shut that API off on 30 June 2026 (#909).
// The shape survived the move; fetch and the response struct did not.
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
	// One screenful of the grid. Giphy allows up to 50.
	pageSize = 24
	// Giphy's own cap on q. Bounded here so an over-long search is a 400 with
	// a reason rather than an opaque upstream refusal.
	maxQueryRunes = 50
	// Giphy's cap on offset.
	maxOffset = 4999

	// Two ceilings, because the thing being rationed is not the rider.
	//
	// A Giphy key is rated for the SERVER: roughly 42 searches an hour and
	// 1000 a day shared by everyone behind it, and a production key needs
	// Giphy's approval. So keyLimit protects the budget, and rateLimit stops
	// one account being the reason it ran out. Both count upstream calls
	// only — a cache hit is free and is charged to nobody.
	keyWindow  = time.Hour
	keyLimit   = 30
	rateWindow = time.Minute
	rateLimit  = 15

	// Trending is the same answer for every rider and is what every
	// picker-open asks for first, so caching it is most of the saving.
	cacheTTL     = 10 * time.Minute
	cacheEntries = 200
)

// Direct-media hosts Giphy serves from, and the same set `gifUrl()` in
// web/src/lib/chat/media.ts renders inline. A result outside it is dropped:
// the grid would show a broken tile, and sending it would post a bare URL.
var giphyHosts = regexp.MustCompile(`^(media\d*|i)\.giphy\.com$`)

// Gif is one tile: what the grid draws, and what gets sent when it is picked.
type Gif struct {
	ID string `json:"id"`
	// The GIF as sent. Picking a tile posts exactly this string as the
	// message, which MessageText then renders as the GIF itself.
	URL string `json:"url"`
	// The small one the grid draws — a search is 24 of these at once.
	Preview string `json:"preview"`
	Width   int    `json:"width"`
	Height  int    `json:"height"`
	// Giphy's own description, so the tile and the sent image have alt text.
	Alt string `json:"alt"`
}

type searchResponse struct {
	Results []Gif `json:"results"`
	// The next page's offset, as an opaque string the client echoes back.
	// Absent when the results ran out.
	Next string `json:"next,omitempty"`
}

type cached struct {
	page searchResponse
	at   time.Time
}

type Service struct {
	users Users
	log   *slog.Logger
	key   string
	// Overridable for tests; the production value is set in New.
	apiBase string
	httpc   *http.Client
	now     func() time.Time

	// One mutex over both ceilings and the cache: they are read together on
	// every request, and this guards an outbound call, never a hot path.
	mu       sync.Mutex
	recent   map[string][]time.Time
	upstream []time.Time
	cache    map[string]cached
}

// New returns nil when no Giphy key is configured, which leaves the route
// unmounted and `gifsEnabled` false on /api/me — the picker button never
// renders rather than 404ing on click (ux.md, capability gating).
func New(users Users, log *slog.Logger) *Service {
	key := os.Getenv("WATTROOM_GIPHY_KEY")
	if key == "" {
		return nil
	}
	return &Service{
		users:   users,
		log:     log,
		key:     key,
		apiBase: "https://api.giphy.com/v1/gifs",
		httpc:   &http.Client{Timeout: 10 * time.Second},
		now:     time.Now,
		recent:  map[string][]time.Time{},
		cache:   map[string]cached{},
	}
}

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/gifs", s.handleSearch)
}

// handleSearch answers both halves of the picker: a query searches, no query
// returns what is trending — the grid has something in it before the rider
// types, because mid-ride they will not (ux.md).
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
	offset := 0
	if raw := r.URL.Query().Get("pos"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 0 || parsed > maxOffset {
			httpx.WriteError(w, http.StatusBadRequest, "validation_error",
				"That is not a page of results.")
			return
		}
		offset = parsed
	}

	// The cache answers before either ceiling is consulted: a page somebody
	// already paid for costs nothing to serve again.
	cacheKey := query + "\x00" + strconv.Itoa(offset)
	if page, ok := s.cachedPage(cacheKey); ok {
		httpx.WriteJSON(w, http.StatusOK, page)
		return
	}
	switch s.spend(store.UUIDString(user.ID)) {
	case refusedAccount:
		httpx.WriteError(w, http.StatusTooManyRequests, "rate_limited",
			"That is a lot of GIF searching. Wait a moment, then try again.")
		return
	case refusedKey:
		// Not this rider's doing, and not a refusal of their input — the
		// server's shared GIF budget is spent. The advice is the same.
		httpx.WriteError(w, http.StatusServiceUnavailable, "rate_limited",
			"GIF search is busy right now. Try again in a few minutes.")
		return
	}

	page, err := s.fetch(r.Context(), query, offset)
	if err != nil {
		s.log.Warn("giphy search failed", "err", err, "query", query)
		httpx.WriteError(w, http.StatusServiceUnavailable, "rate_limited",
			"GIF search is not answering right now. Try again in a moment.")
		return
	}
	s.remember(cacheKey, page)
	httpx.WriteJSON(w, http.StatusOK, page)
}

func (s *Service) cachedPage(key string) (searchResponse, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.cache[key]
	if !ok || s.now().Sub(entry.at) > cacheTTL {
		return searchResponse{}, false
	}
	return entry.page, true
}

func (s *Service) remember(key string, page searchResponse) {
	s.mu.Lock()
	defer s.mu.Unlock()
	// ponytail: no LRU — when it fills, drop what has already expired, and
	// failing that the whole map. A cold cache costs one upstream call, and
	// an entry is one page of tile metadata.
	if len(s.cache) >= cacheEntries {
		for k, entry := range s.cache {
			if s.now().Sub(entry.at) > cacheTTL {
				delete(s.cache, k)
			}
		}
		if len(s.cache) >= cacheEntries {
			s.cache = map[string]cached{}
		}
	}
	s.cache[key] = cached{page: page, at: s.now()}
}

type refusal int

const (
	allowed refusal = iota
	refusedAccount
	refusedKey
)

// spend charges one upstream call against both ceilings, or refuses and
// charges nothing. Cache hits never reach here.
func (s *Service) spend(userID string) refusal {
	now := s.now()
	s.mu.Lock()
	defer s.mu.Unlock()
	// Accounts that searched once and left would otherwise sit here forever.
	if len(s.recent) > 1000 {
		for id, hits := range s.recent {
			if len(trim(hits, now.Add(-rateWindow))) == 0 {
				delete(s.recent, id)
			}
		}
	}
	mine := trim(s.recent[userID], now.Add(-rateWindow))
	s.recent[userID] = mine
	if len(mine) >= rateLimit {
		return refusedAccount
	}
	s.upstream = trim(s.upstream, now.Add(-keyWindow))
	if len(s.upstream) >= keyLimit {
		return refusedKey
	}
	s.recent[userID] = append(mine, now)
	s.upstream = append(s.upstream, now)
	return allowed
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

// giphyImage is one rendition. The dimensions arrive as strings, which is why
// they are not ints here.
type giphyImage struct {
	URL    string `json:"url"`
	Width  string `json:"width"`
	Height string `json:"height"`
}

// giphyResponse is the sliver of Giphy's v1 payload the picker needs.
type giphyResponse struct {
	Data []struct {
		ID      string                `json:"id"`
		Title   string                `json:"title"`
		AltText string                `json:"alt_text"`
		Images  map[string]giphyImage `json:"images"`
	} `json:"data"`
	Pagination struct {
		Count  int `json:"count"`
		Offset int `json:"offset"`
	} `json:"pagination"`
}

func (s *Service) fetch(ctx context.Context, query string, offset int) (searchResponse, error) {
	endpoint := "/trending"
	params := url.Values{
		"api_key": {s.key},
		"limit":   {strconv.Itoa(pageSize)},
		"offset":  {strconv.Itoa(offset)},
		// Giphy's strictest rating. Hard-coded, not a room setting: 95% of
		// riders want the same answer, and the other 5% are not a preference
		// worth offering (ux.md).
		"rating": {"g"},
	}
	if query != "" {
		endpoint = "/search"
		params.Set("q", query)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.apiBase+endpoint+"?"+params.Encode(), nil)
	if err != nil {
		return searchResponse{}, err
	}
	resp, err := s.httpc.Do(req)
	if err != nil {
		return searchResponse{}, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return searchResponse{}, fmt.Errorf("giphy: %s", resp.Status)
	}
	var body giphyResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&body); err != nil {
		return searchResponse{}, fmt.Errorf("decode: %w", err)
	}

	page := searchResponse{Results: make([]Gif, 0, len(body.Data))}
	for _, item := range body.Data {
		// downsized is Giphy's "big enough to look at, small enough to send";
		// original runs to many megabytes and is the last resort.
		sent, ok := pick(item.Images, "downsized", "fixed_width", "original")
		if !ok {
			continue
		}
		preview, ok := pick(item.Images, "fixed_width", "fixed_width_small", "downsized")
		if !ok {
			preview = sent
		}
		alt := item.AltText
		if alt == "" {
			alt = item.Title
		}
		width, _ := strconv.Atoi(preview.Width)
		height, _ := strconv.Atoi(preview.Height)
		page.Results = append(page.Results, Gif{
			ID: item.ID, URL: sent.URL, Preview: preview.URL,
			Width: width, Height: height, Alt: alt,
		})
	}
	// A short page is the last one. total_count is unreliable on trending, so
	// the page's own size is the signal.
	if body.Pagination.Count >= pageSize && offset+pageSize <= maxOffset {
		page.Next = strconv.Itoa(offset + pageSize)
	}
	return page, nil
}

// pick returns the first named rendition the client would agree to draw.
func pick(images map[string]giphyImage, names ...string) (giphyImage, bool) {
	for _, name := range names {
		image, ok := images[name]
		if !ok {
			continue
		}
		if clean, ok := renderable(image.URL); ok {
			image.URL = clean
			return image, true
		}
	}
	return giphyImage{}, false
}

// renderable keeps the proxy honest: only an HTTPS direct-media URL on a
// Giphy host, which is exactly what the client agrees to draw.
func renderable(raw string) (string, bool) {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || !giphyHosts.MatchString(parsed.Host) {
		return "", false
	}
	if !strings.HasSuffix(parsed.Path, ".gif") && !strings.HasSuffix(parsed.Path, ".webp") {
		return "", false
	}
	return parsed.String(), true
}
