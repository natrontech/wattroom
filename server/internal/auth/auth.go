// Package auth is OAuth sign-in (Google, GitHub, Strava) and sessions (#16).
//
// golang.org/x/oauth2 and stdlib, no framework. There is deliberately no
// password path anywhere in this package — the three providers are the entire
// credential story (WATTROOM.md).
//
// Sessions are server-side rows: the cookie carries 32 random bytes, the
// database only their SHA-256, so a leaked table cannot mint cookies and a
// session can be revoked by deleting a row. CSRF: the session cookie is
// SameSite=Lax, and RequireUser — the one entry point every mutating handler
// in this package and every other (rooms, chat, dms, friends, playlists,
// tokens, customworkouts, rides, account) resolves auth through — rejects a
// mismatched Origin header on POST/PUT/PATCH/DELETE. Lax covers navigations,
// the Origin check covers everything a hostile page can still send.
package auth

import (
	"crypto/subtle"
	"github.com/natrontech/wattroom/server/internal/budget"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/go-webauthn/webauthn/webauthn"
	"golang.org/x/oauth2"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/secrets"
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
	store *store.Store
	log   *slog.Logger
	// Seals the one credential that is stored to be used again rather than
	// merely checked (#697). Nil on a server with no key configured.
	keys      *secrets.Cipher
	providers map[string]provider
	// Desktop sign-in handoffs in flight (#1188); see desktop.go.
	handoffs handoffs
	// secure=false only for plain-http localhost; cookies are Secure otherwise.
	secure bool
	// The public origin, for OAuth callbacks and the emailed confirm link.
	baseURL string
	// Whether the server can send email (#117) — the profile hides the whole
	// notifications section when it cannot, and email verification (#781) is
	// absent rather than broken. SetMailer lives in email.go.
	mailer    Mailer
	avEnabled bool
	// Whether a Giphy key is configured (#878, #909) — the composer's GIF button
	// renders at all only when it is.
	gifsEnabled bool
	// Passkeys (#782): the relying party, derived from baseURL, and the
	// in-memory challenges a ceremony spends between start and finish. Both
	// nil on a server whose base URL will not parse, which takes the routes
	// with them rather than serving ones that cannot work.
	wa         *webauthn.WebAuthn
	challenges *challengeStore
	// Hands a Strava grant back when the rider disconnects it (#783).
	// SetStravaRevoker lives in credentials.go.
	stravaRevoker GrantRevoker
	// How much confirmation mail one account may cause (#827). budget.go.
	verifyMail *mailBudget
	// Per-address ceilings on the unauthenticated sign-in doors (#1606).
	loginBudget, syntheticBudget *budget.Budget[string]
	// Recovery (#1822): one per client address, one per email address it is
	// asked about. recover.go says why it takes both.
	recoverDoor, recoverMail *budget.Budget[string]
}

// New reads provider credentials from WATTROOM_OAUTH_{GOOGLE,GITHUB,STRAVA}_{ID,SECRET}.
// baseURL is the public origin for OAuth callbacks (WATTROOM_BASE_URL).
// keys seals the refresh tokens this service stores (#697); a nil one stores
// them in the clear, exactly as every release before it did.
func New(st *store.Store, log *slog.Logger, baseURL string, secure bool, keys *secrets.Cipher) *Service {
	svc := &Service{
		store:     st,
		log:       log,
		keys:      keys,
		providers: providersFromEnv(baseURL),
		secure:    secure,
		baseURL:   baseURL,
		// Always present, even where mail is not: the ceiling is cheap, and a
		// nil one would be a panic waiting for the day a mailer appears.
		verifyMail: newMailBudget(),
		// The doors a stranger can knock on (#1606, #1822).
		loginBudget:     budget.New[string](loginAttemptsPerWindow, loginWindow),
		syntheticBudget: budget.New[string](syntheticPerWindow, loginWindow),
		recoverDoor:     budget.New[string](recoverAsksPerWindow, loginWindow),
		recoverMail:     budget.New[string](recoverMailsPerWindow, recoverMailWindow),
	}
	if _, ok := svc.providers["dev"]; ok {
		log.Warn("WATTROOM_DEV_LOGIN is enabled — anyone reaching this server can sign in as Dev Rider")
	}
	if wa, err := newWebAuthn(baseURL); err != nil {
		log.Error("passkeys are off: could not build the relying party", "err", err)
	} else {
		svc.wa = wa
		svc.challenges = newChallengeStore()
	}
	return svc
}

// Register mounts every auth route on mux.
// SetAvEnabled marks LiveKit as configured; /api/me carries it so the
// client can gate voice/camera affordances (#219).
func (s *Service) SetAvEnabled(v bool) { s.avEnabled = v }

