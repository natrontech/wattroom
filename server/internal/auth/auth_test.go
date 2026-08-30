package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

import "log/slog"

func testService(t *testing.T) *Service {
	t.Helper()
	dsn := os.Getenv("WATTROOM_TEST_DB")
	if dsn == "" {
		dsn = "postgres://wattroom:wattroom@localhost:5432/wattroom_test" //nolint:gosec // compose test credentials — NEVER the dev db, tests delete users
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	st, err := store.Open(ctx, dsn)
	if err != nil {
		t.Skipf("no database available: %v", err)
	}
	t.Cleanup(st.Close)
	return New(st, slog.New(slog.DiscardHandler), "http://localhost:8080", false)
}

func testUser(t *testing.T, s *Service) db.User {
	t.Helper()
	user, err := s.store.Queries.CreateUser(t.Context(), db.CreateUserParams{
		DisplayName: "auth-test", FtpWatts: 200, WeightKg: 75,
	})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = s.store.Pool.Exec(context.Background(), "delete from users where id = $1", user.ID)
	})
	return user
}

func TestSessionRoundTrip(t *testing.T) {
	s := testService(t)
	user := testUser(t, s)

	rec := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil)
	if err := s.startSession(rec, req, user.ID); err != nil {
		t.Fatalf("start session: %v", err)
	}
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != sessionCookie {
		t.Fatalf("expected one session cookie, got %v", cookies)
	}
	// Only the hash may be stored: the cookie value itself must not appear in the DB.
	var count int
	err := s.store.Pool.QueryRow(context.Background(),
		"select count(*) from sessions where token_hash = $1", hash(cookies[0].Value)).Scan(&count)
	if err != nil || count != 1 {
		t.Fatalf("hashed session row not found (err %v, count %d)", err, count)
	}

	authed := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/me", nil)
	authed.AddCookie(cookies[0])
	got, ok := s.User(authed)
	if !ok || got.DisplayName != "auth-test" {
		t.Fatalf("session did not resolve to its user (ok=%v)", ok)
	}

	// Logout revokes server-side: the same cookie must stop working.
	logout := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/auth/logout", nil)
	logout.AddCookie(cookies[0])
	s.handleLogout(httptest.NewRecorder(), logout)
	if _, ok := s.User(authed); ok {
		t.Fatalf("session survived logout — revocation is broken")
	}
}

func TestUpdateMeRejectsJunk(t *testing.T) {
	s := testService(t)
	user := testUser(t, s)
	rec := httptest.NewRecorder()
	if err := s.startSession(rec, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil), user.ID); err != nil {
		t.Fatalf("start session: %v", err)
	}
	cookie := rec.Result().Cookies()[0]

	for name, body := range map[string]string{
		"ftp":     `{"displayName":"x","ftpWatts":9000,"weightKg":80}`,
		"weight":  `{"displayName":"x","ftpWatts":250,"weightKg":5}`,
		"name":    `{"displayName":"","ftpWatts":250,"weightKg":80}`,
		"unknown": `{"displayName":"x","ftpWatts":250,"weightKg":80,"admin":true}`,
	} {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodPatch, "/api/me", strings.NewReader(body))
		req.AddCookie(cookie)
		w := httptest.NewRecorder()
		s.handleUpdateMe(w, req)
		if w.Code != http.StatusBadRequest {
			t.Errorf("%s: expected 400, got %d", name, w.Code)
		}
	}
}

// The paths below never touch the database, so they run everywhere.

func bareService() *Service {
	return &Service{log: slog.New(slog.DiscardHandler), providers: map[string]provider{}, secure: false}
}

