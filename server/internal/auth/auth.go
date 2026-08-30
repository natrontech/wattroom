// Package auth is OAuth sign-in (Google, GitHub, Strava) and sessions (#16).
//
// golang.org/x/oauth2 and stdlib, no framework. There is deliberately no
// password path anywhere in this package — the three providers are the entire
// credential story (WATTROOM.md).
//
// Sessions are server-side rows: the cookie carries 32 random bytes, the
// database only their SHA-256, so a leaked table cannot mint cookies and a
// session can be revoked by deleting a row. CSRF: the session cookie is
// SameSite=Lax, and every mutating endpoint additionally rejects a mismatched
// Origin header — Lax covers navigations, the Origin check covers everything
// a hostile page can still send.
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/oauth2"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/stats"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

const (
	sessionCookie = "wattroom_session"
	stateCookie   = "wattroom_oauth_state"
	sessionTTL    = 30 * 24 * time.Hour
	stateTTL      = 10 * time.Minute
)

type Service struct {
	store     *store.Store
	log       *slog.Logger
	providers map[string]provider
	// secure=false only for plain-http localhost; cookies are Secure otherwise.
	secure bool
}

// New reads provider credentials from WATTROOM_OAUTH_{GOOGLE,GITHUB,STRAVA}_{ID,SECRET}.
// baseURL is the public origin for OAuth callbacks (WATTROOM_BASE_URL).
func New(st *store.Store, log *slog.Logger, baseURL string, secure bool) *Service {
	svc := &Service{
		store:     st,
		log:       log,
		providers: providersFromEnv(baseURL),
		secure:    secure,
	}
	if _, ok := svc.providers["dev"]; ok {
		log.Warn("WATTROOM_DEV_LOGIN is enabled — anyone reaching this server can sign in as Dev Rider")
	}
	return svc
}

// Register mounts every auth route on mux.
func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/auth/providers", s.handleProviders)
	mux.HandleFunc("GET /api/auth/{provider}/start", s.handleStart)
	mux.HandleFunc("GET /api/auth/{provider}/callback", s.handleCallback)
	mux.HandleFunc("POST /api/auth/synthetic", s.handleSynthetic)
	mux.HandleFunc("POST /api/auth/logout", s.handleLogout)
	mux.HandleFunc("GET /api/me", s.handleMe)
	mux.HandleFunc("PATCH /api/me", s.handleUpdateMe)
}

// handleProviders lists configured provider ids, so the web renders sign-in
// buttons only for what will actually work (capability gating).
func (s *Service) handleProviders(w http.ResponseWriter, _ *http.Request) {
	ids := make([]string, 0, len(s.providers))
	for _, id := range []string{"google", "github", "strava", "dev"} {
		if _, ok := s.providers[id]; ok {
			ids = append(ids, id)
		}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"providers": ids})
}

