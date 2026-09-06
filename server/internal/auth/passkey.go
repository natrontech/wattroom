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
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/jackc/pgx/v5"
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

func newChallengeStore() *challengeStore {
	return &challengeStore{m: map[string]challengeEntry{}}
}

func (c *challengeStore) put(data webauthn.SessionData) string {
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
	c.m[token] = challengeEntry{data: data, expires: now.Add(challengeTTL)}
	return token
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
// gets allowed, and is unset in production where there is only one.
func newWebAuthn(baseURL string) (*webauthn.WebAuthn, error) {
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Hostname() == "" {
		return nil, errors.New("auth: passkeys need a parseable WATTROOM_BASE_URL")
	}
	origins := []string{parsed.Scheme + "://" + parsed.Host}
	for _, extra := range strings.Split(os.Getenv("WATTROOM_EXTRA_ORIGINS"), ",") {
		if extra = strings.TrimSpace(extra); extra != "" {
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
	pu, err := s.passkeyUserFor(r, user)
	if err != nil {
		s.log.Error("passkey user load failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"Adding a passkey could not start. Try again.")
		return
	}

	creation, session, err := s.wa.BeginRegistration(pu,
		// Discoverable, so a later sign-in needs no identifier.
		webauthn.WithResidentKeyRequirement(protocol.ResidentKeyRequirementRequired),
		// Offering a key the account already has invites a confusing overwrite.
		webauthn.WithExclusions(webauthn.Credentials(pu.WebAuthnCredentials()).CredentialDescriptors()),
	)
	if err != nil {
		s.log.Error("passkey registration start failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"Adding a passkey could not start. Try again.")
		return
	}
	s.setCookie(w, passkeyCookie, s.challenges.put(*session), challengeTTL)
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
		s.log.Error("passkey user load failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"That passkey could not be saved. Try again.")
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
		s.log.Error("passkey encode failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"That passkey could not be saved. Try again.")
		return
	}
	row, err := s.store.Queries.CreatePasskey(r.Context(), db.CreatePasskeyParams{
		CredentialID: credential.ID, UserID: user.ID, Credential: encoded,
		Name: passkeyName(r.URL.Query().Get("name")),
	})
	if err != nil {
		s.log.Error("passkey save failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"That passkey could not be saved. Try again.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toPasskey(row))
}

func (s *Service) handlePasskeyLoginStart(w http.ResponseWriter, r *http.Request) {
	assertion, session, err := s.wa.BeginDiscoverableLogin()
	if err != nil {
		s.log.Error("passkey login start failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"Signing in with a passkey could not start. Try again.")
		return
	}
	s.setCookie(w, passkeyCookie, s.challenges.put(*session), challengeTTL)
	httpx.WriteJSON(w, http.StatusOK, assertion)
}

func (s *Service) handlePasskeyLoginFinish(w http.ResponseWriter, r *http.Request) {
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
		s.log.Error("session create failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"That passkey worked, but the session could not be saved. Try again.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, s.fullMe(r.Context(), pu.user))
}

func (s *Service) handleListPasskeys(w http.ResponseWriter, r *http.Request) {
	user, ok := s.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	rows, err := s.store.Queries.ListUserPasskeys(r.Context(), user.ID)
	if err != nil {
		s.log.Error("passkey list failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"Your passkeys could not be loaded. Try again.")
		return
	}
	out := make([]passkeyResponse, 0, len(rows))
	for _, row := range rows {
		out = append(out, toPasskey(row))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"passkeys": out})
}

func (s *Service) handleRenamePasskey(w http.ResponseWriter, r *http.Request) {
	user, ok := s.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	id, ok := passkeyID(w, r)
	if !ok {
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That rename could not be read.")
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" || utf8.RuneCountInString(name) > maxNameLen {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A passkey name has to be 1-40 characters.", "name")
		return
	}
	row, err := s.store.Queries.RenamePasskey(r.Context(), db.RenamePasskeyParams{
		CredentialID: id, UserID: user.ID, Name: name,
	})
	switch {
	case err == nil:
		httpx.WriteJSON(w, http.StatusOK, toPasskey(row))
	case errors.Is(err, pgx.ErrNoRows):
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That passkey is not on this account.")
	default:
		s.log.Error("passkey rename failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"That passkey could not be renamed. Try again.")
	}
}

func (s *Service) handleDeletePasskey(w http.ResponseWriter, r *http.Request) {
	user, ok := s.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	id, ok := passkeyID(w, r)
	if !ok {
		return
	}

	// ADR-0029's invariant, shared with the provider disconnect so the two
	// cannot drift (credentials.go).
	rows, last, err := s.removeCredential(r.Context(), user.ID, func(q *db.Queries) (int64, error) {
		return q.DeletePasskey(r.Context(), db.DeletePasskeyParams{CredentialID: id, UserID: user.ID})
	})
	switch {
	case err != nil:
		s.log.Error("passkey delete failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"That passkey could not be removed. Try again.")
	case last:
		httpx.WriteError(w, http.StatusConflict, "conflict", lastCredentialMessage)
	case rows == 0:
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That passkey is not on this account.")
	default:
		w.WriteHeader(http.StatusNoContent)
	}
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

func passkeyID(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	raw, err := base64.RawURLEncoding.DecodeString(r.PathValue("id"))
	if err != nil || len(raw) == 0 {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That is not a passkey id.")
		return nil, false
	}
	return raw, true
}

func passkeyName(raw string) string {
	name := strings.TrimSpace(raw)
	if name == "" {
		return "Passkey"
	}
	// Characters, not bytes: the form counts 40 characters, and a byte cut
	// lands mid-rune, which Postgres refuses — after the authenticator has
	// already minted the credential (#824).
	if runes := []rune(name); len(runes) > maxNameLen {
		return string(runes[:maxNameLen])
	}
	return name
}

type passkeyResponse struct {
	// Base64url, the same encoding WebAuthn uses on the wire, so the client
	// can hand it straight back in a path.
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	CreatedAt  string  `json:"createdAt"`
	LastUsedAt *string `json:"lastUsedAt,omitempty"`
}

func toPasskey(row db.Passkey) passkeyResponse {
	out := passkeyResponse{
		ID:        encodeCredentialID(row.CredentialID),
		Name:      row.Name,
		CreatedAt: row.CreatedAt.Time.UTC().Format(time.RFC3339),
	}
	if row.LastUsedAt.Valid {
		last := row.LastUsedAt.Time.UTC().Format(time.RFC3339)
		out.LastUsedAt = &last
	}
	return out
}
