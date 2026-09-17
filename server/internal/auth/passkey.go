package auth

// Passkeys (#782, ADR-0029): a credential in the account's set, beside the
// OAuth identities rather than instead of them.
//
// Discoverable credentials only. Signing in takes no identifier at all — the
// browser resolves the account from the credential itself and shows the rider
// which one it is, which is the whole reason this beats an email-first sign-in
// screen. There is deliberately no conditional UI: it needs a username field
// to decorate, and this page has none.
//
// `authenticatorAttachment` goes unset on purpose, so a phone, a password
// manager and a YubiKey all register through one path.

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

const (
	passkeyCookie = "wattroom_passkey"
	// A ceremony is a few seconds of touching a sensor. Ten minutes is the
	// same allowance the OAuth state gets, and both are one-shot anyway.
	challengeTTL = 10 * time.Minute
	maxNameLen   = 40
)

// passkeyUser adapts an account to what go-webauthn asks for. The handle is
// the account's own UUID: opaque, stable, and carrying no personal data, which
// is exactly what the spec wants of a user handle.
type passkeyUser struct {
	user  db.User
	creds []webauthn.Credential
}

func (u passkeyUser) WebAuthnID() []byte                         { return u.user.ID.Bytes[:] }
func (u passkeyUser) WebAuthnName() string                       { return u.user.DisplayName }
func (u passkeyUser) WebAuthnDisplayName() string                { return u.user.DisplayName }
func (u passkeyUser) WebAuthnCredentials() []webauthn.Credential { return u.creds }

// challengeStore holds the seconds between a ceremony's start and its finish.
//
// In memory on purpose: a challenge is live state, not durable data
// (docs/ARCHITECTURE.md seam 2), the server is a single instance (WATTROOM.md),
// and one that cannot survive a restart is one nobody can replay across a
// restart either. Entries are single use — take removes.
type challengeStore struct {
	mu sync.Mutex
	m  map[string]challengeEntry
}

type challengeEntry struct {
	data    webauthn.SessionData
	expires time.Time
}

// challengeMax bounds the map. login/start is unauthenticated, so without a
// ceiling a stranger's loop grows it until the process runs out of memory —
// and grows the sweep below, which every register and login finish waits on
// behind the same mutex (#827). Far above anything real: it is ten minutes of
// simultaneous ceremonies, and the alpha does not have four thousand riders.
const challengeMax = 4096

// maxPasskeys per account (#1415), the tokens' number: every ceremony
// unmarshals every credential the account holds, and nothing bounded the rows.
const maxPasskeys = 10

// tooManyPasskeys is one sentence in one place, beside tooManySignIns: the
// start and the finish refuse the same ceiling, and a rider who hit it
// mid-ceremony should not be told something different from one who hit it
// before starting.
const tooManyPasskeys = "Ten passkeys is the cap — remove one you no longer use first." //nolint:gosec // G101 matches any name containing "pass"; this is the refusal a rider reads

// errPasskeyCap carries the ceiling out of the locked transaction, where a
// refusal is not a database failure and must not be reported as one.
var errPasskeyCap = errors.New("auth: passkey cap reached")

func newChallengeStore() *challengeStore {
	return &challengeStore{m: map[string]challengeEntry{}}
}

// put reports false when the store is full, which is the caller's cue to
// refuse the ceremony rather than start one it cannot remember.
func (c *challengeStore) put(data webauthn.SessionData) (string, bool) {
	token := randomToken()
	now := time.Now()

	c.mu.Lock()
	defer c.mu.Unlock()
	// ponytail: swept on write rather than by a ticker — the map only grows
	// when someone starts a ceremony, so that is when it is worth looking.
	for k, v := range c.m {
		if now.After(v.expires) {
			delete(c.m, k)
		}
	}
	// Swept first, so the ceiling counts live ceremonies and not the debris
	// of a flood that has already aged out.
	if len(c.m) >= challengeMax {
		return "", false
	}
	c.m[token] = challengeEntry{data: data, expires: now.Add(challengeTTL)}
	return token, true
}

