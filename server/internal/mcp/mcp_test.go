package mcp

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

type fakeTokens struct{ user *db.User }

func (f *fakeTokens) FromRequest(r *http.Request) (db.User, bool) {
	if f.user == nil || r.Header.Get("Authorization") != "Bearer wrt_ok" {
		return db.User{}, false
	}
	return *f.user, true
}

func setup(t *testing.T) *http.ServeMux {
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
	mux := http.NewServeMux()
	New(st, &fakeTokens{user: &u}, slog.New(slog.DiscardHandler)).Register(mux)
	return mux
}

func rpc(t *testing.T, mux *http.ServeMux, auth, body string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/mcp", strings.NewReader(body))
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func TestAuthRequired(t *testing.T) {
	mux := setup(t)
	code, _ := rpc(t, mux, "", `{"jsonrpc":"2.0","id":1,"method":"initialize"}`)
	if code != http.StatusUnauthorized {
		t.Fatalf("no token must be 401, got %d", code)
	}
}

func TestHandshakeAndTools(t *testing.T) {
	mux := setup(t)

	code, body := rpc(t, mux, "Bearer wrt_ok", `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}`)
	result, _ := body["result"].(map[string]any)
	if code != http.StatusOK || result["protocolVersion"] != protocolVersion {
		t.Fatalf("initialize: got %d %v", code, body)
	}

	// A notification is acknowledged, not answered.
	code, _ = rpc(t, mux, "Bearer wrt_ok", `{"jsonrpc":"2.0","method":"notifications/initialized"}`)
	if code != http.StatusAccepted {
		t.Fatalf("notification: got %d", code)
	}

	_, body = rpc(t, mux, "Bearer wrt_ok", `{"jsonrpc":"2.0","id":2,"method":"tools/list"}`)
	tools, _ := body["result"].(map[string]any)["tools"].([]any)
	if len(tools) != 2 {
		t.Fatalf("expected 2 tools, got %v", body)
	}

	_, body = rpc(t, mux, "Bearer wrt_ok", `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_progression"}}`)
	content, _ := body["result"].(map[string]any)["content"].([]any)
	if len(content) != 1 {
		t.Fatalf("tools/call: got %v", body)
	}
	text, _ := content[0].(map[string]any)["text"].(string)
	if !strings.Contains(text, `"category"`) {
		t.Fatalf("progression payload missing category: %s", text)
	}

	_, body = rpc(t, mux, "Bearer wrt_ok", `{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"nope"}}`)
	if body["error"] == nil {
		t.Fatalf("unknown tool must error, got %v", body)
	}
}
