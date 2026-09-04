package auth

import (
	"context"
	"maps"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

import (
	"encoding/json"
	"log/slog"

	"github.com/natrontech/wattroom/server/internal/httpx"
)

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
		"email":   `{"displayName":"x","ftpWatts":250,"weightKg":80,"email":"not-an-address"}`,
		"preset":  `{"displayName":"x","ftpWatts":250,"weightKg":80,"avatarPreset":"<script>"}`,
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

func TestUpdateMeEmailNotify(t *testing.T) {
	s := testService(t)
	user := testUser(t, s)
	rec := httptest.NewRecorder()
	if err := s.startSession(rec, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil), user.ID); err != nil {
		t.Fatalf("start session: %v", err)
	}
	cookie := rec.Result().Cookies()[0]
	patch := func(body string) db.User {
		t.Helper()
		req := httptest.NewRequestWithContext(t.Context(), http.MethodPatch, "/api/me", strings.NewReader(body))
		req.AddCookie(cookie)
		w := httptest.NewRecorder()
		s.handleUpdateMe(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("patch %s = %d: %s", body, w.Code, w.Body.String())
		}
		u, err := s.store.Queries.GetUser(t.Context(), user.ID)
		if err != nil {
			t.Fatalf("re-read user: %v", err)
		}
		return u
	}

	u := patch(`{"displayName":"x","ftpWatts":250,"weightKg":80,"email":"a@example.test","notifyPlanned":true}`)
	if u.Email == nil || *u.Email != "a@example.test" || !u.NotifyPlanned {
		t.Fatalf("email opt-in did not persist: %+v", u)
	}
	// A patch that omits both keeps them — clients predating the fields
	// must not wipe the setting.
	u = patch(`{"displayName":"x","ftpWatts":250,"weightKg":80}`)
	if u.Email == nil || !u.NotifyPlanned {
		t.Fatalf("absent fields wiped the setting: %+v", u)
	}
	// Clearing the address forces the opt-in off: nothing to send to.
	u = patch(`{"displayName":"x","ftpWatts":250,"weightKg":80,"email":""}`)
	if u.Email != nil || u.NotifyPlanned {
		t.Fatalf("cleared email left notify on: %+v", u)
	}

	// Avatar preset (#253): pick persists, absent keeps, "" clears.
	u = patch(`{"displayName":"x","ftpWatts":250,"weightKg":80,"avatarPreset":"flame"}`)
	if u.AvatarPreset == nil || *u.AvatarPreset != "flame" {
		t.Fatalf("avatar pick did not persist: %+v", u)
	}
	u = patch(`{"displayName":"x","ftpWatts":250,"weightKg":80}`)
	if u.AvatarPreset == nil || *u.AvatarPreset != "flame" {
		t.Fatalf("absent avatarPreset wiped the pick: %+v", u)
	}
	u = patch(`{"displayName":"x","ftpWatts":250,"weightKg":80,"avatarPreset":""}`)
	if u.AvatarPreset != nil {
		t.Fatalf("empty avatarPreset did not clear the pick: %+v", u)
	}
}

// The web store replaces its whole `me` with the PATCH response, so it must
// carry everything GET /api/me does — providers vanishing on save was #261.
func TestUpdateMeResponseCarriesProviders(t *testing.T) {
	s := testService(t)
	user := testUser(t, s)
	if err := s.store.Queries.CreateIdentity(t.Context(), db.CreateIdentityParams{
		Provider: "github", ProviderUserID: "update-me-test", UserID: user.ID,
	}); err != nil {
		t.Fatalf("create identity: %v", err)
	}
	rec := httptest.NewRecorder()
	if err := s.startSession(rec, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil), user.ID); err != nil {
		t.Fatalf("start session: %v", err)
	}

	req := httptest.NewRequestWithContext(t.Context(), http.MethodPatch, "/api/me",
		strings.NewReader(`{"displayName":"x","ftpWatts":250,"weightKg":80}`))
	req.AddCookie(rec.Result().Cookies()[0])
	w := httptest.NewRecorder()
	s.handleUpdateMe(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("patch = %d: %s", w.Code, w.Body.String())
	}
	var got meResponse
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(got.Providers) != 1 || got.Providers[0] != "github" {
		t.Fatalf("PATCH response lost providers: %+v", got.Providers)
	}
}