func (s *Service) handleStart(w http.ResponseWriter, r *http.Request) {
	p, ok := s.providers[r.PathValue("provider")]
	if !ok {
		httpx.WriteError(w, http.StatusNotFound, "not_found",
			"That sign-in provider is not configured on this server.")
		return
	}
	// The dev provider skips OAuth entirely; same identity + session machinery.
	if p.id == "dev" {
		user, err := s.upsert(r, p, identity{ProviderUserID: "local-dev", DisplayName: "Dev Rider"}, &oauth2.Token{})
		if err == nil {
			err = s.startSession(w, r, user.ID)
		}
		if err != nil {
			s.log.Error("dev login failed", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Dev login failed. Check the server log.")
			return
		}
		http.Redirect(w, r, "/", http.StatusFound)
		return
	}

	state := randomToken()
	s.setCookie(w, stateCookie, state, stateTTL)
	http.Redirect(w, r, p.config.AuthCodeURL(state), http.StatusFound)
}

// handleSynthetic trades WATTROOM_SYNTHETIC_TOKEN for a session, so the
// production ride monitor can enter like a rider without a browser doing OAuth
// (#153). It is POST-only and bearer-authenticated: a GET would let a link log
// something in, and cookie-CSRF does not apply to a request that must carry a
// secret the attacker cannot read.
//
// Deliberately absent from /api/auth/providers — this is not a button, and no
// human should ever see it offered.
func (s *Service) handleSynthetic(w http.ResponseWriter, r *http.Request) {
	p, ok := s.providers["synthetic"]
	if !ok {
		httpx.WriteError(w, http.StatusNotFound, "not_found",
			"Synthetic sign-in is not configured on this server.")
		return
	}
	want := os.Getenv("WATTROOM_SYNTHETIC_TOKEN")
	got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	// Constant time: a timing oracle on a long-lived credential is worth closing.
	if len(got) == 0 || subtle.ConstantTimeCompare([]byte(got), []byte(want)) != 1 {
		s.log.Warn("synthetic sign-in rejected", "remote", r.RemoteAddr)
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized",
			"That token is not valid for synthetic sign-in.")
		return
	}
	user, err := s.upsert(r, p, identity{
		ProviderUserID: "synthetic-monitor",
		DisplayName:    "Synthetic Monitor",
	}, &oauth2.Token{})
	if err == nil {
		err = s.startSession(w, r, user.ID)
	}
	if err != nil {
		s.log.Error("synthetic sign-in failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"Synthetic sign-in failed. Check the server log.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) handleCallback(w http.ResponseWriter, r *http.Request) {
	p, ok := s.providers[r.PathValue("provider")]
	if !ok {
		httpx.WriteError(w, http.StatusNotFound, "not_found",
			"That sign-in provider is not configured on this server.")
		return
	}

	// The state cookie proves this callback belongs to a flow we started in
	// this browser; without it any link could complete a login (login CSRF).
	cookie, err := r.Cookie(stateCookie)
	if err != nil || cookie.Value == "" || r.URL.Query().Get("state") != cookie.Value {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request",
			"This sign-in link is stale or was not started here. Start again from the sign-in page.")
		return
	}
	s.clearCookie(w, stateCookie)

	ctx := r.Context()
	tok, err := p.config.Exchange(ctx, r.URL.Query().Get("code"))
	if err != nil {
		s.log.Warn("oauth exchange failed", "provider", p.id, "err", err)
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request",
			"The provider rejected this sign-in. Start again from the sign-in page.")
		return
	}
	ident, err := p.fetch(ctx, p.config, tok)
	if err != nil {
		s.log.Error("identity fetch failed", "provider", p.id, "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"Signing in worked but reading your profile did not. Try again.")
		return
	}

	user, err := s.upsert(r, p, ident, tok)
	if err != nil {
		s.log.Error("identity upsert failed", "provider", p.id, "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"Your account could not be created. Try again.")
		return
	}

	if err := s.startSession(w, r, user.ID); err != nil {
		s.log.Error("session create failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"Signed in, but the session could not be saved. Try again.")
		return
	}
	http.Redirect(w, r, "/", http.StatusFound)
}

// upsert finds or creates the user behind an identity. First sign-in creates
// the account; every later one just refreshes Strava's stored grant.
func (s *Service) upsert(r *http.Request, p provider, ident identity, tok *oauth2.Token) (db.User, error) {
	ctx := r.Context()
	q := s.store.Queries

	existing, err := q.GetIdentity(ctx, db.GetIdentityParams{
		Provider: p.id, ProviderUserID: ident.ProviderUserID,
	})
	switch {
	case err == nil:
		if p.keepTokens {
			if err := q.UpdateIdentityTokens(ctx, tokenParams(p, ident, tok)); err != nil {
				return db.User{}, err
			}
		}
		return q.GetUser(ctx, existing.UserID)
	case errors.Is(err, pgx.ErrNoRows):
		// fall through to create
	default:
		return db.User{}, err
	}

	name := ident.DisplayName
	if name == "" {
		name = "Rider"
	}
	var avatar *string
	if ident.AvatarURL != "" {
		avatar = &ident.AvatarURL
	}
	user, err := q.CreateUser(ctx, db.CreateUserParams{
		DisplayName: name, AvatarUrl: avatar, FtpWatts: 200, WeightKg: 75,
	})
	if err != nil {
		return db.User{}, err
	}
	create := db.CreateIdentityParams{
		Provider: p.id, ProviderUserID: ident.ProviderUserID, UserID: user.ID,
	}
	if p.keepTokens {
		tp := tokenParams(p, ident, tok)
		create.AccessToken, create.RefreshToken, create.TokenExpiresAt =
			tp.AccessToken, tp.RefreshToken, tp.TokenExpiresAt
	}
	if err := q.CreateIdentity(ctx, create); err != nil {
		// Two callbacks for the same identity can race past the earlier lookup
		// (parallel e2e workers found this; a double-clicked OAuth redirect
		// does the same). The loser adopts the winner's user; its own orphan
		// user row is removed so the race leaves no residue.
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			winner, lookupErr := q.GetIdentity(ctx, db.GetIdentityParams{
				Provider: p.id, ProviderUserID: ident.ProviderUserID,
			})
			if lookupErr != nil {
				return db.User{}, lookupErr
			}
			_ = q.DeleteUser(ctx, user.ID)
			return q.GetUser(ctx, winner.UserID)
		}
		return db.User{}, err
	}
	return user, nil
}

func tokenParams(p provider, ident identity, tok *oauth2.Token) db.UpdateIdentityTokensParams {
	expiry := pgtype.Timestamptz{Time: tok.Expiry, Valid: !tok.Expiry.IsZero()}
	access, refresh := tok.AccessToken, tok.RefreshToken
	return db.UpdateIdentityTokensParams{
		Provider: p.id, ProviderUserID: ident.ProviderUserID,
		AccessToken: &access, RefreshToken: &refresh, TokenExpiresAt: expiry,
	}
}

// --- sessions ---

func (s *Service) startSession(w http.ResponseWriter, r *http.Request, userID pgtype.UUID) error {
	token := randomToken()
	err := s.store.Queries.CreateSession(r.Context(), db.CreateSessionParams{
		TokenHash: hash(token),
		UserID:    userID,
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(sessionTTL), Valid: true},
	})
	if err != nil {
		return err
	}
	s.setCookie(w, sessionCookie, token, sessionTTL)
	return nil
}

// User resolves the session cookie to the signed-in user. The zero-trust
// version of "middleware" — handlers call it where they need it.
func (s *Service) User(r *http.Request) (db.User, bool) {
	cookie, err := r.Cookie(sessionCookie)
	if err != nil || cookie.Value == "" {
		return db.User{}, false
	}
	user, err := s.store.Queries.GetSessionUser(r.Context(), hash(cookie.Value))
	if err != nil {
		return db.User{}, false
	}
	return user, true
}

func (s *Service) handleLogout(w http.ResponseWriter, r *http.Request) {
	if !s.sameOrigin(r) {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "Cross-origin request refused.")
		return
	}
	if cookie, err := r.Cookie(sessionCookie); err == nil && cookie.Value != "" {
		_ = s.store.Queries.DeleteSession(r.Context(), hash(cookie.Value))
	}
	s.clearCookie(w, sessionCookie)
	w.WriteHeader(http.StatusNoContent)
}

