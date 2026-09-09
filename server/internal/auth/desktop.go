package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"net/http"
	"regexp"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
)

// The desktop sign-in handoff (#1188, ADR-0040).
//
// The desktop shell cannot sign a rider in: Electron has no WebAuthn UI and
// Google refuses OAuth from its windows. So the shell opens the ordinary login
// page in the system browser with a nonce it generated, the rider signs in
// there however they like, and the browser hands the result back through
// wattroom://auth/<token>. Two endpoints make that a session in the shell:
//
//	POST /api/auth/desktop/handoff  {nonce}         signed-in browser → token
//	POST /api/auth/desktop/redeem   {token, nonce}  the shell → its own session
//
// The token is single-use, short-lived and bound to the nonce. The nonce is
// what stops a login-CSRF: an attacker can mint a token in their own browser,
// but a victim's shell only redeems with the nonce it kept, and the two never
// match. The shell gets a NEW session, not the browser's — signing out of one
// leaves the other alone.
//
// ponytail: in-memory. The server is one process (ADR-0002) and a token lives
// ninety seconds; a table would outlive its purpose by a release.
const handoffTTL = 90 * time.Second

var nonceShape = regexp.MustCompile(`^[A-Za-z0-9_-]{16,128}$`)

type handoff struct {
	userID  pgtype.UUID
	nonce   string
	expires time.Time
}

type handoffs struct {
	mu    sync.Mutex
	byTok map[string]handoff
}

// handoffMax bounds the map the way challengeMax bounds the ceremonies
// (#827, #1415): a signed-in loop could otherwise grow it, and the sweep
// below with it, for the TTL's length. Far above anything real.
const handoffMax = 4096

// put stores a handoff; false means the map is full and the caller refuses.
func (h *handoffs) put(tok string, v handoff) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.byTok == nil {
		h.byTok = map[string]handoff{}
	}
	// Expired entries go on the way in, so an unredeemed token costs nothing
	// past its TTL and the map cannot grow with abandoned sign-ins.
	now := time.Now()
	for k, e := range h.byTok {
		if now.After(e.expires) {
			delete(h.byTok, k)
		}
	}
	if len(h.byTok) >= handoffMax {
		return false
	}
	h.byTok[tok] = v
	return true
}

// take removes the token whether or not it is good: a wrong nonce burns it.
func (h *handoffs) take(tok string) (handoff, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	v, ok := h.byTok[tok]
	delete(h.byTok, tok)
	return v, ok
}

func (s *Service) registerDesktopRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/auth/desktop/handoff", s.handleDesktopHandoff)
	mux.HandleFunc("POST /api/auth/desktop/redeem", s.handleDesktopRedeem)
}

func (s *Service) handleDesktopHandoff(w http.ResponseWriter, r *http.Request) {
	user, ok := s.RequireUser(w, r, "Sign in here first; the app picks it up from this browser.")
	if !ok {
		return
	}
	var req struct {
		Nonce string `json:"nonce"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil || !nonceShape.MatchString(req.Nonce) {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"This sign-in was not started from the desktop app. Open WattRoom on your desk and try again.", "nonce")
		return
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		httpx.Fail(w, s.log, "handoff token", err, "Could not hand this sign-in to the app. Try again.")
		return
	}
	tok := base64.RawURLEncoding.EncodeToString(raw)
	if !s.handoffs.put(tok, handoff{userID: user.ID, nonce: req.Nonce, expires: time.Now().Add(handoffTTL)}) {
		// A shared resource is full: 503 with rate_limited (errors.md), the
		// shape the passkey ceremonies use.
		httpx.WriteError(w, http.StatusServiceUnavailable, "rate_limited",
			"Too many sign-ins are waiting to be picked up — try again in a minute.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"token": tok, "ttl": int(handoffTTL.Seconds())})
}

func (s *Service) handleDesktopRedeem(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token string `json:"token"`
		Nonce string `json:"nonce"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil || req.Token == "" || !nonceShape.MatchString(req.Nonce) {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error",
			"This sign-in link is incomplete. Start again from the app.")
		return
	}
	h, ok := s.handoffs.take(req.Token)
	if !ok || time.Now().After(h.expires) ||
		subtle.ConstantTimeCompare([]byte(h.nonce), []byte(req.Nonce)) != 1 {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request",
			"This sign-in link is stale or was meant for another app. Start again from the app.")
		return
	}
	user, err := s.store.Queries.GetUser(r.Context(), h.userID)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request",
			"That account no longer exists. Start again from the app.")
		return
	}
	if err := s.startSession(w, r, user.ID); err != nil {
		httpx.Fail(w, s.log, "session create failed", err, "Signed in, but the session could not be saved. Try again.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, s.fullMe(r.Context(), user))
}