// The paths below never touch the database, so they run everywhere.

func bareService() *Service {
	return &Service{log: slog.New(slog.DiscardHandler), providers: map[string]provider{}, secure: false}
}

// Appearance follows the account (#326): the choice round-trips, "" is kept
// as "the default, chosen" (not null), junk is refused, and no cookie is 401.
func TestUpdateAppearance(t *testing.T) {
	s := testService(t)
	user := testUser(t, s)
	rec := httptest.NewRecorder()
	if err := s.startSession(rec, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil), user.ID); err != nil {
		t.Fatalf("start session: %v", err)
	}
	cookie := rec.Result().Cookies()[0]
	patch := func(body string) (int, meResponse) {
		t.Helper()
		req := httptest.NewRequestWithContext(t.Context(), http.MethodPatch, "/api/me/appearance", strings.NewReader(body))
		req.AddCookie(cookie)
		w := httptest.NewRecorder()
		s.handleUpdateAppearance(w, req)
		var got meResponse
		_ = json.NewDecoder(w.Body).Decode(&got)
		return w.Code, got
	}

	code, got := patch(`{"accentPalette":"{\"kind\":\"preset\",\"identity\":\"tron\"}","colorScheme":"light"}`)
	if code != http.StatusOK || got.AccentPalette == nil || *got.AccentPalette != `{"kind":"preset","identity":"tron"}` || got.ColorScheme == nil || *got.ColorScheme != "light" {
		t.Fatalf("round trip: %d %+v", code, got)
	}
	// Absent keeps; "" is a value.
	code, got = patch(`{"colorScheme":""}`)
	if code != http.StatusOK || got.AccentPalette == nil || got.ColorScheme == nil || *got.ColorScheme != "" {
		t.Fatalf("partial patch: %d %+v", code, got)
	}
	for name, body := range map[string]string{
		"scheme":  `{"colorScheme":"sepia"}`,
		"long":    `{"accentPalette":"` + strings.Repeat("x", maxPaletteChoice+1) + `"}`,
		"unknown": `{"font":"comic"}`,
	} {
		if code, _ := patch(body); code != http.StatusBadRequest {
			t.Errorf("%s: expected 400, got %d", name, code)
		}
	}

	w := httptest.NewRecorder()
	s.handleUpdateAppearance(w, httptest.NewRequestWithContext(t.Context(), http.MethodPatch, "/api/me/appearance", strings.NewReader(`{}`)))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("no cookie: expected 401, got %d", w.Code)
	}
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

