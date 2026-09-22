package chat

import (
	"net/http"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store"
)

func TestEditChannelMessage(t *testing.T) {
	w := channelSetup(t)
	alice := w.users.ByToken["alice"]
	id := w.say(t, "alice", w.open, "warmup at 6")
	before := w.pings()

	// Boundary, in the order errors.md asks for: no auth, not in the crew, not
	// the sender, no such message, over the cap, edited down to nothing.
	cases := []struct {
		name string
		user string
		path string
		body string
		want int
	}{
		{"signed out", "", id, `{"text":"mine now"}`, http.StatusUnauthorized},
		{"not in the crew", "dave", id, `{"text":"mine now"}`, http.StatusNotFound},
		{"not the sender", "bob", id, `{"text":"mine now"}`, http.StatusForbidden},
		{"junk id", "alice", "not-a-uuid", `{"text":"fixed"}`, http.StatusNotFound},
		{"unknown message", "alice", store.UUIDString(alice.ID), `{"text":"fixed"}`, http.StatusNotFound},
		{"too long", "alice", id, `{"text":"` + strings.Repeat("ü", 501) + `"}`, http.StatusBadRequest},
		{"edited to nothing", "alice", id, `{"text":"   "}`, http.StatusBadRequest},
		{"unknown field", "alice", id, `{"text":"fixed","from":"spoof"}`, http.StatusBadRequest},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if code, body := patch(t, w.mux, c.user, "/api/channels/"+w.open+"/chat/"+c.path, c.body); code != c.want {
				t.Fatalf("%d %v, want %d", code, body, c.want)
			}
		})
	}
	// A channel that is not there must not be an oracle either.
	if code, _ := patch(t, w.mux, "alice", "/api/channels/not-a-channel/chat/"+id, `{"text":"fixed"}`); code != http.StatusNotFound {
		t.Fatalf("unknown channel: %d", code)
	}
	if n := w.pings() - before; n != 0 {
		t.Fatalf("a refused edit pinged the lobby %d times", n)
	}

	// Happy: the new text comes back stamped, the lobby is told, and the
	// backlog reads the way the sender left it.
	code, body := patch(t, w.mux, "alice", "/api/channels/"+w.open+"/chat/"+id, `{"text":"  warmup at 7  "}`)
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
	if n := w.pings() - before; n != 1 {
		t.Fatalf("the edit pinged the lobby %d times, want 1", n)
	}
	messages := w.messages(t, "bob", w.open)
	if len(messages) != 1 || messages[0]["text"] != "warmup at 7" {
		t.Fatalf("backlog: %v", messages)
	}
	if edited, _ := messages[0]["editedAt"].(float64); edited != stamp {
		t.Fatalf("backlog stamp %v, want %v", messages[0]["editedAt"], stamp)
	}
}

func TestEditKeepsAnImageWhenTheWordsGo(t *testing.T) {
	w := channelSetup(t)
	_, img := w.upload(t, "alice", w.open, tinyPNG)
	if img == "" {
		t.Fatal("upload failed")
	}
	status, body := post(t, w.mux, "alice", "/api/channels/"+w.open+"/chat", `{"text":"look at this","imageId":"`+img+`"}`)
	if status != http.StatusOK {
		t.Fatalf("send: %d %v", status, body)
	}
	id, _ := body["id"].(string)

	// A caption can be taken back; the picture is not the caption.
	if code, body := patch(t, w.mux, "alice", "/api/channels/"+w.open+"/chat/"+id, `{"text":""}`); code != http.StatusOK {
		t.Fatalf("clear caption: %d %v", code, body)
	}
	messages := w.messages(t, "alice", w.open)
	if len(messages) != 1 || messages[0]["text"] != "" {
		t.Fatalf("caption not cleared: %v", messages)
	}
	if messages[0]["imageId"] != img {
		t.Fatalf("image lost with the words: %v", messages)
	}
}