func (c *challengeStore) take(token string) (webauthn.SessionData, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.m[token]
	delete(c.m, token)
	if !ok || time.Now().After(entry.expires) {
		return webauthn.SessionData{}, false
	}
	return entry.data, true
}

// newWebAuthn derives the relying party from the public origin. The RP ID is
// the hostname without the port, so one config covers the dev server and the
// Vite port in front of it; WATTROOM_EXTRA_ORIGINS is how that second origin
// gets allowed.
//
// Local origins only (#2258). An origin listed here can complete a WebAuthn
// ceremony for this RP ID, which makes the list a credential boundary; the
// hatch was written for the Vite port, a dev-only need, and localOrigin()
// already decides exactly that question for the dev login one door over.
// "Unset in production where there is only one" was a comment, not a rule.
// A public entry is dropped and named, never silently honoured.
func newWebAuthn(baseURL string, log *slog.Logger) (*webauthn.WebAuthn, error) {
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Hostname() == "" {
		return nil, errors.New("auth: passkeys need a parseable WATTROOM_BASE_URL")
	}
	origins := []string{parsed.Scheme + "://" + parsed.Host}
	for _, extra := range strings.Split(os.Getenv("WATTROOM_EXTRA_ORIGINS"), ",") {
		extra = strings.TrimSpace(extra)
		switch {
		case extra == "":
		case !localOrigin(extra):
			log.Warn("ignoring a public WATTROOM_EXTRA_ORIGINS entry: an extra passkey origin can complete a ceremony for this relying party, and the hatch is for the dev server's second port", "origin", extra)
		default:
			origins = append(origins, extra)
		}
	}
	return webauthn.New(&webauthn.Config{
		RPID:          parsed.Hostname(),
		RPDisplayName: "WattRoom",
		RPOrigins:     origins,
	})
}

func (s *Service) registerPasskeyRoutes(mux *http.ServeMux) {
	if s.wa == nil {
		return
	}
	mux.HandleFunc("POST /api/auth/passkey/register/start", s.handlePasskeyRegisterStart)
	mux.HandleFunc("POST /api/auth/passkey/register/finish", s.handlePasskeyRegisterFinish)
	mux.HandleFunc("POST /api/auth/passkey/login/start", s.handlePasskeyLoginStart)
	mux.HandleFunc("POST /api/auth/passkey/login/finish", s.handlePasskeyLoginFinish)
	mux.HandleFunc("GET /api/me/passkeys", s.handleListPasskeys)
	mux.HandleFunc("PATCH /api/me/passkeys/{id}", s.handleRenamePasskey)
	mux.HandleFunc("DELETE /api/me/passkeys/{id}", s.handleDeletePasskey)
}

// passkeyUserFor loads an account together with the credentials it can present.
func (s *Service) passkeyUserFor(r *http.Request, user db.User) (passkeyUser, error) {
	rows, err := s.store.Queries.ListUserPasskeys(r.Context(), user.ID)
	if err != nil {
		return passkeyUser{}, err
	}
	creds := make([]webauthn.Credential, 0, len(rows))
	for _, row := range rows {
		var c webauthn.Credential
		if err := json.Unmarshal(row.Credential, &c); err != nil {
			// One unreadable row must not lock a rider out of the others.
			s.log.Error("passkey record unreadable", "user", user.ID, "err", err)
			continue
		}
		creds = append(creds, c)
	}
	return passkeyUser{user: user, creds: creds}, nil
}