func TestDevLoginAsMintsASecondRider(t *testing.T) {
	// ?as=Nina is a different rider from Dev Rider, and asking twice is still
	// one Nina — the same no-multiplication rule the default identity keeps.
	t.Setenv("WATTROOM_DEV_LOGIN", "1")
	s := testService(t)
	s.providers = providersFromEnv("http://localhost:8080")
	t.Cleanup(func() {
		_, _ = s.store.Pool.Exec(context.Background(),
			"delete from users where id in (select user_id from identities where provider = 'dev')")
	})
	login := func(as string) *http.Cookie {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/auth/dev/start?as="+as, nil)
		req.SetPathValue("provider", "dev")
		w := httptest.NewRecorder()
		s.handleStart(w, req)
		if w.Code != http.StatusFound {
			t.Fatalf("dev login as %q: %d %s", as, w.Code, w.Body.String())
		}
		return w.Result().Cookies()[0]
	}
	nina := login("Nina")
	login("Nina")
	dev := login("")
	authed := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/me", nil)
	authed.AddCookie(nina)
	if user, ok := s.User(authed); !ok || user.DisplayName != "Nina" {
		t.Fatalf("?as=Nina did not resolve to Nina (ok=%v)", ok)
	}
	authed2 := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/me", nil)
	authed2.AddCookie(dev)
	if user, ok := s.User(authed2); !ok || user.DisplayName != "Dev Rider" {
		t.Fatalf("default dev login changed (ok=%v)", ok)
	}
	var count int
	_ = s.store.Pool.QueryRow(context.Background(),
		"select count(*) from identities where provider = 'dev'").Scan(&count)
	if count != 2 {
		t.Fatalf("expected Dev Rider + Nina, got %d dev identities", count)
	}
	// Junk falls back rather than failing a dev at the door.
	junk := login("%3Cscript%3E")
	authed3 := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/me", nil)
	authed3.AddCookie(junk)
	if user, ok := s.User(authed3); !ok || user.DisplayName != "Dev Rider" {
		t.Fatalf("junk ?as= should fall back to Dev Rider (ok=%v)", ok)
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

// The synthetic monitor's sign-in (#153): the one credential that is not OAuth,
// so the cases that matter are "absent config means absent route" and "a wrong
// token gets nothing".
func TestSyntheticSignIn(t *testing.T) {
	token := "test-synthetic-token-not-a-real-secret"

	post := func(t *testing.T, s *Service, header string) *httptest.ResponseRecorder {
		t.Helper()
		rec := httptest.NewRecorder()
		req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/auth/synthetic", nil)
		if header != "" {
			req.Header.Set("Authorization", header)
		}
		s.handleSynthetic(rec, req)
		return rec
	}

	t.Run("unconfigured is 404, not 401", func(t *testing.T) {
		s := testService(t) // no WATTROOM_SYNTHETIC_TOKEN set
		if got := post(t, s, "Bearer "+token).Code; got != http.StatusNotFound {
			t.Fatalf("want 404 when unconfigured, got %d", got)
		}
	})

	t.Setenv("WATTROOM_SYNTHETIC_TOKEN", token)

	t.Run("valid token starts a session", func(t *testing.T) {
		s := testService(t)
		rec := post(t, s, "Bearer "+token)
		if rec.Code != http.StatusNoContent {
			t.Fatalf("want 204, got %d (%s)", rec.Code, rec.Body.String())
		}
		cookies := rec.Result().Cookies()
		if len(cookies) != 1 || cookies[0].Name != sessionCookie || cookies[0].Value == "" {
			t.Fatalf("expected a session cookie, got %v", cookies)
		}
		req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/me", nil)
		req.AddCookie(cookies[0])
		user, ok := s.User(req)
		if !ok || user.DisplayName != "Synthetic Monitor" {
			t.Fatalf("session did not resolve to the monitor: ok=%v user=%+v", ok, user)
		}
		t.Cleanup(func() {
			_, _ = s.store.Pool.Exec(context.Background(), "delete from users where id = $1", user.ID)
		})
	})

	for _, tc := range []struct{ name, header string }{
		{"wrong token", "Bearer " + token + "-wrong"},
		{"empty bearer", "Bearer "},
		{"no header at all", ""},
		{"raw token without the scheme", token + "x"},
	} {
		t.Run(tc.name+" is rejected", func(t *testing.T) {
			s := testService(t)
			rec := post(t, s, tc.header)
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("want 401, got %d", rec.Code)
			}
			if len(rec.Result().Cookies()) != 0 {
				t.Fatal("a rejected sign-in must not set a cookie")
			}
		})
	}

	t.Run("synthetic is never offered as a sign-in button", func(t *testing.T) {
		s := testService(t)
		rec := httptest.NewRecorder()
		s.handleProviders(rec, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/auth/providers", nil))
		if strings.Contains(rec.Body.String(), "synthetic") {
			t.Fatalf("synthetic must not appear in the provider list: %s", rec.Body.String())
		}
	})
}

// #236: a Postgres outage must read as internal_error (500), never bounce a
// valid session to login as "unauthorized" (401).
func TestRequireUserTellsOutageFromSignedOut(t *testing.T) {
	s := testService(t)
	user := testUser(t, s)

	rec := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil)
	if err := s.startSession(rec, req, user.ID); err != nil {
		t.Fatalf("start session: %v", err)
	}
	session := rec.Result().Cookies()[0]

	// Ordered: the last case closes the pool.
	tests := []struct {
		name       string
		cookie     *http.Cookie
		breakDB    bool
		wantOK     bool
		wantStatus int
		wantCode   string
	}{
		{"valid session", session, false, true, 0, ""},
		{"no cookie", nil, false, false, http.StatusUnauthorized, "unauthorized"},
		{"stale cookie", &http.Cookie{
			Name: sessionCookie, Value: "stale",
			Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode,
		}, false, false, http.StatusUnauthorized, "unauthorized"},
		{"database down", session, true, false, http.StatusInternalServerError, "internal_error"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.breakDB {
				s.store.Pool.Close()
			}
			w := httptest.NewRecorder()
			r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil)
			if tt.cookie != nil {
				r.AddCookie(tt.cookie)
			}
			got, ok := s.RequireUser(w, r, "Not signed in.")
			if ok != tt.wantOK {
				t.Fatalf("ok = %v, want %v (body %s)", ok, tt.wantOK, w.Body.String())
			}
			if tt.wantOK {
				if got.ID != user.ID {
					t.Fatalf("wrong user resolved")
				}
				return
			}
			if w.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d (body %s)", w.Code, tt.wantStatus, w.Body.String())
			}
			var body httpx.ErrorResponse
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatalf("bad error body %q: %v", w.Body.String(), err)
			}
			if body.Error != tt.wantCode {
				t.Fatalf("error code = %q, want %q", body.Error, tt.wantCode)
			}
		})
	}
}

