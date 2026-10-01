// Package intervals pulls a rider's planned workouts from intervals.icu
// (#2327, decided 2026-09-29): one OAuth round trip scoped CALENDAR:READ,
// the next seven days of planned workouts as .zwo, and the token dropped the
// moment they are read. Nothing is stored. The workouts wait in memory for
// the browser that asked, which converts and previews each one with the .zwo
// importer it already has, and saves through POST /api/workouts.
//
// CALENDAR:READ reaches planned workouts and nothing else, so "never
// activities" — on most accounts synced from Strava, which no fixture or AI
// context may hold (AGENTS.md) — is the token's own limit, not our care.
package intervals

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/oauth2"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

const (
	scope       = "CALENDAR:READ"
	stateCookie = "wattroom_intervals_state"
	// The consent page's round trip, and how long a pull waits to be opened.
	stateTTL = 10 * time.Minute
	pullTTL  = 10 * time.Minute
	// "The next 7 days of planned workouts" (#2327).
	days = 7
	// A week holds a handful; past this the rest is counted, not carried.
	maxWorkouts = 50
	// The importer's own ceiling (MAX_IMPORT_BYTES): a file the page would
	// refuse is left out here and said, rather than sent to be refused.
	maxFileBytes = 1 << 20
	maxBodyBytes = 16 << 20
	// intervals.icu wants the code exchanged within two minutes; the whole
	// callback gets a fraction of that.
	callTimeout = 20 * time.Second
	defaultAPI  = "https://intervals.icu"
	importPage  = "/workouts/import?intervals="
)

// UserSource resolves the signed-in rider — the shape every service takes.
type UserSource interface {
	RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool)
}

// Planned is one planned workout as the browser gets it: the .zwo intervals.icu
// wrote, for the importer to convert and say what it could not carry.
type Planned struct {
	Name string `json:"name"`
	Date string `json:"date"`
	Zwo  string `json:"zwo"`
}

// pulled is one pull waiting for its browser: whose it is and until when.
type pulled struct {
	user     pgtype.UUID
	until    time.Time
	workouts []Planned
	skipped  int
}

// Service is the pull. A nil cfg is a server with no intervals.icu client
// configured: the web hides the button, and the routes say so.
type Service struct {
	users  UserSource
	log    *slog.Logger
	cfg    *oauth2.Config
	api    string
	secure bool
	client *http.Client
	now    func() time.Time

	mu    sync.Mutex
	pulls map[string]pulled
}

// New reads the client from WATTROOM_OAUTH_INTERVALS_ID and _SECRET, like
// the sign-in providers; registering it with intervals.icu is the operator's.
func New(users UserSource, log *slog.Logger, baseURL string) *Service {
	return newService(users, log, baseURL, defaultAPI,
		os.Getenv("WATTROOM_OAUTH_INTERVALS_ID"), os.Getenv("WATTROOM_OAUTH_INTERVALS_SECRET"))
}

func newService(users UserSource, log *slog.Logger, baseURL, api, id, secret string) *Service {
	s := &Service{
		users:  users,
		log:    log,
		api:    api,
		secure: strings.HasPrefix(baseURL, "https://"),
		client: &http.Client{Timeout: callTimeout},
		now:    time.Now,
		pulls:  map[string]pulled{},
	}
	if id != "" && secret != "" {
		s.cfg = &oauth2.Config{
			ClientID:     id,
			ClientSecret: secret,
			RedirectURL:  baseURL + "/api/intervals/callback",
			Scopes:       []string{scope},
			Endpoint: oauth2.Endpoint{
				AuthURL:   api + "/oauth/authorize",
				TokenURL:  api + "/api/oauth/token",
				AuthStyle: oauth2.AuthStyleInParams,
			},
		}
	}
	return s
}

// Register mounts the pull's routes.
func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/intervals", s.handleAvailable)
	mux.HandleFunc("GET /api/intervals/start", s.handleStart)
	mux.HandleFunc("GET /api/intervals/callback", s.handleCallback)
	mux.HandleFunc("GET /api/intervals/pulls/{id}", s.handlePull)
}

// handleAvailable is the capability the import page gates its button on.
func (s *Service) handleAvailable(w http.ResponseWriter, _ *http.Request) {
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"available": s.cfg != nil})
}

func (s *Service) notConfigured(w http.ResponseWriter) {
	httpx.WriteError(w, http.StatusNotFound, "not_found",
		"intervals.icu is not set up on this server.")
}

// handleStart sends the rider to intervals.icu's consent page.
func (s *Service) handleStart(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.users.RequireUser(w, r, "Sign in to pull your planned workouts."); !ok {
		return
	}
	if s.cfg == nil {
		s.notConfigured(w)
		return
	}
	state := randomToken()
	s.cookie(w, state, stateTTL)
	http.Redirect(w, r, s.cfg.AuthCodeURL(state), http.StatusFound)
}

