// The session cookie and what hangs off it: start, look up, require, log
// out — and the plumbing every handler in the package shares.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

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
// when the lookup itself failed (.claude/rules/errors.md, #236). It is also
// the CSRF boundary: every package's mutating handlers reach the session
// through this one method (directly, or via a wrapper like rooms.RequireMember),
// so refusing a mismatched Origin here covers all of them without a check at
// each of the ~50 call sites (#678).
func (s *Service) RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool) {
	if isMutatingMethod(r.Method) && !s.SameOrigin(r) {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "Cross-origin request refused.")
		return db.User{}, false
	}
	user, err := s.lookup(r)
	switch {
	case err == nil:
		return user, true
	case errors.Is(err, errNoSession):
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", signInMessage)
	default:
		httpx.Fail(w, s.log, "session lookup failed", err, "Could not check your session — try again in a moment.")
	}
	return db.User{}, false
}

// requireVerifiedEmail holds ADR-0029's ordering on the server instead of
// only in the SPA's gate (#1611): a passkey is a credential that only the
// recovery address can recover from, so an account onboarded with the
// requirement confirms one before it gains a passkey. Reports whether the
// rider may go on; writes the refusal when they may not.
//
// 403, not 401: the session is good and the rider is who they say they are —
// what is missing is a precondition on their own account (.claude/rules/errors.md).
//
// Two conditions narrow it, and both are the difference between a gate and a
// lockout. They are the same two the client applies in shouldPromptEmail
// (web/src/lib/account/verify-prompt.ts), so the server refuses exactly where
// the client already does:
//
//   - No mailer, no gate. Where mail is unconfigured, PATCH /api/me refuses
//     the address field outright, so nobody on that server can confirm one.
//     Enforcing there would take passkeys away from every account it holds,
//     permanently and with nothing the rider could do about it.
//   - email_required only. ADR-0029 requires an address of accounts created
//     from #781 on and merely asks it of the ones that predate it; those rows
//     carry email_required = false, and they are exactly the riders — one
//     Strava grant and nothing else — that passkeys exist for.
//
// The synthetic monitor (#822) has no third exemption here because it
// registers no passkeys; the client needs one because the gate stands in
// front of riding.
func (s *Service) requireVerifiedEmail(w http.ResponseWriter, user db.User) bool {
	if s.mailer == nil || !user.EmailRequired || user.EmailVerifiedAt.Valid {
		return true
	}
	httpx.WriteError(w, http.StatusForbidden, "forbidden",
		"Confirm your email address before adding a passkey — it is the way back into this account if the passkey is ever lost. Add the address in your WattRoom profile and open the link that arrives.")
	return false
}

// currentSessionHash is the hash of the session this request rides on, or
// nil when it carries none.
func currentSessionHash(r *http.Request) []byte {
	cookie, err := r.Cookie(sessionCookie)
	if err != nil || cookie.Value == "" {
		return nil
	}
	return hash(cookie.Value)
}

// endOtherSessions signs the account out everywhere but on this request's
// own session (#1607): the answer to ADR-0030's alarm, and what a credential
// removal does on its own — whoever added the passkey being removed may be
// holding a session too. Returns how many it ended.
func (s *Service) endOtherSessions(ctx context.Context, userID pgtype.UUID, r *http.Request) int64 {
	return s.endSessions(ctx, userID, currentSessionHash(r))
}

// endSessions ends every session of the account except the one `keep` hashes
// to; a nil keep ends all of them, which is what recovery needs (#1822) and
// what "pass a hash no session has" means in the query. Returns how many.
func (s *Service) endSessions(ctx context.Context, userID pgtype.UUID, keep []byte) int64 {
	if keep == nil {
		keep = []byte{}
	}
	n, err := s.store.Queries.DeleteUserSessionsExcept(ctx, db.DeleteUserSessionsExceptParams{
		UserID: userID, TokenHash: keep,
	})
	if err != nil {
		s.log.Error("ending sessions failed", "err", err)
	}
	return n
}

// handleLogoutEverywhere is the settings button (#1607): this screen stays
// signed in, every other one is not.
func (s *Service) handleLogoutEverywhere(w http.ResponseWriter, r *http.Request) {
	user, ok := s.RequireUser(w, r, "Sign in first.")
	if !ok {
		return
	}
	n := s.endOtherSessions(r.Context(), user.ID, r)
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"signedOut": n})
}

func (s *Service) handleLogout(w http.ResponseWriter, r *http.Request) {
	// Logout has to work even without a valid session (a stale cookie still
	// clears), so it cannot route through RequireUser — it checks Origin itself.
	if !s.SameOrigin(r) {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "Cross-origin request refused.")
		return
	}
	if cookie, err := r.Cookie(sessionCookie); err == nil && cookie.Value != "" {
		_ = s.store.Queries.DeleteSession(r.Context(), hash(cookie.Value))
	}
	s.clearCookie(w, sessionCookie)
	w.WriteHeader(http.StatusNoContent)
}

// SameOrigin reports whether the request's Origin agrees with the Host it
// was sent to. An absent Origin passes: non-browser clients (curl, the read
// tokens in package tokens) send none, and a cross-site browser request
// always carries one. Exported so RequireUser can enforce it as the shared
// CSRF boundary (#678) and so a handler that cannot route through RequireUser
// — logout works without a valid session — can still check it directly.
func (s *Service) SameOrigin(r *http.Request) bool {
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

// isMutatingMethod is RequireUser's CSRF gate: GET/HEAD/OPTIONS never carry
// side effects here (the one pre-existing exception, GET /api/rooms/{slug}
// marking the room read, is tracked separately — #678), so only these verbs
// need the Origin check on top of the SameSite=Lax cookie.
func isMutatingMethod(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	default:
		return false
	}
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