// --- provider linking (#719) ---

// devLink drives the link flow through the dev provider, which reaches the
// same finishLink/link path a real callback does without an OAuth round trip.
func devLink(t *testing.T, s *Service, session *http.Cookie, as string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet,
		"/api/auth/dev/start?link=1&as="+as, nil)
	req.SetPathValue("provider", "dev")
	if session != nil {
		req.AddCookie(session)
	}
	w := httptest.NewRecorder()
	s.handleStart(w, req)
	return w
}

func devSignIn(t *testing.T, s *Service, as string) *http.Cookie {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/auth/dev/start?as="+as, nil)
	req.SetPathValue("provider", "dev")
	w := httptest.NewRecorder()
	s.handleStart(w, req)
	if w.Code != http.StatusFound {
		t.Fatalf("dev sign-in as %q: %d %s", as, w.Code, w.Body.String())
	}
	return w.Result().Cookies()[0]
}

func devIdentityOwners(t *testing.T, s *Service) map[string]string {
	t.Helper()
	rows, err := s.store.Pool.Query(context.Background(),
		"select provider_user_id, user_id::text from identities where provider = 'dev'")
	if err != nil {
		t.Fatalf("query identities: %v", err)
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var pid, uid string
		if err := rows.Scan(&pid, &uid); err != nil {
			t.Fatalf("scan: %v", err)
		}
		out[pid] = uid
	}
	return out
}

func linkOutcome(t *testing.T, w *httptest.ResponseRecorder) string {
	t.Helper()
	if w.Code != http.StatusFound {
		t.Fatalf("expected a redirect, got %d %s", w.Code, w.Body.String())
	}
	u, err := url.Parse(w.Header().Get("Location"))
	if err != nil {
		t.Fatalf("bad Location %q: %v", w.Header().Get("Location"), err)
	}
	return u.Query().Get("link")
}

func devLinkService(t *testing.T) *Service {
	t.Helper()
	t.Setenv("WATTROOM_DEV_LOGIN", "1")
	s := testService(t)
	s.providers = providersFromEnv("http://localhost:8080")
	t.Cleanup(func() {
		_, _ = s.store.Pool.Exec(context.Background(),
			"delete from users where id in (select user_id from identities where provider = 'dev')")
	})
	return s
}

