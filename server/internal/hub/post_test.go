package hub

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// A line posted over HTTP (#468) rides the tick of the riders who are in
// the room, and only theirs: no room is created for it, and a room nobody
// holds open drops it — the backlog is what late arrivals read.
func TestPostChatReachesConnectedRiders(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/rooms/{slug}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/rooms/velvet"

	// Nobody has ever opened this room: the post must not conjure one.
	h.PostChat("nowhere", protocol.ChatLine{From: "kim", Text: "hello?"})
	h.mu.Lock()
	_, created := h.rooms["nowhere"]
	h.mu.Unlock()
	if created {
		t.Fatal("a post from outside created a room")
	}

	inside := dial(t, url, "jan:member")
	readTick(t, inside) // registered

	line := protocol.ChatLine{ID: "m1", From: "kim", FromID: "kim", Text: "queue this one", At: time.Now().UnixMilli()}
	h.PostChat("velvet", line)
	h.PostReaction("velvet", protocol.ChatReactionCount{MessageID: "m1", Emoji: "flame", Count: 1, By: "kim", Added: true})

	deadline := time.Now().Add(5 * time.Second)
	var gotLine, gotReact bool
	for (!gotLine || !gotReact) && time.Now().Before(deadline) {
		tick := readTick(t, inside)
		for _, got := range tick.Chat {
			if got == line {
				gotLine = true
			}
		}
		for _, got := range tick.ChatReactions {
			if got.MessageID == "m1" && got.Emoji == "flame" && got.Count == 1 && got.By == "kim" && got.Added {
				gotReact = true
			}
		}
	}
	if !gotLine || !gotReact {
		t.Fatalf("outside post did not reach the room: line %v reaction %v", gotLine, gotReact)
	}
}

func TestPostChatDropsForEmptyRoom(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	rm := h.room("velvet") // exists, but nobody is connected
	h.PostChat("velvet", protocol.ChatLine{From: "kim", Text: "anyone?"})
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if len(rm.chat) != 0 {
		// Queued for nobody, it would land twice on the next arrival: once
		// from the backlog, once from the first tick.
		t.Fatalf("empty room queued %d lines", len(rm.chat))
	}
}