func (s *Service) handlePasskeyRegisterStart(w http.ResponseWriter, r *http.Request) {
	user, ok := s.RequireUser(w, r, "Sign in before adding a passkey.")
	if !ok {
		return
	}
	// ADR-0029's ordering: the recovery address comes before the credential
	// it would otherwise be the only way back from (#1611). Start is the whole
	// gate — a finish can only spend a challenge its own start issued, because
	// go-webauthn binds the registration session to the user handle and a
	// login's session carries none — so the rule lives in one place.
	if !s.requireVerifiedEmail(w, user) {
		return
	}
	pu, err := s.passkeyUserFor(r, user)
	if err != nil {
		httpx.Fail(w, s.log, "passkey user load failed", err, "Adding a passkey could not start. Try again.")
		return
	}
	if len(pu.creds) >= maxPasskeys {
		// A per-account ceiling: 429, like the tokens (errors.md). Courtesy,
		// not the rule — a rider at the cap should not be shown a browser
		// prompt whose result is refused. The finish holds the real one.
		httpx.WriteError(w, http.StatusTooManyRequests, "rate_limited", tooManyPasskeys)
		return
	}

	creation, session, err := s.wa.BeginRegistration(pu,
		// Discoverable, so a later sign-in needs no identifier.
		webauthn.WithResidentKeyRequirement(protocol.ResidentKeyRequirementRequired),
		// Offering a key the account already has invites a confusing overwrite.
		webauthn.WithExclusions(webauthn.Credentials(pu.WebAuthnCredentials()).CredentialDescriptors()),
	)
	if err != nil {
		httpx.Fail(w, s.log, "passkey registration start failed", err, "Adding a passkey could not start. Try again.")
		return
	}
	if !s.beginCeremony(w, *session) {
		return
	}
	httpx.WriteJSON(w, http.StatusOK, creation)
}

func (s *Service) handlePasskeyRegisterFinish(w http.ResponseWriter, r *http.Request) {
	user, ok := s.RequireUser(w, r, "Sign in before adding a passkey.")
	if !ok {
		return
	}
	session, ok := s.takeChallenge(w, r)
	if !ok {
		return
	}
	pu, err := s.passkeyUserFor(r, user)
	if err != nil {
		httpx.Fail(w, s.log, "passkey user load failed", err, "That passkey could not be saved. Try again.")
		return
	}

	credential, err := s.wa.FinishRegistration(pu, session, r)
	if err != nil {
		// Wrong origin, wrong challenge, a cancelled prompt: all the rider's
		// browser telling us this ceremony did not complete.
		s.log.Warn("passkey registration rejected", "user", user.ID, "err", err)
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request",
			"That passkey could not be confirmed. Start again from your profile.")
		return
	}
	encoded, err := json.Marshal(credential)
	if err != nil {
		httpx.Fail(w, s.log, "passkey encode failed", err, "That passkey could not be saved. Try again.")
		return
	}
	row, err := s.createPasskeyCapped(r.Context(), db.CreatePasskeyParams{
		CredentialID: credential.ID, UserID: user.ID, Credential: encoded,
		Name: passkeyName(r.URL.Query().Get("name")),
	})
	if errors.Is(err, errPasskeyCap) {
		httpx.WriteError(w, http.StatusTooManyRequests, "rate_limited", tooManyPasskeys)
		return
	}
	if err != nil {
		httpx.Fail(w, s.log, "passkey save failed", err, "That passkey could not be saved. Try again.")
		return
	}
	s.alert(user, "A passkey was added to your account",
		"The passkey "+strconv.Quote(row.Name)+" can now sign in to your WattRoom account.")
	httpx.WriteJSON(w, http.StatusOK, toPasskey(row))
}

// createPasskeyCapped is the ceiling's real enforcement (#2258), and it is
// where it has to live: the start of the ceremony counts too, but a count at
// the start and an insert at the finish are two statements with a whole
// browser prompt between them, so concurrent ceremonies all counted nine and
// all landed. Holding the rider's row makes the second one wait, then count
// what the first wrote. Returns errPasskeyCap when the account is full —
// a refusal, not a database failure.
func (s *Service) createPasskeyCapped(ctx context.Context, params db.CreatePasskeyParams) (db.Passkey, error) {
	var row db.Passkey
	err := s.store.WithUserLocked(ctx, params.UserID, func(q *db.Queries) error {
		n, err := q.CountUserPasskeys(ctx, params.UserID)
		if err != nil {
			return err
		}
		if n >= maxPasskeys {
			return errPasskeyCap
		}
		row, err = q.CreatePasskey(ctx, params)
		return err
	})
	return row, err
}