func TestLinkAttachesToTheSignedInUser(t *testing.T) {
	s := devLinkService(t)
	session := devSignIn(t, s, "")

	me := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/me", nil)
	me.AddCookie(session)
	before, ok := s.User(me)
	if !ok {
		t.Fatal("dev sign-in did not resolve")
	}

	w := devLink(t, s, session, "Nina")
	if got := linkOutcome(t, w); got != "connected" {
		t.Fatalf("link outcome = %q, want connected", got)
	}
	// Linking must not re-issue a session: the rider stays who they were.
	for _, c := range w.Result().Cookies() {
		if c.Name == sessionCookie {
			t.Fatalf("link minted a session cookie")
		}
	}
	after, ok := s.User(me)
	if !ok || after.ID != before.ID {
		t.Fatalf("session changed identity across a link (ok=%v)", ok)
	}

	owners := devIdentityOwners(t, s)
	if len(owners) != 2 {
		t.Fatalf("expected two dev identities, got %d: %v", len(owners), owners)
	}
	if owners["local-dev"] != owners["local-dev:nina"] {
		t.Fatalf("link created a second account instead of attaching: %v", owners)
	}
}

func TestLinkRefusesAnIdentityOwnedByAnotherAccount(t *testing.T) {
	s := devLinkService(t)
	// Nina signs up first, so her identity belongs to her account.
	devSignIn(t, s, "Nina")
	session := devSignIn(t, s, "")
	beforeOwners := devIdentityOwners(t, s)

	w := devLink(t, s, session, "Nina")
	if got := linkOutcome(t, w); got != "taken" {
		t.Fatalf("link outcome = %q, want taken", got)
	}
	// Nothing moved: stealing the row would hand this rider Nina's account.
	if got := devIdentityOwners(t, s); !maps.Equal(got, beforeOwners) {
		t.Fatalf("refused link still wrote: before %v, after %v", beforeOwners, got)
	}
}

func TestLinkIsIdempotent(t *testing.T) {
	s := devLinkService(t)
	session := devSignIn(t, s, "")
	before := devIdentityOwners(t, s)

	if got := linkOutcome(t, devLink(t, s, session, "")); got != "connected" {
		t.Fatalf("re-linking an owned identity = %q, want connected", got)
	}
	if got := devIdentityOwners(t, s); !maps.Equal(got, before) {
		t.Fatalf("re-link changed rows: before %v, after %v", before, got)
	}
}

func TestLinkWithoutASessionIsRefused(t *testing.T) {
	s := devLinkService(t)
	w := devLink(t, s, nil, "Nina")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous link: %d %s", w.Code, w.Body.String())
	}
	if owners := devIdentityOwners(t, s); len(owners) != 0 {
		t.Fatalf("anonymous link wrote identities: %v", owners)
	}
}

func TestLinkIntentRidesInTheState(t *testing.T) {
	t.Setenv("WATTROOM_OAUTH_GITHUB_ID", "id")
	t.Setenv("WATTROOM_OAUTH_GITHUB_SECRET", "secret")
	s := testService(t)
	s.providers = providersFromEnv("http://localhost:8080")
	user := testUser(t, s)

	sess := httptest.NewRecorder()
	seed := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil)
	if err := s.startSession(sess, seed, user.ID); err != nil {
		t.Fatalf("start session: %v", err)
	}
	session := sess.Result().Cookies()[0]

	start := func(query string) string {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/auth/github/start"+query, nil)
		req.SetPathValue("provider", "github")
		req.AddCookie(session)
		w := httptest.NewRecorder()
		s.handleStart(w, req)
		if w.Code != http.StatusFound {
			t.Fatalf("start%s: %d %s", query, w.Code, w.Body.String())
		}
		for _, c := range w.Result().Cookies() {
			if c.Name == stateCookie {
				return c.Value
			}
		}
		t.Fatalf("start%s set no state cookie", query)
		return ""
	}

	if state := start("?link=1"); !strings.HasPrefix(state, linkStatePrefix) {
		t.Fatalf("link start did not mark the state: %q", state)
	}
	// A plain sign-in must never be read back as a link.
	if state := start(""); strings.HasPrefix(state, linkStatePrefix) {
		t.Fatalf("sign-in state carries the link prefix: %q", state)
	}
}
