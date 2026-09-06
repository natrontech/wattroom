package auth

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-webauthn/webauthn/webauthn"

	"github.com/natrontech/wattroom/server/internal/store/db"
)

// The ceremonies themselves are go-webauthn's to verify — signature checking,
// RP ID hashes and flag handling are why the library is here at all. What
// these cover is everything around them that is ours: challenge lifetime,
// authorization, and the invariant that keeps a rider from locking themselves
// out.

func TestChallengeIsSingleUse(t *testing.T) {
	c := newChallengeStore()
	token := c.put(webauthn.SessionData{Challenge: "abc"})

	got, ok := c.take(token)
	if !ok || got.Challenge != "abc" {
		t.Fatalf("first take = %q, %v", got.Challenge, ok)
	}
	if _, ok := c.take(token); ok {
		t.Fatal("a spent challenge was accepted a second time")
	}
}

func TestChallengeExpires(t *testing.T) {
	c := newChallengeStore()
	token := c.put(webauthn.SessionData{Challenge: "abc"})

	c.mu.Lock()
	entry := c.m[token]
	entry.expires = time.Now().Add(-time.Second)
	c.m[token] = entry
	c.mu.Unlock()

	if _, ok := c.take(token); ok {
		t.Fatal("an expired challenge was accepted")
	}
}

// A ceremony started long ago must not keep the map alive forever.
func TestChallengesAreSweptOnWrite(t *testing.T) {
	c := newChallengeStore()
	stale := c.put(webauthn.SessionData{Challenge: "old"})

	c.mu.Lock()
	entry := c.m[stale]
	entry.expires = time.Now().Add(-time.Hour)
	c.m[stale] = entry
	c.mu.Unlock()

	c.put(webauthn.SessionData{Challenge: "new"})

	c.mu.Lock()
	defer c.mu.Unlock()
	if _, still := c.m[stale]; still {
		t.Fatal("the stale challenge survived a later write")
	}
}

func TestNewWebAuthnDerivesRelyingParty(t *testing.T) {
	t.Setenv("WATTROOM_EXTRA_ORIGINS", "")
	wa, err := newWebAuthn("https://wattroom.ch")
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	// The RP ID carries no port, so one config covers every port the app is
	// served on; the origin list is exact.
	if wa.Config.RPID != "wattroom.ch" {
		t.Errorf("RPID = %q", wa.Config.RPID)
	}
	if len(wa.Config.RPOrigins) != 1 || wa.Config.RPOrigins[0] != "https://wattroom.ch" {
		t.Errorf("origins = %v", wa.Config.RPOrigins)
	}

	// Dev is served from Vite's port, on the same host — the origin check is
	// exact about ports, so that second origin has to be named.
	t.Setenv("WATTROOM_EXTRA_ORIGINS", "http://localhost:5507, http://localhost:5508")
	wa, err = newWebAuthn("http://localhost:8107")
	if err != nil {
		t.Fatalf("build with extras: %v", err)
	}
	if wa.Config.RPID != "localhost" {
		t.Errorf("dev RPID = %q", wa.Config.RPID)
	}
	if len(wa.Config.RPOrigins) != 3 {
		t.Fatalf("extra origins not added: %v", wa.Config.RPOrigins)
	}

	if _, err := newWebAuthn("::not a url"); err == nil {
		t.Error("an unparseable base URL built a relying party")
	}
}