func (s *Service) handlePasskeyLoginStart(w http.ResponseWriter, r *http.Request) {
	if s.throttle(w, r, s.loginBudget, tooManySignIns) {
		return
	}
	assertion, session, err := s.wa.BeginDiscoverableLogin()
	if err != nil {
		httpx.Fail(w, s.log, "passkey login start failed", err, "Signing in with a passkey could not start. Try again.")
		return
	}
	if !s.beginCeremony(w, *session) {
		return
	}
	httpx.WriteJSON(w, http.StatusOK, assertion)
}

func (s *Service) handlePasskeyLoginFinish(w http.ResponseWriter, r *http.Request) {
	if s.throttle(w, r, s.loginBudget, tooManySignIns) {
		return
	}
	session, ok := s.takeChallenge(w, r)
	if !ok {
		return
	}

	// The handle is the account's UUID, put there by WebAuthnID at registration.
	lookup := func(_, userHandle []byte) (webauthn.User, error) {
		if len(userHandle) != 16 {
			return nil, errors.New("auth: passkey user handle is not an account id")
		}
		id := pgtype.UUID{Valid: true}
		copy(id.Bytes[:], userHandle)
		user, err := s.store.Queries.GetUser(r.Context(), id)
		if err != nil {
			return nil, err
		}
		return s.passkeyUserFor(r, user)
	}

	validated, credential, err := s.wa.FinishPasskeyLogin(lookup, session, r)
	if err != nil {
		s.log.Warn("passkey login rejected", "err", err)
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized",
			"That passkey was not accepted. Try again, or use one of the sign-in providers.")
		return
	}
	pu, ok := validated.(passkeyUser)
	if !ok {
		s.log.Error("passkey login returned an unexpected user type")
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"Signing in with that passkey did not work. Try again.")
		return
	}

	// The signature counter moved; the record the next login validates against
	// is this one, not the one registration wrote.
	if encoded, err := json.Marshal(credential); err == nil {
		if err := s.store.Queries.TouchPasskey(r.Context(), db.TouchPasskeyParams{
			CredentialID: credential.ID, Credential: encoded,
		}); err != nil {
			s.log.Error("passkey record update failed", "err", err)
		}
	}

	if err := s.startSession(w, r, pu.user.ID); err != nil {
		httpx.Fail(w, s.log, "session create failed", err, "That passkey worked, but the session could not be saved. Try again.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, s.fullMe(r.Context(), pu.user))
}

// beginCeremony hands the rider the cookie that carries their challenge, or
// refuses because the store is full — the only way past the cap is to wait,
// and saying so beats issuing a challenge nothing will remember.
func (s *Service) beginCeremony(w http.ResponseWriter, session webauthn.SessionData) bool {
	token, ok := s.challenges.put(session)
	if !ok {
		s.log.Warn("passkey challenge store full", "cap", challengeMax)
		httpx.WriteError(w, http.StatusServiceUnavailable, "rate_limited",
			"Too many passkey sign-ins are in progress right now. Try again in a moment.")
		return false
	}
	s.setCookie(w, passkeyCookie, token, challengeTTL)
	return true
}

// takeChallenge spends the one-shot cookie from the ceremony's start.
func (s *Service) takeChallenge(w http.ResponseWriter, r *http.Request) (webauthn.SessionData, bool) {
	cookie, err := r.Cookie(passkeyCookie)
	if err != nil || cookie.Value == "" {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request",
			"That passkey step arrived without its challenge. Start again.")
		return webauthn.SessionData{}, false
	}
	s.clearCookie(w, passkeyCookie)
	session, ok := s.challenges.take(cookie.Value)
	if !ok {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request",
			"That passkey challenge has expired or was already used. Start again.")
		return webauthn.SessionData{}, false
	}
	return session, true
}

// Credential ids travel as base64url, the encoding WebAuthn itself uses on the
// wire, so what the client received is what it can hand back in a path.
func encodeCredentialID(raw []byte) string {
	return base64.RawURLEncoding.EncodeToString(raw)
}
