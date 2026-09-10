package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// A display name is counted in characters, not bytes, and trimmed (audit
// 2026-09-09): a 21-letter Cyrillic name was refused as "over 60", and " "
// was a valid name that rendered as a blank tile everywhere.
func TestDisplayNameCountsRunesAndTrims(t *testing.T) {
	s := testService(t)
	user := testUser(t, s)
	rec := httptest.NewRecorder()
	if err := s.startSession(rec, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil), user.ID); err != nil {
		t.Fatalf("start session: %v", err)
	}
	cookie := rec.Result().Cookies()[0]
	patch := func(name string) int {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodPatch, "/api/me",
			strings.NewReader(`{"displayName":`+name+`,"ftpWatts":250,"weightKg":80}`))
		req.AddCookie(cookie)
		w := httptest.NewRecorder()
		s.handleUpdateMe(w, req)
		return w.Code
	}
	if code := patch(`"Александра Петровна-Ш"`); code != http.StatusOK {
		t.Errorf("a 21-character Cyrillic name: %d, want 200", code)
	}
	if code := patch(`"   "`); code != http.StatusBadRequest {
		t.Errorf("a name of spaces: %d, want 400", code)
	}
	if code := patch(`"` + strings.Repeat("ä", 61) + `"`); code != http.StatusBadRequest {
		t.Errorf("61 characters: %d, want 400", code)
	}
	if code := patch(`"  Jan  "`); code != http.StatusOK {
		t.Errorf("a padded name: %d, want 200 (trimmed)", code)
	}
	u, err := s.store.Queries.GetUser(t.Context(), user.ID)
	if err != nil || u.DisplayName != "Jan" {
		t.Errorf("stored name %q, want it trimmed to Jan (%v)", u.DisplayName, err)
	}
}

// Every mutating auth route, from another site (#1828): the routes behind
// RequireUser refuse at its origin gate, logout and the desktop redeem check
// the origin themselves, and the rest — the passkey ceremonies, whose origin
// the assertion itself carries, the synthetic bearer, which no site can read,
// the emailed form's single-use token — are bound by other means. Whatever
// each answers, none of them succeeds for a stranger's page and none mints a
// session. The list is the audit artifact as much as the assertion is: a new
// route lands here or the boundary has a door nobody counted.
func TestCrossSiteRequestsNeverMintOrMutate(t *testing.T) {
	s := testService(t)
	user := testUser(t, s)
	rec := httptest.NewRecorder()
	if err := s.startSession(rec, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil), user.ID); err != nil {
		t.Fatalf("start session: %v", err)
	}
	cookie := rec.Result().Cookies()[0]
	mux := http.NewServeMux()
	s.Register(mux)

	routes := []struct{ method, path, body string }{
		{http.MethodPost, "/api/auth/synthetic", ``},
		{http.MethodPost, "/api/auth/logout", ``},
		{http.MethodPost, "/api/auth/logout-everywhere", ``},
		{http.MethodPost, "/api/auth/verify-email", `token=x`},
		{http.MethodPost, "/api/auth/recover", `{"email":"stranger@example.test"}`},
		{http.MethodPost, "/api/auth/recover/finish", ``},
		{http.MethodPatch, "/api/me", `{"displayName":"x","ftpWatts":250,"weightKg":80}`},
		{http.MethodPost, "/api/me/avatar", ``},
		{http.MethodPatch, "/api/me/appearance", `{}`},
		{http.MethodPut, "/api/me/timezone", `{"timezone":"Europe/Zurich"}`},
		{http.MethodDelete, "/api/me/identities/google", ``},
		{http.MethodPost, "/api/auth/passkey/register/start", ``},
		{http.MethodPost, "/api/auth/passkey/register/finish", `{}`},
		{http.MethodPost, "/api/auth/passkey/login/start", ``},
		{http.MethodPost, "/api/auth/passkey/login/finish", `{}`},
		{http.MethodPatch, "/api/me/passkeys/x", `{"name":"y"}`},
		{http.MethodDelete, "/api/me/passkeys/x", ``},
		{http.MethodPost, "/api/auth/desktop/handoff", `{"nonce":"` + testNonce + `"}`},
		{http.MethodPost, "/api/auth/desktop/redeem", `{"token":"x","nonce":"` + testNonce + `"}`},
	}
	for _, route := range routes {
		req := httptest.NewRequestWithContext(t.Context(), route.method, "http://localhost:8080"+route.path, strings.NewReader(route.body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", "https://evil.example")
		req.AddCookie(cookie)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		// A challenge for a passkey login is the one 2xx a stranger may get:
		// the assertion it leads to carries the origin, and the RP refuses a
		// foreign one. Everything else answers with a refusal of some kind.
		if w.Code >= 200 && w.Code < 300 && route.path != "/api/auth/passkey/login/start" {
			t.Errorf("%s %s from another site succeeded: %d %s", route.method, route.path, w.Code, w.Body.String())
		}
		for _, c := range w.Result().Cookies() {
			if c.Name == sessionCookie && c.Value != "" && c.MaxAge >= 0 {
				t.Errorf("%s %s from another site set a session cookie", route.method, route.path)
			}
		}
	}

	// And the documented no-session cases: logout still clears a stale
	// cookie, logout-everywhere wants a session first.
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "http://localhost:8080/api/auth/logout", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code >= 300 {
		t.Errorf("logout without a session: %d, want a clear", w.Code)
	}
	req = httptest.NewRequestWithContext(t.Context(), http.MethodPost, "http://localhost:8080/api/auth/logout-everywhere", nil)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("logout-everywhere without a session: %d, want 401", w.Code)
	}
}
