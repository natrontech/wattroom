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
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"log/slog"
	"net/http"
	"net/mail"
	"net/url"
	"os"
	"regexp"
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
	// Marks a state as belonging to a link flow rather than a sign-in (#719).
	// A dot cannot occur in randomToken's base64url alphabet, so the prefix is
	// unambiguous.
	linkStatePrefix = "link."
)

type Service struct {
	store     *store.Store
	log       *slog.Logger
	providers map[string]provider
	// secure=false only for plain-http localhost; cookies are Secure otherwise.
	secure bool
	// Whether the server can send email (#117) — the profile hides the whole
	// notifications section when it cannot.
	mailAvailable bool
	avEnabled     bool
}

// SetMailAvailable wires the notify capability in after construction.
func (s *Service) SetMailAvailable(v bool) { s.mailAvailable = v }

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
// SetAvEnabled marks LiveKit as configured; /api/me carries it so the
// client can gate voice/camera affordances (#219).
func (s *Service) SetAvEnabled(v bool) { s.avEnabled = v }

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/auth/providers", s.handleProviders)
	mux.HandleFunc("GET /api/auth/{provider}/start", s.handleStart)
	mux.HandleFunc("GET /api/auth/{provider}/callback", s.handleCallback)
	mux.HandleFunc("POST /api/auth/synthetic", s.handleSynthetic)
	mux.HandleFunc("POST /api/auth/logout", s.handleLogout)
	mux.HandleFunc("GET /api/me", s.handleMe)
	mux.HandleFunc("PATCH /api/me", s.handleUpdateMe)
	mux.HandleFunc("PATCH /api/me/appearance", s.handleUpdateAppearance)
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

// devNames is what ?as= accepts: a display name, letters and spaces, short.
// Anything else falls back to the one Dev Rider rather than 400ing a dev.
var devNames = regexp.MustCompile(`^[A-Za-z][A-Za-z ]{0,23}$`)

func devIdentity(as string) identity {
	as = strings.TrimSpace(as)
	if as == "" || !devNames.MatchString(as) || strings.EqualFold(as, "Dev Rider") {
		return identity{ProviderUserID: "local-dev", DisplayName: "Dev Rider"}
	}
	return identity{
		ProviderUserID: "local-dev:" + strings.ToLower(strings.ReplaceAll(as, " ", "-")),
		DisplayName:    as,
	}
}

