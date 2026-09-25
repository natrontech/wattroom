package auth

import (
	"crypto/subtle"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/natrontech/wattroom/server/internal/httpx"
)

// handleCallback finishes an OAuth round trip: the provider sent the tab back
// here with a code to trade for the rider's identity, or with the reason it
// would not. Every answer but the throttle's and an unknown provider's is a
// redirect or a page (#2847).
func (s *Service) handleCallback(w http.ResponseWriter, r *http.Request) {
	// The callback is unauthenticated and does outbound work — a token
	// exchange and an identity fetch — so a loop here is a request amplifier
	// against the provider, and Strava's tier is the tightest thing this app
	// depends on (#2255). Same door and same message as the passkey login.
	if s.throttle(w, r, s.loginBudget, tooManySignIns) {
		return
	}
	// dev and synthetic have no OAuth app, so no callback of theirs is real
	// (#2864) — and a state cookie the caller set would pass the check below.
	p, ok := s.providers[r.PathValue("provider")]
	if !ok || p.config == nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found",
			"That sign-in provider is not configured on this server.")
		return
	}

	// A provider that answers with ?error= instead of a code has ended the
	// flow, most often at the rider's own Cancel (#2847). Nothing is spent on
	// it, so it needs no proof of this browser: say so before the state check,
	// which a reloaded tab would fail with the wrong story.
	query := r.URL.Query()
	cookie, err := r.Cookie(stateCookie)
	started := err == nil && cookie.Value != ""
	if code := query.Get("error"); code != "" {
		linking := started && strings.HasPrefix(cookie.Value, linkStatePrefix)
		if started {
			s.clearCookie(w, stateCookie)
		}
		s.providerRefused(w, p, code, linking)
		return
	}

	// The state cookie proves this callback belongs to a flow we started in
	// this browser; without it any link could complete a login (login CSRF).
	if !started || subtle.ConstantTimeCompare([]byte(query.Get("state")), []byte(cookie.Value)) != 1 {
		s.callbackPage(w, http.StatusBadRequest, false, "This sign-in has expired",
			"It was not started in this browser, or it already finished — a reload or a second tab does this. Start again from the sign-in page.")
		return
	}
	linking := strings.HasPrefix(cookie.Value, linkStatePrefix)
	s.clearCookie(w, stateCookie)
	name := providerLabel(p.id)

	// Bounded from here down (#2255): the exchange and the identity fetch are
	// the only outbound calls a signing-in rider makes, and oauth2 falls back
	// to http.DefaultClient, which has no timeout.
	ctx := oauthCtx(r.Context())
	tok, err := p.config.Exchange(ctx, query.Get("code"))
	if err != nil {
		s.log.Warn("oauth exchange failed", "provider", p.id, "err", err)
		s.callbackPage(w, http.StatusBadRequest, linking, name+" did not accept this sign-in",
			"Nothing changed. Start again — a sign-in link works once, and only for a few minutes.")
		return
	}
	ident, err := p.fetch(ctx, p.config, tok)
	if err != nil {
		s.log.Error("identity fetch failed", "provider", p.id, "err", err)
		s.callbackPage(w, http.StatusInternalServerError, linking, "Your profile could not be read",
			name+" let you in, but reading your profile from it failed, so nothing changed. Try again in a moment.")
		return
	}

	// Linking never mints a session: the rider is already in one, and the
	// point is to leave them in it with one more way back.
	if linking {
		linkTo, err := s.lookup(r)
		switch {
		case errors.Is(err, errNoSession):
			s.callbackPage(w, http.StatusUnauthorized, false, "You were signed out",
				"Your session ended before "+name+" answered, so nothing was connected. Sign in, then connect "+name+" from your profile again.")
		case err != nil:
			s.log.Error("session lookup failed", "err", err)
			s.callbackPage(w, http.StatusInternalServerError, true, "Nothing was connected",
				"Your session could not be checked, so "+name+" was not connected. Try again in a moment.")
		default:
			s.finishLink(w, r, p, ident, tok, linkTo)
		}
		return
	}

	user, created, err := s.upsert(r, p, ident, tok)
	if err != nil {
		s.log.Error("identity upsert failed", "provider", p.id, "err", err)
		s.callbackPage(w, http.StatusInternalServerError, false, "Your account could not be opened",
			name+" let you in, but WattRoom could not save the sign-in. Try again in a moment.")
		return
	}

	if err := s.startSession(w, r, user.ID); err != nil {
		s.log.Error("session create failed", "err", err)
		s.callbackPage(w, http.StatusInternalServerError, false, "You are not signed in yet",
			name+" let you in, but the session could not be saved. Try again in a moment.")
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

// callbackPage is where a failed OAuth round trip lands (#2847). The callback
// is a top-level browser navigation — the provider redirected the tab here —
// so the answer is a page that says what happened and links the way back, the
// mail-link pages' shape; a JSON body would sit in the address bar as raw text.
// Connecting a provider goes back to the profile it was started from.
func (s *Service) callbackPage(w http.ResponseWriter, status int, linking bool, heading, line string) {
	href, label := "/login", "Back to sign-in"
	if linking {
		href, label = "/settings/profile", "Back to your profile"
	}
	httpx.WritePage(w, status, heading, httpx.PageBody(heading, line, httpx.PageLink(s.baseURL+href, label)))
}

// providerRefused answers a callback the provider sent back with ?error= in
// place of a code (RFC 6749 §4.1.2.1). access_denied is the rider pressing
// Cancel on the consent screen, which is a choice rather than a failure. The
// provider's own error_description is never echoed: it is text from a third
// party's redirect, and the rider's move is the same whatever it says.
func (s *Service) providerRefused(w http.ResponseWriter, p provider, code string, linking bool) {
	name := providerLabel(p.id)
	if code == "access_denied" {
		nothing := "nothing was signed in or created."
		if linking {
			nothing = "nothing was connected."
		}
		s.callbackPage(w, http.StatusOK, linking, "Sign-in cancelled",
			"You cancelled at "+name+", so "+nothing)
		return
	}
	s.log.Warn("oauth provider answered with an error", "provider", p.id, "error", code)
	s.callbackPage(w, http.StatusBadRequest, linking, name+" did not finish the sign-in",
		name+" did not finish the sign-in, so nothing changed. Start again, or try another way to sign in.")
}