// handleCallback is where intervals.icu sends the rider back: exchange, read
// the week, drop the token, and hand the workouts to the import page. Every
// outcome lands there, since the rider arrives by navigation, not by fetch.
func (s *Service) handleCallback(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Sign in to pull your planned workouts.")
	if !ok {
		return
	}
	if s.cfg == nil {
		s.notConfigured(w)
		return
	}
	query := r.URL.Query()
	cookie, err := r.Cookie(stateCookie)
	s.cookie(w, "", -time.Second)
	// The state proves this callback belongs to a pull this browser started.
	if err != nil || subtle.ConstantTimeCompare([]byte(query.Get("state")), []byte(cookie.Value)) != 1 {
		http.Redirect(w, r, importPage+"expired", http.StatusFound)
		return
	}
	if query.Get("error") != "" || query.Get("code") == "" {
		http.Redirect(w, r, importPage+"denied", http.StatusFound)
		return
	}
	workouts, skipped, err := s.fetch(r.Context(), query.Get("code"))
	if err != nil {
		s.log.Error("intervals: pull failed", "err", err)
		http.Redirect(w, r, importPage+"failed", http.StatusFound)
		return
	}
	id := randomToken()
	s.keep(id, pulled{user: user.ID, until: s.now().Add(pullTTL), workouts: workouts, skipped: skipped})
	http.Redirect(w, r, importPage+id, http.StatusFound)
}

// handlePull gives a waiting pull to its rider, once.
func (s *Service) handlePull(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Sign in to open your pull.")
	if !ok {
		return
	}
	s.mu.Lock()
	p, found := s.pulls[r.PathValue("id")]
	if found && p.user == user.ID {
		delete(s.pulls, r.PathValue("id"))
	}
	s.mu.Unlock()
	if !found || p.user != user.ID || s.now().After(p.until) {
		httpx.WriteError(w, http.StatusNotFound, "not_found",
			"That pull has expired or was already opened. Pull again.")
		return
	}
	workouts := p.workouts
	if workouts == nil {
		workouts = []Planned{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"workouts": workouts, "skipped": p.skipped})
}

// keep holds a pull for its rider: one at a time each, and nothing expired.
func (s *Service) keep(id string, p pulled) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	for other, q := range s.pulls {
		if q.user == p.user || now.After(q.until) {
			delete(s.pulls, other)
		}
	}
	s.pulls[id] = p
}

// fetch exchanges the code and reads the week's planned workouts as .zwo.
// The token is a local: when this returns, nothing holds it.
func (s *Service) fetch(ctx context.Context, code string) ([]Planned, int, error) {
	ctx, cancel := context.WithTimeout(ctx, callTimeout)
	defer cancel()
	tok, err := s.cfg.Exchange(context.WithValue(ctx, oauth2.HTTPClient, s.client), code)
	if err != nil {
		return nil, 0, fmt.Errorf("intervals: exchange: %w", err)
	}
	today := s.now()
	query := url.Values{
		"category": {"WORKOUT"},
		"ext":      {"zwo"},
		"oldest":   {today.Format(time.DateOnly)},
		"newest":   {today.AddDate(0, 0, days-1).Format(time.DateOnly)},
	}
	// Athlete 0 is the token's own athlete.
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		s.api+"/api/v1/athlete/0/events?"+query.Encode(), nil)
	if err != nil {
		return nil, 0, fmt.Errorf("intervals: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+tok.AccessToken)
	res, err := s.client.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("intervals: events: %w", err)
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode != http.StatusOK {
		return nil, 0, fmt.Errorf("intervals: events returned %d", res.StatusCode)
	}
	var events []struct {
		Name  string `json:"name"`
		Start string `json:"start_date_local"`
		File  string `json:"workout_file_base64"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, maxBodyBytes)).Decode(&events); err != nil {
		return nil, 0, fmt.Errorf("intervals: decode events: %w", err)
	}
	workouts := []Planned{}
	skipped := 0
	for _, e := range events {
		file, err := base64.StdEncoding.DecodeString(e.File)
		if e.File == "" || err != nil || len(file) > maxFileBytes || len(workouts) == maxWorkouts {
			skipped++
			continue
		}
		workouts = append(workouts, Planned{Name: e.Name, Date: dateOf(e.Start), Zwo: string(file)})
	}
	return workouts, skipped, nil
}

// dateOf is the day part of intervals.icu's local timestamp.
func dateOf(start string) string {
	if len(start) >= len(time.DateOnly) {
		return start[:len(time.DateOnly)]
	}
	return start
}

func (s *Service) cookie(w http.ResponseWriter, value string, ttl time.Duration) {
	// gosec can't see through s.secure: false only on plain-http localhost,
	// which cannot carry a Secure cookie at all.
	http.SetCookie(w, &http.Cookie{ //nolint:gosec // Secure is conditional on the deploy scheme, HttpOnly+Lax always set
		Name: stateCookie, Value: value, Path: "/api/intervals",
		MaxAge: int(ttl.Seconds()), HttpOnly: true,
		Secure: s.secure, SameSite: http.SameSiteLaxMode,
	})
}

func randomToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b) // crypto/rand never fails on a supported platform (Go 1.24+)
	return base64.RawURLEncoding.EncodeToString(b)
}
