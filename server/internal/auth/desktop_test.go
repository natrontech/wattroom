package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const testNonce = "desktop-nonce-0123456789abcdef"

func postJSON(t *testing.T, s *Service, path, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	mux := http.NewServeMux()
	s.registerDesktopRoutes(mux)
	mux.ServeHTTP(rec, req)
	return rec
}

func signedInCookie(t *testing.T, s *Service) *http.Cookie {
	t.Helper()
	user := testUser(t, s)
	rec := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil)
	if err := s.startSession(rec, req, user.ID); err != nil {
		t.Fatalf("start session: %v", err)
	}
	return rec.Result().Cookies()[0]
}

func mint(t *testing.T, s *Service, cookie *http.Cookie, nonce string) string {
	t.Helper()
	rec := postJSON(t, s, "/api/auth/desktop/handoff", `{"nonce":"`+nonce+`"}`, cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("handoff: %d %s", rec.Code, rec.Body)
	}
	var out struct{ Token string }
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil || out.Token == "" {
		t.Fatalf("handoff body: %s", rec.Body)
	}
	return out.Token
}

// The happy path: the browser's session mints a token, the shell redeems it
// with the nonce it kept, and gets a session of its own — a different one.
func TestDesktopHandoffRoundTrip(t *testing.T) {
	s := testService(t)
	browser := signedInCookie(t, s)
	tok := mint(t, s, browser, testNonce)

	rec := postJSON(t, s, "/api/auth/desktop/redeem", `{"token":"`+tok+`","nonce":"`+testNonce+`"}`, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("redeem: %d %s", rec.Code, rec.Body)
	}
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != sessionCookie {
		t.Fatalf("redeem set no session cookie: %v", cookies)
	}
	if cookies[0].Value == browser.Value {
		t.Fatalf("the shell got the browser's session — it must get its own")
	}
	if !strings.Contains(rec.Body.String(), `"displayName":"auth-test"`) {
		t.Fatalf("redeem did not answer with the account: %s", rec.Body)
	}

	// Single use: the same link a second time is stale.
	again := postJSON(t, s, "/api/auth/desktop/redeem", `{"token":"`+tok+`","nonce":"`+testNonce+`"}`, nil)
	if again.Code != http.StatusBadRequest {
		t.Fatalf("second redeem: want 400, got %d", again.Code)
	}
}

// A token minted for one nonce is worthless with another — the login-CSRF
// this exists to stop — and the attempt burns the token.
func TestDesktopHandoffNonceMustMatch(t *testing.T) {
	s := testService(t)
	tok := mint(t, s, signedInCookie(t, s), testNonce)

	wrong := postJSON(t, s, "/api/auth/desktop/redeem", `{"token":"`+tok+`","nonce":"someone-elses-nonce-0000000000"}`, nil)
	if wrong.Code != http.StatusBadRequest {
		t.Fatalf("wrong nonce: want 400, got %d %s", wrong.Code, wrong.Body)
	}
	right := postJSON(t, s, "/api/auth/desktop/redeem", `{"token":"`+tok+`","nonce":"`+testNonce+`"}`, nil)
	if right.Code != http.StatusBadRequest {
		t.Fatalf("token survived a wrong-nonce attempt: got %d", right.Code)
	}
}

func TestDesktopHandoffExpires(t *testing.T) {
	s := testService(t)
	tok := mint(t, s, signedInCookie(t, s), testNonce)
	s.handoffs.mu.Lock()
	h := s.handoffs.byTok[tok]
	h.expires = time.Now().Add(-time.Second)
	s.handoffs.byTok[tok] = h
	s.handoffs.mu.Unlock()

	rec := postJSON(t, s, "/api/auth/desktop/redeem", `{"token":"`+tok+`","nonce":"`+testNonce+`"}`, nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expired token: want 400, got %d", rec.Code)
	}
}

func TestDesktopHandoffValidation(t *testing.T) {
	s := testService(t)
	browser := signedInCookie(t, s)

	if rec := postJSON(t, s, "/api/auth/desktop/handoff", `{"nonce":"`+testNonce+`"}`, nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("handoff without a session: want 401, got %d", rec.Code)
	}
	for _, body := range []string{`{}`, `{"nonce":"short"}`, `{"nonce":"has spaces in it and is long enough"}`, `not json`} {
		if rec := postJSON(t, s, "/api/auth/desktop/handoff", body, browser); rec.Code != http.StatusBadRequest {
			t.Fatalf("handoff %s: want 400, got %d", body, rec.Code)
		}
	}
	for _, body := range []string{`{}`, `{"token":"x"}`, `{"token":"x","nonce":"short"}`, `{"token":"never-minted-token-000000000000","nonce":"` + testNonce + `"}`} {
		if rec := postJSON(t, s, "/api/auth/desktop/redeem", body, nil); rec.Code != http.StatusBadRequest {
			t.Fatalf("redeem %s: want 400, got %d", body, rec.Code)
		}
	}
}
