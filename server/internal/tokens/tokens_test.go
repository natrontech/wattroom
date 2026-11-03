package tokens

import (
	"context"
	"encoding/json"
	"github.com/natrontech/wattroom/server/internal/testx"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
)

// alarms records the ADR-0030 alarms a mint raised, by owner.
type alarms struct {
	mu     sync.Mutex
	minted []string
}

func (a *alarms) TokenMinted(user db.User) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.minted = append(a.minted, user.DisplayName)
}

func setup(t *testing.T) (*http.ServeMux, *Service) {
	t.Helper()
	st := storetest.Open(t)

	u, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{
		DisplayName: "alice", FtpWatts: 250, WeightKg: 70,
	})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID)
	})
	bob, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{
		DisplayName: "bob", FtpWatts: 220, WeightKg: 80,
	})
	if err != nil {
		t.Fatalf("create bob: %v", err)
	}
	t.Cleanup(func() {
		_, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", bob.ID)
	})
	users := &testx.Users{ByToken: map[string]db.User{"alice": u, "bob": bob}}
	svc := New(st, users, &alarms{}, slog.New(slog.DiscardHandler))
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
	src := svc.ReadSource(&testx.Users{ByToken: map[string]db.User{}})
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

// A token outlives the session that minted it, so minting one is an ADR-0030
// alarm (#2811): a borrowed session's last move must not be a silent one. A
// refused mint minted nothing and says nothing.
func TestMintingATokenRaisesTheAlarm(t *testing.T) {
	mux, svc := setup(t)
	rang, _ := svc.alarm.(*alarms)

	if code, _ := call(t, mux, "alice", http.MethodPost, "/api/tokens", `{"name":""}`); code != http.StatusBadRequest {
		t.Fatalf("empty name must be 400, got %d", code)
	}
	if len(rang.minted) != 0 {
		t.Fatalf("a refused mint alarmed: %v", rang.minted)
	}
	if code, _ := call(t, mux, "alice", http.MethodPost, "/api/tokens", `{"name":"planted"}`); code != http.StatusCreated {
		t.Fatalf("create: got %d", code)
	}
	if len(rang.minted) != 1 || rang.minted[0] != "alice" {
		t.Fatalf("minting did not alarm the owner once: %v", rang.minted)
	}
}

// A token writes only when the rider ticked it at minting (#4207): absent is
// read-only, the list says which is which, and a bearer — any bearer — is
// still refused on the HTTP write path.
func TestOnlyATokenMarkedForPlanningWrites(t *testing.T) {
	mux, svc := setup(t)
	minted := map[bool]string{}
	for _, write := range []bool{false, true} {
		body := `{"name":"coach"}`
		if write {
			body = `{"name":"planner","write":true}`
		}
		code, out := call(t, mux, "alice", http.MethodPost, "/api/tokens", body)
		if code != http.StatusCreated || (out["write"] == true) != write {
			t.Fatalf("create write=%v: %d %v", write, code, out)
		}
		minted[write], _ = out["token"].(string)
	}
	bearer := func(method, token string) *http.Request {
		req := httptest.NewRequestWithContext(t.Context(), method, "/api/rides/1", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		return req
	}
	if svc.CanWrite(bearer(http.MethodPost, minted[false])) {
		t.Error("a token minted without the tick writes")
	}
	if !svc.CanWrite(bearer(http.MethodPost, minted[true])) {
		t.Error("a token minted for planning does not write")
	}
	if svc.CanWrite(bearer(http.MethodPost, "wrt_"+strings.Repeat("0", 64))) {
		t.Error("an unknown token writes")
	}
	_, list := call(t, mux, "alice", http.MethodGet, "/api/tokens", "")
	entries, _ := list["tokens"].([]any)
	if len(entries) != 2 {
		t.Fatalf("listed %v", list)
	}
	for _, entry := range entries {
		e, _ := entry.(map[string]any)
		if (e["write"] == true) != (e["name"] == "planner") {
			t.Errorf("listed %v", e)
		}
	}
	// The HTTP bearer path stays GET-only, planning token or not.
	read := svc.ReadSource(&testx.Users{})
	if _, ok := read.RequireUser(httptest.NewRecorder(), bearer(http.MethodDelete, minted[true]), "Sign in."); ok {
		t.Error("a planning token deleted over HTTP")
	}
}