// SetGifsEnabled marks Giphy as configured; /api/me carries it so the
// composer hides the GIF button rather than opening a picker that 404s
// (#878).
func (s *Service) SetGifsEnabled(v bool) { s.gifsEnabled = v }

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/auth/providers", s.handleProviders)
	mux.HandleFunc("GET /api/auth/{provider}/start", s.handleStart)
	mux.HandleFunc("GET /api/auth/{provider}/callback", s.handleCallback)
	mux.HandleFunc("POST /api/auth/synthetic", s.handleSynthetic)
	mux.HandleFunc("POST /api/auth/logout", s.handleLogout)
	// Every other session of the account (#1607): the response to
	// ADR-0030's "a passkey was added" alarm, and a settings button.
	mux.HandleFunc("POST /api/auth/logout-everywhere", s.handleLogoutEverywhere)
	// The way back in when every credential is gone (#1822, ADR-0051):
	// recover mails the link, finish spends it. recover.go.
	mux.HandleFunc("POST /api/auth/recover", s.handleRecover)
	mux.HandleFunc("GET /api/auth/recover/finish", s.handleRecoverFinishForm)
	mux.HandleFunc("POST /api/auth/recover/finish", s.handleRecoverFinish)
	// The emailed confirm link (#781): GET renders the button, POST verifies.
	mux.HandleFunc("GET /api/auth/verify-email", s.handleVerifyEmailForm)
	mux.HandleFunc("POST /api/auth/verify-email", s.handleVerifyEmail)
	mux.HandleFunc("GET /api/me", s.handleMe)
	mux.HandleFunc("PATCH /api/me", s.handleUpdateMe)
	mux.HandleFunc("POST /api/me/avatar", s.handleSetAvatar)
	mux.HandleFunc("PATCH /api/me/appearance", s.handleUpdateAppearance)
	// Reported by the browser, not chosen by the rider (#858). timezone.go.
	mux.HandleFunc("PUT /api/me/timezone", s.handleUpdateTimezone)
	// The way back out of a connection (#783); linking is ?link=1 on start.
	mux.HandleFunc("DELETE /api/me/identities/{provider}", s.handleDisconnectProvider)
	s.registerPasskeyRoutes(mux)
	s.registerDesktopRoutes(mux)
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
	// Whether a new account will meet the address gate (ADR-0029): said on
	// the sign-in page, before the gate is the first screen after it
	// (audit 2026-09-09).
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"providers": ids, "mailAvailable": s.mailer != nil})
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
		// A GET that mints a session is a login-CSRF vector: any page a
		// developer visits could sign this browser in with an <img> (#1603).
		// A typed URL or a link on this origin is not cross-site; an
		// embedded fetch from elsewhere is, and the browser says so.
		if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			httpx.WriteError(w, http.StatusForbidden, "forbidden", "The dev login only answers a navigation from this origin.")
			return
		}
		ident := devIdentity(r.URL.Query().Get("as"))
		if linking {
			s.finishLink(w, r, p, ident, &oauth2.Token{}, linkTo)
			return
		}
		user, created, err := s.upsert(r, p, ident, &oauth2.Token{})
		if err == nil {
			err = s.startSession(w, r, user.ID)
		}
		if err != nil {
			httpx.Fail(w, s.log, "dev login failed", err, "Dev login failed. Check the server log.")
			return
		}
		http.Redirect(w, r, afterSignIn(p.id, created), http.StatusFound)
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
	if s.throttle(w, r, s.syntheticBudget) {
		return
	}
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
		// No address: server/AGENTS.md logs nothing about a caller beyond ids.
		s.log.Warn("synthetic sign-in rejected")
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized",
			"That token is not valid for synthetic sign-in.")
		return
	}
	user, _, err := s.upsert(r, p, identity{
		ProviderUserID: "synthetic-monitor",
		DisplayName:    "Synthetic Monitor",
	}, &oauth2.Token{})
	if err == nil {
		err = s.startSession(w, r, user.ID)
	}
	if err != nil {
		httpx.Fail(w, s.log, "synthetic sign-in failed", err, "Synthetic sign-in failed. Check the server log.")
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
	if err != nil || cookie.Value == "" ||
		subtle.ConstantTimeCompare([]byte(r.URL.Query().Get("state")), []byte(cookie.Value)) != 1 {
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
		httpx.Fail(w, s.log, "identity fetch failed", err, "Signing in worked but reading your profile did not. Try again.", "provider", p.id)
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

	user, created, err := s.upsert(r, p, ident, tok)
	if err != nil {
		httpx.Fail(w, s.log, "identity upsert failed", err, "Your account could not be created. Try again.", "provider", p.id)
		return
	}

	if err := s.startSession(w, r, user.ID); err != nil {
		httpx.Fail(w, s.log, "session create failed", err, "Signed in, but the session could not be saved. Try again.")
		return
	}
	http.Redirect(w, r, afterSignIn(p.id, created), http.StatusFound)
}

// afterSignIn is where the OAuth round trip lands. A sign-in that *created* an
// account says so in the URL, because a rider who meant to reach the account
// they already have has just made a second one, and this is the only moment
// undoing it is cheap (#784). The client reads it once and clears it.
func afterSignIn(provider string, created bool) string {
	if !created {
		return "/"
	}
	return "/?new=" + url.QueryEscape(provider)
}