// --- profile ---

type meResponse struct {
	ID          string  `json:"id"`
	DisplayName string  `json:"displayName"`
	AvatarURL   *string `json:"avatarUrl,omitempty"`
	FtpWatts    int16   `json:"ftpWatts"`
	WeightKg    int16   `json:"weightKg"`
	// The FTP auto-detect prompt (#26): filled when the 90-day curve outgrows
	// the setting. A suggestion, never an application — FTP moves every
	// workout's difficulty (docs/SPEC.md).
	SuggestedFtp int `json:"suggestedFtp,omitempty"`
	// The evidence behind the suggestion, for the prompt's copy.
	Best20m int `json:"best20m,omitempty"`
	// Which providers this account signs in with — profile-screen copy only.
	Providers []string `json:"providers,omitempty"`
}

func (s *Service) handleMe(w http.ResponseWriter, r *http.Request) {
	user, ok := s.User(r)
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", "Not signed in.")
		return
	}
	response := toMe(user)
	if best, err := s.store.Queries.Best20mIn90Days(r.Context(), user.ID); err == nil {
		if suggested, ok := stats.SuggestFTP(int(best), int(user.FtpWatts)); ok {
			response.SuggestedFtp = suggested
			response.Best20m = int(best)
		}
	}
	if providers, err := s.store.Queries.ListUserProviders(r.Context(), user.ID); err == nil {
		response.Providers = providers
	}
	httpx.WriteJSON(w, http.StatusOK, response)
}

