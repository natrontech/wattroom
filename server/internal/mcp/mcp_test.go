package mcp

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
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

// post is one JSON-RPC round trip as the token's owner.
func post(t *testing.T, mux *http.ServeMux, body string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/mcp", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer wrt_ok")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func rpcErr(body map[string]any) (float64, string) {
	e, _ := body["error"].(map[string]any)
	code, _ := e["code"].(float64)
	msg, _ := e["message"].(string)
	return code, msg
}

// The transport's edges (#1758): an out-of-range limit is refused rather
// than silently 30, a batch is -32600, a parse error carries "id": null, and
// list_rides answers ids and a `more` flag.
func TestTransportEdges(t *testing.T) {
	mux := setup(t)
	if _, body := post(t, mux, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_rides","arguments":{"limit":5000}}}`); true {
		if code, msg := rpcErr(body); code != -32602 || !strings.Contains(msg, "1-200") {
			t.Fatalf("limit 5000: %v", body["error"])
		}
	}
	if _, body := post(t, mux, `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_rides","arguments":"banana"}}`); true {
		if code, _ := rpcErr(body); code != -32602 {
			t.Fatalf("string arguments: %v", body["error"])
		}
	}
	if _, body := post(t, mux, `[{"jsonrpc":"2.0","id":3,"method":"ping"}]`); true {
		code, _ := rpcErr(body)
		if code != -32600 {
			t.Fatalf("a batch: %v", body["error"])
		}
		if id, has := body["id"]; !has || id != nil {
			t.Fatalf("a refused batch must carry id null: %v", body)
		}
	}
	if _, body := post(t, mux, `{not json`); true {
		if code, _ := rpcErr(body); code != -32700 {
			t.Fatalf("garbage: %v", body["error"])
		}
	}
	_, body := post(t, mux, `{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"list_rides","arguments":{"limit":1}}}`)
	result, _ := body["result"].(map[string]any)
	content, _ := result["content"].([]any)
	if len(content) != 1 {
		t.Fatalf("list_rides result: %v", body)
	}
	first, _ := content[0].(map[string]any)
	var payload struct {
		Rides []map[string]any `json:"rides"`
		More  bool             `json:"more"`
	}
	text, _ := first["text"].(string)
	if err := json.Unmarshal([]byte(text), &payload); err != nil {
		t.Fatalf("payload: %v", err)
	}
	if _, has := payload.More, true; !has {
		t.Fatal("no more flag")
	}
	for _, ride := range payload.Rides {
		if _, has := ride["id"]; !has {
			t.Fatalf("a ride without an id: %v", ride)
		}
	}
}
