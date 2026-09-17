package auth

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"golang.org/x/oauth2"

	"github.com/natrontech/wattroom/server/internal/budget"
)

func callbackService() *Service {
	return &Service{
		log: slog.New(slog.DiscardHandler), providers: map[string]provider{}, secure: false,
		loginBudget: budget.New[string](loginAttemptsPerWindow, loginWindow),
	}
}

func callback(t *testing.T, s *Service, state string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet,
		"/api/auth/github/callback?state="+state+"&code=x", nil)
	req.SetPathValue("provider", "github")
	req.AddCookie(&http.Cookie{
		Name: stateCookie, Value: "the-real-state",
		Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode,
	})
	w := httptest.NewRecorder()
	s.handleCallback(w, req)
	return w
}

// The callback is unauthenticated and does outbound work — a token exchange
// and an identity fetch — so an unthrottled loop is a request amplifier
// against the provider, and Strava's tier is the tightest thing this app
// depends on (#2255). loginBudget existed and was spent only on the two
// passkey-login routes.
func TestTheCallbackDoorHasACeiling(t *testing.T) {
	s := callbackService()
	s.providers["github"] = provider{id: "github"}

	for i := range loginAttemptsPerWindow {
		if code := callback(t, s, "forged").Code; code != http.StatusBadRequest {
			t.Fatalf("attempt %d answered %d, want the 400 for a forged state", i, code)
		}
	}
	w := callback(t, s, "forged")
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("attempt %d answered %d, want 429", loginAttemptsPerWindow+1, w.Code)
	}
	if !strings.Contains(w.Body.String(), "rate_limited") {
		t.Errorf("not errors.md's rate_limited shape: %s", w.Body)
	}

	// The ceiling is the door's, not the provider's: an unknown provider is
	// still a knock, so it cannot be the free way around it.
	if code := callback(t, callbackService(), "the-real-state").Code; code == http.StatusTooManyRequests {
		t.Error("a fresh service refused the first caller")
	}
}

// oauth2 falls back to http.DefaultClient, which has no timeout, so a
// provider host that accepts the connection and then says nothing pinned a
// goroutine for as long as the caller held on. The sibling strava package
// sets a 30 s client on its own and shows the shape.
func TestTheOAuthClientIsBounded(t *testing.T) {
	stuck := make(chan struct{})
	// Answers eventually, so an unbounded client fails the elapsed check
	// below instead of wedging the run until the timeout.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-time.After(3 * time.Second):
		case <-stuck:
		case <-r.Context().Done():
		}
	}))
	// Released before srv.Close, which waits on its handlers: cleanups run in
	// reverse, so this registration has to come second.
	t.Cleanup(srv.Close)
	t.Cleanup(func() { close(stuck) })

	was := oauthTimeout
	oauthTimeout = 50 * time.Millisecond
	t.Cleanup(func() { oauthTimeout = was })

	s := callbackService()
	s.providers["github"] = provider{
		id: "github",
		config: &oauth2.Config{
			ClientID: "id", ClientSecret: "secret",
			Endpoint: oauth2.Endpoint{TokenURL: srv.URL + "/token", AuthURL: srv.URL + "/auth"},
		},
		fetch: fetchGitHub,
	}

	start := time.Now()
	w := callback(t, s, "the-real-state")
	elapsed := time.Since(start)
	if elapsed > time.Second {
		t.Errorf("the exchange took %s — the client is not bounded", elapsed)
	}
	// A provider that did not answer is the provider refusing, which is what
	// the rider is told to start again from.
	if w.Code != http.StatusBadRequest {
		t.Errorf("status %d, want 400: %s", w.Code, w.Body)
	}
}