func TestPasskeyName(t *testing.T) {
	long := strings.Repeat("x", 60)
	for _, tc := range []struct{ in, want string }{
		{"", "Passkey"},
		{"   ", "Passkey"},
		{" YubiKey ", "YubiKey"},
		{long, long[:maxNameLen]},
	} {
		if got := passkeyName(tc.in); got != tc.want {
			t.Errorf("passkeyName(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// signedIn returns a cookie for a fresh account.
func signedIn(t *testing.T, s *Service, user db.User) *http.Cookie {
	t.Helper()
	rec := httptest.NewRecorder()
	if err := s.startSession(rec, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil), user.ID); err != nil {
		t.Fatalf("start session: %v", err)
	}
	return rec.Result().Cookies()[0]
}

func addPasskey(t *testing.T, s *Service, user db.User, id, name string) db.Passkey {
	t.Helper()
	row, err := s.store.Queries.CreatePasskey(t.Context(), db.CreatePasskeyParams{
		CredentialID: []byte(id), UserID: user.ID, Credential: []byte(`{}`), Name: name,
	})
	if err != nil {
		t.Fatalf("create passkey: %v", err)
	}
	return row
}

func deletePasskey(t *testing.T, s *Service, cookie *http.Cookie, row db.Passkey) *httptest.ResponseRecorder {
	t.Helper()
	id := base64.RawURLEncoding.EncodeToString(row.CredentialID)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodDelete, "/api/me/passkeys/"+id, nil)
	req.SetPathValue("id", id)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	s.handleDeletePasskey(w, req)
	return w
}

// The ADR-0029 invariant: the last way in never leaves.
func TestDeletePasskeyRefusesTheLastCredential(t *testing.T) {
	s := testService(t)
	user := testUser(t, s)
	cookie := signedIn(t, s, user)
	only := addPasskey(t, s, user, "only-credential", "Phone")

	if w := deletePasskey(t, s, cookie, only); w.Code != http.StatusConflict {
		t.Fatalf("removing the only credential = %d, want 409: %s", w.Code, w.Body.String())
	}

	// A second passkey makes the first expendable.
	second := addPasskey(t, s, user, "second-credential", "YubiKey")
	if w := deletePasskey(t, s, cookie, only); w.Code != http.StatusNoContent {
		t.Fatalf("removing one of two = %d, want 204: %s", w.Code, w.Body.String())
	}
	// And now the second is the last one again.
	if w := deletePasskey(t, s, cookie, second); w.Code != http.StatusConflict {
		t.Fatalf("removing the new last credential = %d, want 409", w.Code)
	}
}

// Providers and passkeys count together — a rider with one of each can drop
// either.
func TestDeletePasskeyCountsProvidersToo(t *testing.T) {
	s := testService(t)
	user := testUser(t, s)
	cookie := signedIn(t, s, user)
	if err := s.store.Queries.CreateIdentity(t.Context(), db.CreateIdentityParams{
		Provider: "github", ProviderUserID: "passkey-invariant-test", UserID: user.ID,
	}); err != nil {
		t.Fatalf("create identity: %v", err)
	}
	only := addPasskey(t, s, user, "with-a-provider", "Phone")

	if w := deletePasskey(t, s, cookie, only); w.Code != http.StatusNoContent {
		t.Fatalf("removing a passkey backed by a provider = %d, want 204: %s", w.Code, w.Body.String())
	}
}

func TestPasskeyRoutesNeedAuth(t *testing.T) {
	s := testService(t)
	for name, call := range map[string]func(http.ResponseWriter, *http.Request){
		"list":   s.handleListPasskeys,
		"rename": s.handleRenamePasskey,
		"delete": s.handleDeletePasskey,
		"add":    s.handlePasskeyRegisterStart,
	} {
		w := httptest.NewRecorder()
		req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/me/passkeys", nil)
		call(w, req)
		if w.Code != http.StatusUnauthorized {
			t.Errorf("%s without a session = %d, want 401", name, w.Code)
		}
	}
}

func TestRenamePasskeyValidatesAndScopes(t *testing.T) {
	s := testService(t)
	user := testUser(t, s)
	cookie := signedIn(t, s, user)
	row := addPasskey(t, s, user, "rename-me", "Passkey")
	id := base64.RawURLEncoding.EncodeToString(row.CredentialID)

	rename := func(as *http.Cookie, pathID, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodPatch,
			"/api/me/passkeys/"+pathID, strings.NewReader(body))
		req.SetPathValue("id", pathID)
		req.AddCookie(as)
		w := httptest.NewRecorder()
		s.handleRenamePasskey(w, req)
		return w
	}

	if w := rename(cookie, id, `{"name":"Work YubiKey"}`); w.Code != http.StatusOK {
		t.Fatalf("rename = %d: %s", w.Code, w.Body.String())
	}
	if w := rename(cookie, id, `{"name":"   "}`); w.Code != http.StatusBadRequest {
		t.Errorf("empty name = %d, want 400", w.Code)
	}
	if w := rename(cookie, "nope!", `{"name":"x"}`); w.Code != http.StatusBadRequest {
		t.Errorf("junk id = %d, want 400", w.Code)
	}

	// Somebody else's passkey is not found, not forbidden — the id is theirs
	// to know about, not this account's.
	other := testUser(t, s)
	if w := rename(signedIn(t, s, other), id, `{"name":"mine now"}`); w.Code != http.StatusNotFound {
		t.Errorf("another account's passkey = %d, want 404", w.Code)
	}
}

func TestListPasskeysReturnsWhatWasStored(t *testing.T) {
	s := testService(t)
	user := testUser(t, s)
	cookie := signedIn(t, s, user)
	addPasskey(t, s, user, "listed-credential", "Phone")

	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/me/passkeys", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	s.handleListPasskeys(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("list = %d: %s", w.Code, w.Body.String())
	}
	body := w.Body.String()
	wantID := base64.RawURLEncoding.EncodeToString([]byte("listed-credential"))
	if !strings.Contains(body, wantID) || !strings.Contains(body, "Phone") {
		t.Fatalf("list body missing the passkey: %s", body)
	}
	// Never used yet, so the field stays out rather than reading as epoch.
	if strings.Contains(body, "lastUsedAt") {
		t.Fatalf("unused passkey reported a last-used time: %s", body)
	}
}

// A ceremony's finish without its cookie is a start that never happened.
func TestPasskeyFinishNeedsItsChallenge(t *testing.T) {
	s := testService(t)
	w := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/auth/passkey/login/finish", nil)
	s.handlePasskeyLoginFinish(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("finish without a cookie = %d, want 400", w.Code)
	}
}

// Names are cut by character, never mid-rune (#824): the form counts 40
// characters, and a byte cut produced invalid UTF-8 that Postgres refused —
// after the authenticator had already minted the credential.
func TestPasskeyNameCountsCharacters(t *testing.T) {
	forty := strings.Repeat("a", 39) + "é"
	if got := passkeyName(forty); got != forty {
		t.Fatalf("a 40-character name was cut: %q", got)
	}
	long := strings.Repeat("é", 41)
	if got := passkeyName(long); got != strings.Repeat("é", 40) {
		t.Fatalf("41 characters cut to %d bytes %q", len(got), got)
	}
	if got := passkeyName("  "); got != "Passkey" {
		t.Fatalf("blank name = %q", got)
	}
}
