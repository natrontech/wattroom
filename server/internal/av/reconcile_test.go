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
		if r.URL.Path == "/twirp/livekit.RoomService/ListRooms" {
			_, _ = w.Write([]byte(`{"rooms":[]}`))
			return
		}
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

// Whether LiveKit answers at all is asked every sweep, and above all with
// nobody in voice (#2850): that is the state a first join meets, and it is
// the one the participant sweep never asks about. Any answer from the
// RoomService is "up"; a call that fails is "down"; and the next answer
// brings it back.
func TestReconcileLearnsWhetherLiveKitAnswers(t *testing.T) {
	up := true
	lk := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !up {
			http.Error(w, "bad gateway", http.StatusBadGateway)
			return
		}
		_, _ = w.Write([]byte(`{"rooms":[]}`))
	}))
	defer lk.Close()
	svc := New(Config{URL: lk.URL, Key: "devkey", Secret: "secret"}, nil, slog.New(slog.DiscardHandler))
	svc.SetVoiceSink(&fakeSink{})

	svc.reconcile(t.Context())
	if !svc.Reachable() {
		t.Fatal("a LiveKit that answers reads as down")
	}
	up = false
	svc.reconcile(t.Context())
	if svc.Reachable() {
		t.Fatal("a LiveKit that answers 502 with nobody in voice reads as up")
	}
	up = true
	svc.reconcile(t.Context())
	if !svc.Reachable() {
		t.Fatal("LiveKit came back and the service still says it is down")
	}

	lk.Close()
	svc.reconcile(t.Context())
	if svc.Reachable() {
		t.Fatal("a LiveKit nobody can connect to reads as up")
	}
}
