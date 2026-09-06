package chat

import (
	"net/http"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

func TestEditChatMessage(t *testing.T) {
	svc, mux, users, _ := setup(t)
	live := &fakeLive{}
	svc.SetLive(live)
	alice := users.byToken["alice"]
	id, ok := svc.SaveChat(t.Context(), "chat-cave", store.UUIDString(alice.ID), "warmup at 6", "")
	if !ok {
		t.Fatal("save failed")
	}

	// Boundary, in the order errors.md asks for: no auth, not a member, not
	// the sender, no such message, over the cap, edited down to nothing.
	cases := []struct {
		name string
		user string
		path string
		body string
		want int
	}{
		{"signed out", "", id, `{"text":"mine now"}`, http.StatusUnauthorized},
		{"non-member", "cara", id, `{"text":"mine now"}`, http.StatusForbidden},
		{"not the sender", "bob", id, `{"text":"mine now"}`, http.StatusForbidden},
		{"junk id", "alice", "not-a-uuid", `{"text":"fixed"}`, http.StatusNotFound},
		{"unknown message", "alice", store.UUIDString(alice.ID), `{"text":"fixed"}`, http.StatusNotFound},
		{"too long", "alice", id, `{"text":"` + strings.Repeat("ü", 501) + `"}`, http.StatusBadRequest},
		{"edited to nothing", "alice", id, `{"text":"   "}`, http.StatusBadRequest},
		{"unknown field", "alice", id, `{"text":"fixed","from":"spoof"}`, http.StatusBadRequest},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if code, body := patch(t, mux, c.user, "/api/rooms/chat-cave/chat/"+c.path, c.body); code != c.want {
				t.Fatalf("%d %v, want %d", code, body, c.want)
			}
		})
	}
	// A room the caller is not in must not be an oracle either.
	if code, _ := patch(t, mux, "alice", "/api/rooms/no-such-room/chat/"+id, `{"text":"fixed"}`); code != http.StatusNotFound {
		t.Fatalf("unknown room: %d", code)
	}
	if len(live.edits) != 0 {
		t.Fatalf("a refused edit reached the room: %v", live.edits)
	}

	// Happy: the new text comes back stamped, the room is told, and the
	// backlog reads the way the sender left it.
	code, body := patch(t, mux, "alice", "/api/rooms/chat-cave/chat/"+id, `{"text":"  warmup at 7  "}`)
	if code != http.StatusOK {
		t.Fatalf("edit: %d %v", code, body)
	}
	if body["messageId"] != id || body["text"] != "warmup at 7" {
		t.Fatalf("edited line: %v", body)
	}
	stamp, _ := body["editedAt"].(float64)
	if stamp <= 0 {
		t.Fatalf("no edit stamp: %v", body)
	}
	if len(live.edits) != 1 || live.edits[0].MessageID != id || live.edits[0].Text != "warmup at 7" {
		t.Fatalf("room got: %+v", live.edits)
	}
	_, messages := backlog(t, mux, "bob", "chat-cave")
	if len(messages) != 1 || messages[0]["text"] != "warmup at 7" {
		t.Fatalf("backlog: %v", messages)
	}
	if edited, _ := messages[0]["editedAt"].(float64); edited != stamp {
		t.Fatalf("backlog stamp %v, want %v", messages[0]["editedAt"], stamp)
	}
}

func TestEditKeepsAnImageWhenTheWordsGo(t *testing.T) {
	svc, mux, users, room := setup(t)
	svc.SetLive(&fakeLive{})
	alice := users.byToken["alice"]
	img, err := svc.store.Queries.SaveChatImage(t.Context(), db.SaveChatImageParams{
		RoomID: room.ID, UserID: alice.ID, Mime: "image/png", Bytes: []byte("\x89PNG\r\n\x1a\npretend"),
	})
	if err != nil {
		t.Fatal(err)
	}
	id, ok := svc.SaveChat(t.Context(), "chat-cave", store.UUIDString(alice.ID), "look at this", store.UUIDString(img))
	if !ok {
		t.Fatal("save failed")
	}

	// A caption can be taken back; the picture is not the caption.
	if code, body := patch(t, mux, "alice", "/api/rooms/chat-cave/chat/"+id, `{"text":""}`); code != http.StatusOK {
		t.Fatalf("clear caption: %d %v", code, body)
	}
	_, messages := backlog(t, mux, "alice", "chat-cave")
	if len(messages) != 1 || messages[0]["text"] != "" {
		t.Fatalf("caption not cleared: %v", messages)
	}
	if messages[0]["imageId"] != store.UUIDString(img) {
		t.Fatalf("image lost with the words: %v", messages)
	}
}