func (s *Service) handleUpdateMe(w http.ResponseWriter, r *http.Request) {
	if !s.sameOrigin(r) {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "Cross-origin request refused.")
		return
	}
	user, ok := s.User(r)
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", "Not signed in.")
		return
	}

	var req struct {
		DisplayName string `json:"displayName"`
		FtpWatts    int16  `json:"ftpWatts"`
		WeightKg    int16  `json:"weightKg"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That profile update could not be read.")
		return
	}
	// Same bounds as the schema CHECKs and the web store — one source, docs/SPEC.md.
	switch {
	case len(req.DisplayName) == 0 || len(req.DisplayName) > 60:
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"Display name has to be 1-60 characters.", "displayName")
		return
	case req.FtpWatts < 50 || req.FtpWatts > 600:
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"FTP has to be between 50 and 600 W.", "ftpWatts")
		return
	case req.WeightKg < 30 || req.WeightKg > 200:
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"Weight has to be between 30 and 200 kg.", "weightKg")
		return
	}

	updated, err := s.store.Queries.UpdateUserProfile(r.Context(), db.UpdateUserProfileParams{
		ID: user.ID, DisplayName: req.DisplayName, FtpWatts: req.FtpWatts, WeightKg: req.WeightKg,
	})
	if err != nil {
		s.log.Error("profile update failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"Your profile could not be saved. Try again.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toMe(updated))
}

func toMe(u db.User) meResponse {
	return meResponse{
		ID:          store.UUIDString(u.ID),
		DisplayName: u.DisplayName,
		AvatarURL:   u.AvatarUrl,
		FtpWatts:    u.FtpWatts,
		WeightKg:    u.WeightKg,
	}
}

// --- plumbing ---

// sameOrigin refuses mutating requests whose Origin disagrees with the Host.
// An absent Origin passes: non-browser clients send none, and a cross-site
// browser request always carries one.
func (s *Service) sameOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	scheme := "https"
	if !s.secure {
		scheme = "http"
	}
	return origin == scheme+"://"+r.Host
}

func (s *Service) setCookie(w http.ResponseWriter, name, value string, ttl time.Duration) {
	// gosec can't see through s.secure: it is true everywhere except plain-http
	// localhost, which cannot carry a Secure cookie at all.
	http.SetCookie(w, &http.Cookie{ //nolint:gosec // Secure is conditional on the deploy scheme, HttpOnly+Lax always set
		Name: name, Value: value, Path: "/",
		MaxAge: int(ttl.Seconds()), HttpOnly: true,
		Secure: s.secure, SameSite: http.SameSiteLaxMode,
	})
}

func (s *Service) clearCookie(w http.ResponseWriter, name string) {
	http.SetCookie(w, &http.Cookie{ //nolint:gosec // same conditional Secure as setCookie
		Name: name, Value: "", Path: "/", MaxAge: -1,
		HttpOnly: true, Secure: s.secure, SameSite: http.SameSiteLaxMode,
	})
}

func randomToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		// crypto/rand failing means the platform is broken; nothing sane to do.
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func hash(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}
