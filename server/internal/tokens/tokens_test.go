package tokens

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

type fakeUsers struct{ byToken map[string]db.User }

func (f *fakeUsers) User(r *http.Request) (db.User, bool) {
	u, ok := f.byToken[r.Header.Get("X-Test-User")]
	return u, ok
}

func setup(t *testing.T) (*http.ServeMux, *Service) {
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

	u, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{
		DisplayName: "alice", FtpWatts: 250, WeightKg: 70,
	})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID)
	})
	users := &fakeUsers{byToken: map[string]db.User{"alice": u}}
	svc := New(st, users, slog.New(slog.DiscardHandler))
	mux := http.NewServeMux()
	svc.Register(mux)
	return mux, svc
}

func call(t *testing.T, mux *http.ServeMux, user, method, path, body string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), method, path, strings.NewReader(body))
	if user != "" {
		req.Header.Set("X-Test-User", user)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func TestTokenLifecycle(t *testing.T) {
	mux, svc := setup(t)

	if code, _ := call(t, mux, "", http.MethodPost, "/api/tokens", `{"name":"coach"}`); code != http.StatusUnauthorized {
		t.Fatalf("no auth must be 401, got %d", code)
	}
	if code, _ := call(t, mux, "alice", http.MethodPost, "/api/tokens", `{"name":""}`); code != http.StatusBadRequest {
		t.Fatalf("empty name must be 400, got %d", code)
	}

	code, created := call(t, mux, "alice", http.MethodPost, "/api/tokens", `{"name":"coach"}`)
	if code != http.StatusCreated {
		t.Fatalf("create: got %d %v", code, created)
	}
	raw, _ := created["token"].(string)
	if !strings.HasPrefix(raw, "wrt_") || len(raw) != 4+64 {
		t.Fatalf("token shape wrong: %q", raw)
	}

	// The secret never appears in the list.
	code, listed := call(t, mux, "alice", http.MethodGet, "/api/tokens", "")
	entries, _ := listed["tokens"].([]any)
	if code != http.StatusOK || len(entries) != 1 {
		t.Fatalf("list: got %d %v", code, listed)
	}
	first, ok := entries[0].(map[string]any)
	if !ok {
		t.Fatalf("list entry shape wrong: %v", entries[0])
	}
	if _, leaked := first["token"]; leaked {
		t.Fatal("list must never include the secret")
	}

	// Bearer auth resolves the owner — GET only through ReadSource.
	src := svc.ReadSource(&fakeUsers{byToken: map[string]db.User{}})
	get := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/progression", nil)
	get.Header.Set("Authorization", "Bearer "+raw)
	if u, ok := src.User(get); !ok || u.DisplayName != "alice" {
		t.Fatalf("bearer GET must authenticate the owner, got %v %v", u.DisplayName, ok)
	}
	post := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/rides", nil)
	post.Header.Set("Authorization", "Bearer "+raw)
	if _, ok := src.User(post); ok {
		t.Fatal("bearer must never authenticate a write")
	}
	bad := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/progression", nil)
	bad.Header.Set("Authorization", "Bearer wrt_"+strings.Repeat("0", 64))
	if _, ok := src.User(bad); ok {
		t.Fatal("an unknown token must not authenticate")
	}

	// Revoke, then the token is dead.
	id, _ := first["id"].(string)
	if code, _ := call(t, mux, "alice", http.MethodDelete, "/api/tokens/"+id, ""); code != http.StatusNoContent {
		t.Fatalf("delete: got %d", code)
	}
	if _, ok := src.User(get); ok {
		t.Fatal("a revoked token must not authenticate")
	}
}
