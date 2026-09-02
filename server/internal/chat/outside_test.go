package chat

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// fakeLive stands in for the hub: it remembers what chat handed it.
type fakeLive struct {
	mu      sync.Mutex
	lines   []protocol.ChatLine
	changes []protocol.ChatReactionCount
}

func (f *fakeLive) PostChat(_ string, line protocol.ChatLine) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.lines = append(f.lines, line)
}

func (f *fakeLive) PostReaction(_ string, change protocol.ChatReactionCount) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.changes = append(f.changes, change)
}

// post runs one JSON POST as a user ("" = signed out) and decodes the answer.
func post(t *testing.T, mux *http.ServeMux, user, path, body string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if user != "" {
		req.Header.Set("X-Test-User", user)
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	var decoded map[string]any
	_ = json.NewDecoder(w.Body).Decode(&decoded)
	return w.Code, decoded
}

func readAt(t *testing.T, mux *http.ServeMux, user, slug string) float64 {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/rooms/"+slug+"/chat", nil)
	req.Header.Set("X-Test-User", user)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	var body struct {
		ReadAt float64 `json:"readAt"`
	}
	_ = json.NewDecoder(w.Body).Decode(&body)
	return body.ReadAt
}

func TestPostChatFromOutside(t *testing.T) {
	svc, mux, users, _ := setup(t)
	live := &fakeLive{}
	svc.SetLive(live)
	alice := users.byToken["alice"]

	// Boundary: no auth 401, non-member 403, unknown room 404 — and the
	// socket path's validation, as 400s with a field.
	cases := []struct {
		name string
		user string
		slug string
		body string
		want int
	}{
		{"signed out", "", "chat-cave", `{"text":"hi"}`, http.StatusUnauthorized},
		{"non-member", "cara", "chat-cave", `{"text":"hi"}`, http.StatusForbidden},
		{"unknown room", "alice", "no-such-room", `{"text":"hi"}`, http.StatusNotFound},
		{"nothing to say", "alice", "chat-cave", `{"text":"   "}`, http.StatusBadRequest},
		{"too long", "alice", "chat-cave", `{"text":"` + strings.Repeat("ü", 501) + `"}`, http.StatusBadRequest},
		{"junk image", "alice", "chat-cave", `{"text":"look","imageId":"nope"}`, http.StatusBadRequest},
		{"unknown field", "alice", "chat-cave", `{"text":"hi","from":"spoof"}`, http.StatusBadRequest},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if code, body := post(t, mux, c.user, "/api/rooms/"+c.slug+"/chat", c.body); code != c.want {
				t.Fatalf("%d %v, want %d", code, body, c.want)
			}
		})
	}
	if len(live.lines) != 0 {
		t.Fatalf("a refused post reached the room: %v", live.lines)
	}

	// Happy: the line is persisted, answered with its id, and handed to the
	// room with that same id on it — reactions work at once.
	code, body := post(t, mux, "alice", "/api/rooms/chat-cave/chat", `{"text":"  queue this one  "}`)
	if code != http.StatusOK {
		t.Fatalf("post: %d %v", code, body)
	}
	id, _ := body["id"].(string)
	if id == "" || body["from"] != "alice" || body["fromId"] != store.UUIDString(alice.ID) || body["text"] != "queue this one" {
		t.Fatalf("posted line: %v", body)
	}
	if len(live.lines) != 1 || live.lines[0].ID != id || live.lines[0].Text != "queue this one" || live.lines[0].FromID != store.UUIDString(alice.ID) {
		t.Fatalf("room got: %+v", live.lines)
	}
	_, messages := backlog(t, mux, "bob", "chat-cave")
	if len(messages) != 1 || messages[0]["id"] != id {
		t.Fatalf("backlog: %v", messages)
	}
	// Saying something is reading up to it: alice's stamp is set, bob's is not.
	if readAt(t, mux, "alice", "chat-cave") == 0 {
		t.Fatal("poster's read stamp not set")
	}
	if readAt(t, mux, "bob", "chat-cave") != 0 {
		t.Fatal("a reader who never opened the room has a read stamp")
	}
}