func (s *Service) handleStart(w http.ResponseWriter, r *http.Request) {
	p, ok := s.providers[r.PathValue("provider")]
	if !ok {
		httpx.WriteError(w, http.StatusNotFound, "not_found",
			"That sign-in provider is not configured on this server.")
		return
	}

	// ?link=1 is "attach this provider to the account I am already in",
	// not "sign me in" (#719). The intent must be explicit: linking off an
	// ambient session would silently bind whoever completes the provider flow
	// to whoever happens to be signed in on this browser.
	linking := r.URL.Query().Get("link") == "1"
	var linkTo db.User
	if linking {
		if linkTo, ok = s.RequireUser(w, r, "Sign in before connecting another provider."); !ok {
			return
		}
	}

	// The dev provider skips OAuth entirely; same identity + session machinery.
	// ?as=<name> mints a second dev rider — the only way to put two real
	// riders in one room on a dev box, which the crew strip, the roster's
	// execution bars and the sprint scoreboard had never been seen with.
	// Still behind WATTROOM_DEV_LOGIN; production never opens that door.
	if p.id == "dev" {
		ident := devIdentity(r.URL.Query().Get("as"))
		if linking {
			s.finishLink(w, r, p, ident, &oauth2.Token{}, linkTo)
			return
		}
		user, err := s.upsert(r, p, ident, &oauth2.Token{})
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

	// The intent rides in the state itself: the callback already has to match
	// it against the HttpOnly cookie byte for byte, so the prefix inherits that
	// proof and needs no second cookie. randomToken is base64url, never a dot.
	state := randomToken()
	if linking {
		state = linkStatePrefix + state
	}
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
	linking := strings.HasPrefix(cookie.Value, linkStatePrefix)
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

	// Linking never mints a session: the rider is already in one, and the
	// point is to leave them in it with one more way back.
	if linking {
		linkTo, ok := s.RequireUser(w, r, "Sign in before connecting another provider.")
		if !ok {
			return
		}
		s.finishLink(w, r, p, ident, tok, linkTo)
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

// errIdentityTaken: the provider account is already somebody else's way in.
// Reassigning the row would hand this rider that account, so linking refuses
// and writes nothing (#719). Merging two accounts is a separate problem.
var errIdentityTaken = errors.New("identity belongs to another account")

// link attaches ident to userID. Unlike upsert it never creates a user and
// never touches the session — the rider stays signed in as who they were.
func (s *Service) link(r *http.Request, p provider, ident identity, tok *oauth2.Token, userID pgtype.UUID) error {
	ctx := r.Context()
	q := s.store.Queries

	existing, err := q.GetIdentity(ctx, db.GetIdentityParams{
		Provider: p.id, ProviderUserID: ident.ProviderUserID,
	})
	switch {
	case err == nil:
		if existing.UserID != userID {
			return errIdentityTaken
		}
		// Already linked here: nothing to add, but a fresh Strava grant is
		// worth keeping — this is how a rider re-authorizes after a revoke.
		if p.keepTokens {
			return q.UpdateIdentityTokens(ctx, tokenParams(p, ident, tok))
		}
		return nil
	case errors.Is(err, pgx.ErrNoRows):
		// fall through to create
	default:
		return err
	}

	create := db.CreateIdentityParams{
		Provider: p.id, ProviderUserID: ident.ProviderUserID, UserID: userID,
	}
	if p.keepTokens {
		tp := tokenParams(p, ident, tok)
		create.AccessToken, create.RefreshToken, create.TokenExpiresAt =
			tp.AccessToken, tp.RefreshToken, tp.TokenExpiresAt
	}
	if err := q.CreateIdentity(ctx, create); err != nil {
		// Someone claimed this identity between the lookup and the insert —
		// the same race upsert guards against. Whoever won decides the answer.
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			winner, lookupErr := q.GetIdentity(ctx, db.GetIdentityParams{
				Provider: p.id, ProviderUserID: ident.ProviderUserID,
			})
			if lookupErr != nil {
				return lookupErr
			}
			if winner.UserID != userID {
				return errIdentityTaken
			}
			return nil
		}
		return err
	}
	return nil
}

// finishLink runs the link and sends the rider back to the profile, which
// reads ?link= and says what happened. The callback is a top-level browser
// navigation, so a JSON error body would land as raw text in the address bar —
// the banner is the error surface here (.claude/rules/errors.md).
func (s *Service) finishLink(w http.ResponseWriter, r *http.Request, p provider, ident identity, tok *oauth2.Token, to db.User) {
	outcome := "connected"
	switch err := s.link(r, p, ident, tok, to.ID); {
	case err == nil:
	case errors.Is(err, errIdentityTaken):
		s.log.Warn("link refused: identity already linked elsewhere", "provider", p.id)
		outcome = "taken"
	default:
		s.log.Error("link failed", "provider", p.id, "err", err)
		outcome = "failed"
	}
	http.Redirect(w, r, "/profile?link="+outcome+"&provider="+url.QueryEscape(p.id), http.StatusFound)
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

// errNoSession separates "no valid session" from "the lookup itself failed" —
// a Postgres outage must read as internal_error, not bounce every signed-in
// rider to login (#236).
var errNoSession = errors.New("no session")

func (s *Service) lookup(r *http.Request) (db.User, error) {
	cookie, err := r.Cookie(sessionCookie)
	if err != nil || cookie.Value == "" {
		return db.User{}, errNoSession
	}
	user, err := s.store.Queries.GetSessionUser(r.Context(), hash(cookie.Value))
	if errors.Is(err, pgx.ErrNoRows) {
		return db.User{}, errNoSession
	}
	if err != nil {
		return db.User{}, err
	}
	return user, nil
}

// User resolves the session cookie to the signed-in user, treating any
// failure as signed-out. The zero-trust version of "middleware" — handlers
// call it where they need it. For optional-auth paths only; handlers that
// refuse anonymous requests use RequireUser, which tells 401 from 500.
func (s *Service) User(r *http.Request) (db.User, bool) {
	user, err := s.lookup(r)
	return user, err == nil
}

// RequireUser is the mandatory-auth User: it resolves the session or writes
// the refusal — 401 with signInMessage when there is no valid session, 500
// when the lookup itself failed (.claude/rules/errors.md, #236).
func (s *Service) RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool) {
	user, err := s.lookup(r)
	switch {
	case err == nil:
		return user, true
	case errors.Is(err, errNoSession):
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", signInMessage)
	default:
		s.log.Error("session lookup failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"Could not check your session — try again in a moment.")
	}
	return db.User{}, false
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
	// Rider-picked preset id (#253) — an opaque slug the client's catalog
	// resolves; absent falls back to the OAuth photo, then an initial.
	AvatarPreset *string `json:"avatarPreset,omitempty"`
	// Lifetime XP — the level and its ring derive from this (docs/SPEC.md).
	TotalXp  int64 `json:"totalXp"`
	FtpWatts int16 `json:"ftpWatts"`
	WeightKg int16 `json:"weightKg"`
	// The FTP auto-detect prompt (#26): filled when the 90-day curve outgrows
	// the setting. A suggestion, never an application — FTP moves every
	// workout's difficulty (docs/SPEC.md).
	SuggestedFtp int `json:"suggestedFtp,omitempty"`
	// Whether LiveKit is configured — the client hides voice/cam controls
	// instead of serving 404s on click (#219, capability gating).
	AvEnabled bool `json:"avEnabled"`
	// The evidence behind the suggestion, for the prompt's copy.
	Best20m int `json:"best20m,omitempty"`
	// Which providers this account signs in with. Drives the profile's
	// connect rows (#719), so an absent one is an offer, not just copy.
	Providers []string `json:"providers,omitempty"`
	// Auto-upload rides to the rider's own Strava (#34, default true).
	StravaUpload bool `json:"stravaUpload"`
	// Email notifications for planned sessions (#117): the address is typed
	// in on the profile, the opt-in defaults off, and MailAvailable hides the
	// section entirely on servers that cannot send.
	Email         *string `json:"email,omitempty"`
	NotifyPlanned bool    `json:"notifyPlanned"`
	MailAvailable bool    `json:"mailAvailable,omitempty"`
	// Appearance follows the account (#326). Nil: no device has chosen yet;
	// "": the default, chosen. The client tells the two apart.
	AccentPalette *string `json:"accentPalette"`
	ColorScheme   *string `json:"colorScheme"`
}

func (s *Service) handleMe(w http.ResponseWriter, r *http.Request) {
	user, ok := s.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	httpx.WriteJSON(w, http.StatusOK, s.fullMe(r.Context(), user))
}

func (s *Service) handleUpdateMe(w http.ResponseWriter, r *http.Request) {
	if !s.sameOrigin(r) {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "Cross-origin request refused.")
		return
	}
	user, ok := s.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}

	var req struct {
		DisplayName string `json:"displayName"`
		FtpWatts    int16  `json:"ftpWatts"`
		WeightKg    int16  `json:"weightKg"`
		// Pointer: absent keeps the current value — a client that predates
		// the field must not silently switch uploads off.
		StravaUpload  *bool   `json:"stravaUpload"`
		Email         *string `json:"email"`
		NotifyPlanned *bool   `json:"notifyPlanned"`
		// "" clears the pick (back to the OAuth photo); absent keeps it.
		AvatarPreset *string `json:"avatarPreset"`
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

	stravaUpload := user.StravaUpload
	if req.StravaUpload != nil {
		stravaUpload = *req.StravaUpload
	}
	email := user.Email
	if req.Email != nil {
		switch e := strings.TrimSpace(*req.Email); {
		case e == "":
			email = nil
		case len(e) > 254 || !validEmail(e):
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
				"That does not look like an email address.", "email")
			return
		default:
			email = &e
		}
	}
	notify := user.NotifyPlanned
	if req.NotifyPlanned != nil {
		notify = *req.NotifyPlanned
	}
	if email == nil {
		notify = false // no address, nothing to send to
	}
	preset := user.AvatarPreset
	if req.AvatarPreset != nil {
		switch p := *req.AvatarPreset; {
		case p == "":
			preset = nil
		case !validPreset(p):
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
				"That avatar is not one of the presets.", "avatarPreset")
			return
		default:
			preset = &p
		}
	}
	updated, err := s.store.Queries.UpdateUserProfile(r.Context(), db.UpdateUserProfileParams{
		ID: user.ID, DisplayName: req.DisplayName, FtpWatts: req.FtpWatts,
		WeightKg: req.WeightKg, StravaUpload: stravaUpload,
		Email: email, NotifyPlanned: notify, AvatarPreset: preset,
	})
	if err != nil {
		s.log.Error("profile update failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"Your profile could not be saved. Try again.")
		return
	}
	// The client replaces its whole `me` with this response — it has to be as
	// complete as GET /api/me, or providers/AV/FTP-suggestion/XP vanish on save.
	httpx.WriteJSON(w, http.StatusOK, s.fullMe(r.Context(), updated))
}

// maxPaletteChoice bounds the stored palette choice: the client's own JSON
// ({"kind":"custom","hue":200}) is under 40 bytes; anything near this is junk.
const maxPaletteChoice = 120

// handleUpdateAppearance stores the theme identity and the scheme toggle on
// the account (#326), so the next device shows the same room. Both stay
// opaque to the server beyond bounds — the palette is the client's choice
// JSON, the scheme "", "dark" or "light". Absent keeps the current value; ""
// is the default chosen on purpose, distinct from never chosen (null), which
// the client reads as "push what this device has".
func (s *Service) handleUpdateAppearance(w http.ResponseWriter, r *http.Request) {
	if !s.sameOrigin(r) {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "Cross-origin request refused.")
		return
	}
	user, ok := s.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	var req struct {
		AccentPalette *string `json:"accentPalette"`
		ColorScheme   *string `json:"colorScheme"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That appearance update could not be read.")
		return
	}
	palette := user.AccentPalette
	if req.AccentPalette != nil {
		if len(*req.AccentPalette) > maxPaletteChoice {
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
				"That palette choice is not one the app makes.", "accentPalette")
			return
		}
		palette = req.AccentPalette
	}
	scheme := user.ColorScheme
	if req.ColorScheme != nil {
		switch *req.ColorScheme {
		case "", "dark", "light":
			scheme = req.ColorScheme
		default:
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
				"Scheme has to be dark, light, or empty for auto.", "colorScheme")
			return
		}
	}
	updated, err := s.store.Queries.UpdateUserAppearance(r.Context(), db.UpdateUserAppearanceParams{
		ID: user.ID, AccentPalette: palette, ColorScheme: scheme,
	})
	if err != nil {
		s.log.Error("appearance update failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"Your appearance could not be saved. Try again.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, s.fullMe(r.Context(), updated))
}

// fullMe is the complete GET/PATCH /api/me body: toMe plus the fields that
// need extra queries or service config.
func (s *Service) fullMe(ctx context.Context, user db.User) meResponse {
	response := s.toMe(user)
	response.AvEnabled = s.avEnabled
	if best, err := s.store.Queries.Best20mIn90Days(ctx, user.ID); err == nil {
		if suggested, ok := stats.SuggestFTP(int(best), int(user.FtpWatts)); ok {
			response.SuggestedFtp = suggested
			response.Best20m = int(best)
		}
	}
	if providers, err := s.store.Queries.ListUserProviders(ctx, user.ID); err == nil {
		response.Providers = providers
	}
	if xp, err := s.store.Queries.UserTotalXp(ctx, user.ID); err == nil {
		response.TotalXp = xp
	}
	return response
}

func (s *Service) toMe(u db.User) meResponse {
	return meResponse{
		StravaUpload:  u.StravaUpload,
		ID:            store.UUIDString(u.ID),
		DisplayName:   u.DisplayName,
		AvatarURL:     u.AvatarUrl,
		AvatarPreset:  u.AvatarPreset,
		FtpWatts:      u.FtpWatts,
		WeightKg:      u.WeightKg,
		Email:         u.Email,
		NotifyPlanned: u.NotifyPlanned,
		MailAvailable: s.mailAvailable,
		AccentPalette: u.AccentPalette,
		ColorScheme:   u.ColorScheme,
	}
}

// validEmail accepts only a bare RFC 5322 address — no display-name forms.
func validEmail(e string) bool {
	a, err := mail.ParseAddress(e)
	return err == nil && a.Address == e
}

// validPreset bounds the avatar preset id: a short kebab slug. The catalog
// itself lives client-side (#253); the server only refuses junk.
var validPreset = regexp.MustCompile(`^[a-z0-9-]{1,32}$`).MatchString

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
