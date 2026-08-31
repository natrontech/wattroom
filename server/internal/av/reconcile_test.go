package av

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestReconcile drives one sweep against a fake LiveKit: a healthy room syncs
// its participant list, a 404 room syncs empty (restarted LiveKit has no
// memory), and a 500 room is left alone — don't-know must not wipe the radar.
func TestReconcile(t *testing.T) {
	lk := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/twirp/livekit.RoomService/ListParticipants" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
			t.Error("missing admin token")
		}
		var req struct {
			Room string `json:"room"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Error(err)
		}
		switch req.Room {
		case "alive":
			_, _ = w.Write([]byte(`{"participants":[{"identity":"u1","name":"Jan"},{"identity":"u2","name":"Kim"}]}`))
		case "gone":
			http.Error(w, `{"code":"not_found"}`, http.StatusNotFound)
		default:
			http.Error(w, "boom", http.StatusInternalServerError)
		}
	}))
	defer lk.Close()

	sink := &fakeSink{rooms: []string{"alive", "gone", "flaky"}}
	svc := New(Config{URL: lk.URL, Key: "devkey", Secret: "secret"}, nil, slog.New(slog.DiscardHandler))
	svc.SetVoiceSink(sink)
	svc.reconcile(t.Context())

	if got := sink.synced["alive"]; len(got) != 2 || got["u1"] != "Jan" || got["u2"] != "Kim" {
		t.Fatalf("alive: %v", got)
	}
	if got, ok := sink.synced["gone"]; !ok || len(got) != 0 {
		t.Fatalf("gone: %v (ok=%v)", got, ok)
	}
	if _, ok := sink.synced["flaky"]; ok {
		t.Fatal("a failed LiveKit answer must not sync anything")
	}
}