func TestReactFromOutside(t *testing.T) {
	svc, mux, users, _ := setup(t)
	live := &fakeLive{}
	svc.SetLive(live)
	bob := users.byToken["bob"]
	id, ok := svc.SaveChat(t.Context(), "chat-cave", store.UUIDString(bob.ID), "in", "")
	if !ok {
		t.Fatal("save failed")
	}

	cases := []struct {
		name string
		user string
		body string
		want int
	}{
		{"signed out", "", `{"messageId":"` + id + `","emoji":"flame"}`, http.StatusUnauthorized},
		{"non-member", "cara", `{"messageId":"` + id + `","emoji":"flame"}`, http.StatusForbidden},
		{"not a reaction", "alice", `{"messageId":"` + id + `","emoji":"<script>"}`, http.StatusBadRequest},
		{"no such message", "alice", `{"messageId":"not-a-uuid","emoji":"flame"}`, http.StatusNotFound},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if code, body := post(t, mux, c.user, "/api/rooms/chat-cave/chat/reactions", c.body); code != c.want {
				t.Fatalf("%d %v, want %d", code, body, c.want)
			}
		})
	}
	if code, _ := post(t, mux, "alice", "/api/rooms/no-such-room/chat/reactions", `{"messageId":"`+id+`","emoji":"flame"}`); code != http.StatusNotFound {
		t.Fatalf("unknown room: %d", code)
	}

	// On, then off: the total and the direction come back, and the room
	// hears both.
	code, body := post(t, mux, "alice", "/api/rooms/chat-cave/chat/reactions", `{"messageId":"`+id+`","emoji":"flame"}`)
	if code != http.StatusOK || body["count"] != float64(1) || body["added"] != true {
		t.Fatalf("toggle on: %d %v", code, body)
	}
	code, body = post(t, mux, "alice", "/api/rooms/chat-cave/chat/reactions", `{"messageId":"`+id+`","emoji":"flame"}`)
	if code != http.StatusOK || body["count"] != float64(0) || body["added"] != false {
		t.Fatalf("toggle off: %d %v", code, body)
	}
	if len(live.changes) != 2 || !live.changes[0].Added || live.changes[1].Added || live.changes[0].MessageID != id {
		t.Fatalf("room got: %+v", live.changes)
	}
}

func TestMarkReadFromOutside(t *testing.T) {
	svc, mux, users, room := setup(t)
	alice := users.byToken["alice"]
	bob := users.byToken["bob"]
	if _, ok := svc.SaveChat(t.Context(), "chat-cave", store.UUIDString(alice.ID), "warm-up at 7?", ""); !ok {
		t.Fatal("save failed")
	}

	for _, c := range []struct {
		name string
		user string
		slug string
		want int
	}{
		{"signed out", "", "chat-cave", http.StatusUnauthorized},
		{"non-member", "cara", "chat-cave", http.StatusForbidden},
		{"unknown room", "bob", "no-such-room", http.StatusNotFound},
	} {
		t.Run(c.name, func(t *testing.T) {
			if code, body := post(t, mux, c.user, "/api/rooms/"+c.slug+"/read", ""); code != c.want {
				t.Fatalf("%d %v, want %d", code, body, c.want)
			}
		})
	}

	// Bob has never opened the room: everything is new, no stamp.
	unread := func() int64 {
		n, err := svc.store.Queries.CountRoomUnread(t.Context(), db.CountRoomUnreadParams{RoomID: room.ID, UserID: bob.ID})
		if err != nil {
			t.Fatal(err)
		}
		return n
	}
	if unread() != 1 || readAt(t, mux, "bob", "chat-cave") != 0 {
		t.Fatalf("before: unread %d readAt %v", unread(), readAt(t, mux, "bob", "chat-cave"))
	}
	if code, body := post(t, mux, "bob", "/api/rooms/chat-cave/read", ""); code != http.StatusNoContent {
		t.Fatalf("read: %d %v", code, body)
	}
	if unread() != 0 || readAt(t, mux, "bob", "chat-cave") == 0 {
		t.Fatalf("after: unread %d readAt %v", unread(), readAt(t, mux, "bob", "chat-cave"))
	}
}