func TestMeUnauthenticated(t *testing.T) {
	w := httptest.NewRecorder()
	bareService().handleMe(w, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/me", nil))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestCallbackRejectsForgedState(t *testing.T) {
	s := bareService()
	s.providers["github"] = provider{id: "github"}

	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/auth/github/callback?state=forged&code=x", nil)
	req.SetPathValue("provider", "github")
	req.AddCookie(&http.Cookie{
		Name: stateCookie, Value: "the-real-state",
		Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode,
	})
	w := httptest.NewRecorder()
	s.handleCallback(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("a forged state got past the check: %d", w.Code)
	}
}

func TestUnknownProviderIs404(t *testing.T) {
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/auth/facebook/start", nil)
	req.SetPathValue("provider", "facebook")
	w := httptest.NewRecorder()
	bareService().handleStart(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestSameOriginRefusesCrossSite(t *testing.T) {
	s := bareService()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "http://localhost:8080/api/auth/logout", nil)
	req.Header.Set("Origin", "https://evil.example")
	if s.sameOrigin(req) {
		t.Fatalf("cross-origin request passed the origin check")
	}
	req.Header.Set("Origin", "http://"+req.Host)
	if !s.sameOrigin(req) {
		t.Fatalf("same-origin request was refused")
	}
	req.Header.Del("Origin")
	if !s.sameOrigin(req) {
		t.Fatalf("originless (non-browser) request was refused")
	}
}

func TestProvidersFromEnv(t *testing.T) {
	t.Setenv("WATTROOM_OAUTH_GITHUB_ID", "id")
	t.Setenv("WATTROOM_OAUTH_GITHUB_SECRET", "secret")
	got := providersFromEnv("http://localhost:8080")
	if _, ok := got["github"]; !ok {
		t.Fatalf("configured provider missing")
	}
	if _, ok := got["google"]; ok {
		t.Fatalf("unconfigured provider present — its button would 500 on click")
	}
	if got["github"].config.RedirectURL != "http://localhost:8080/api/auth/github/callback" {
		t.Fatalf("wrong callback: %s", got["github"].config.RedirectURL)
	}
}

func TestDevLoginGated(t *testing.T) {
	// Absent by default — the door only exists when explicitly opened.
	if _, ok := providersFromEnv("http://localhost:8080")["dev"]; ok {
		t.Fatalf("dev provider present without WATTROOM_DEV_LOGIN")
	}
	t.Setenv("WATTROOM_DEV_LOGIN", "1")
	if _, ok := providersFromEnv("http://localhost:8080")["dev"]; !ok {
		t.Fatalf("dev provider missing with WATTROOM_DEV_LOGIN=1")
	}
}

func TestDevLoginCreatesSession(t *testing.T) {
	t.Setenv("WATTROOM_DEV_LOGIN", "1")
	s := testService(t)
	s.providers = providersFromEnv("http://localhost:8080")
	t.Cleanup(func() {
		_, _ = s.store.Pool.Exec(context.Background(),
			"delete from users where id = (select user_id from identities where provider = 'dev')")
	})

	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/auth/dev/start", nil)
	req.SetPathValue("provider", "dev")
	w := httptest.NewRecorder()
	s.handleStart(w, req)
	if w.Code != http.StatusFound {
		t.Fatalf("dev login: %d %s", w.Code, w.Body.String())
	}
	cookie := w.Result().Cookies()
	if len(cookie) != 1 || cookie[0].Name != sessionCookie {
		t.Fatalf("no session cookie from dev login")
	}
	authed := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/me", nil)
	authed.AddCookie(cookie[0])
	user, ok := s.User(authed)
	if !ok || user.DisplayName != "Dev Rider" {
		t.Fatalf("dev session did not resolve (ok=%v)", ok)
	}
	// Second login reuses the same user — no rider multiplication.
	w2 := httptest.NewRecorder()
	req2 := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/auth/dev/start", nil)
	req2.SetPathValue("provider", "dev")
	s.handleStart(w2, req2)
	var count int
	_ = s.store.Pool.QueryRow(context.Background(),
		"select count(*) from identities where provider = 'dev'").Scan(&count)
	if count != 1 {
		t.Fatalf("dev login multiplied identities: %d", count)
	}
}

func TestParallelDevLoginsShareOneUser(t *testing.T) {
	// The identity-create race (found by parallel e2e workers, same shape as a
	// double-clicked OAuth redirect): every concurrent first sign-in must
	// succeed, and they must all land on ONE user with no orphan rows.
	t.Setenv("WATTROOM_DEV_LOGIN", "1")
	s := testService(t)
	t.Cleanup(func() {
		_, _ = s.store.Pool.Exec(context.Background(),
			"delete from users where id in (select user_id from identities where provider = 'dev')")
	})
	mux := http.NewServeMux()
	s.Register(mux)

	const parallel = 8
	codes := make(chan int, parallel)
	var wg sync.WaitGroup
	for range parallel {
		wg.Add(1)
		go func() {
			defer wg.Done()
			req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/auth/dev/start", nil)
			w := httptest.NewRecorder()
			mux.ServeHTTP(w, req)
			codes <- w.Code
		}()
	}
	wg.Wait()
	close(codes)
	for code := range codes {
		if code != http.StatusFound {
			t.Fatalf("a racing sign-in failed: %d", code)
		}
	}

	var users int
	err := s.store.Pool.QueryRow(context.Background(),
		"select count(distinct user_id) from identities where provider = 'dev'").Scan(&users)
	if err != nil || users != 1 {
		t.Fatalf("dev identities map to %d users (err %v), want 1", users, err)
	}
	var orphans int
	err = s.store.Pool.QueryRow(context.Background(),
		"select count(*) from users where display_name = 'Dev Rider' and id not in (select user_id from identities)").Scan(&orphans)
	if err != nil || orphans != 0 {
		t.Fatalf("%d orphan users left behind (err %v)", orphans, err)
	}
}
