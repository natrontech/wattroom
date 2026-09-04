package hub

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

func TestQueuePokeTargetsEverySocketOfOneRider(t *testing.T) {
	rm := newRoom("velvet")
	sender := &client{rider: protocol.Rider{ID: "jan"}}
	targetDesk := &client{rider: protocol.Rider{ID: "sven"}}
	targetPhone := &client{rider: protocol.Rider{ID: "sven"}}
	other := &client{rider: protocol.Rider{ID: "kai"}}
	for _, c := range []*client{sender, targetDesk, targetPhone, other} {
		rm.join(c)
	}

	want := protocol.Poke{To: "sven", FromID: "jan", From: "jan", At: 42}
	if !rm.queuePoke("sven", want) {
		t.Fatal("connected target was not found")
	}

	rm.mu.Lock()
	queued := rm.drainPokesLocked()
	rm.mu.Unlock()
	if len(queued) != 2 {
		t.Fatalf("queued for %d sockets, want the target's 2", len(queued))
	}
	for _, c := range []*client{targetDesk, targetPhone} {
		if got := queued[c]; len(got) != 1 || got[0] != want {
			t.Errorf("target socket got %+v, want %+v", got, want)
		}
	}
	if queued[sender] != nil || queued[other] != nil {
		t.Fatal("poke leaked to an unaddressed rider")
	}
}

func TestPokeCooldownIsPerSenderAndTarget(t *testing.T) {
	rm := newRoom("velvet")
	now := time.Unix(100, 0)
	if !rm.allow("poke:sven", "jan", now, pokeCooldown) {
		t.Fatal("first poke was refused")
	}
	if rm.allow("poke:sven", "jan", now, pokeCooldown) {
		t.Fatal("same sender-target pair escaped the cooldown")
	}
	if !rm.allow("poke:kai", "jan", now, pokeCooldown) {
		t.Fatal("a different target shared the cooldown")
	}
	if !rm.allow("poke:sven", "ruben", now, pokeCooldown) {
		t.Fatal("a different sender shared the cooldown")
	}
	if !rm.allow("poke:sven", "jan", now.Add(pokeCooldown), pokeCooldown) {
		t.Fatal("cooldown did not expire")
	}
}

func readPoke(t *testing.T, conn *websocket.Conn) protocol.Poke {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 4*time.Second)
	defer cancel()
	for {
		var message protocol.ServerMessage
		if err := wsjson.Read(ctx, conn, &message); err != nil {
			t.Fatalf("read poke: %v", err)
		}
		if message.Poke != nil {
			return *message.Poke
		}
	}
}

func TestPokeUsesAuthenticatedSender(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/rooms/{slug}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/rooms/velvet"

	sender := dial(t, url, "jan:member")
	target := dial(t, url, "sven:member")
	eventually(t, "both riders joined", func() bool {
		return h.Presence("velvet").Connected == 2
	})

	if err := wsjson.Write(t.Context(), sender, protocol.ClientMessage{
		Poke: &protocol.Poke{To: "sven", FromID: "forged", From: "forged", At: 1},
	}); err != nil {
		t.Fatalf("send poke: %v", err)
	}
	got := readPoke(t, target)
	if got.To != "sven" || got.FromID != "jan" || got.From != "jan" || got.At <= 1 {
		t.Fatalf("routed poke trusted client sender fields: %+v", got)
	}
}

// A cooldown that drops in silence reads as a broken button, and the sender
// pokes again — the failure errors.md exists to prevent.
func TestPokeOnCooldownTellsTheSender(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/rooms/{slug}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/rooms/velvet"

	sender := dial(t, url, "jan:member")
	dial(t, url, "sven:member")
	eventually(t, "both riders joined", func() bool {
		return h.Presence("velvet").Connected == 2
	})

	for range 2 {
		if err := wsjson.Write(t.Context(), sender, protocol.ClientMessage{
			Poke: &protocol.Poke{To: "sven"},
		}); err != nil {
			t.Fatalf("send poke: %v", err)
		}
	}

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
		var msg protocol.ServerMessage
		err := wsjson.Read(ctx, sender, &msg)
		cancel()
		if err != nil {
			t.Fatalf("read: %v", err)
		}
		if msg.Error != nil {
			if msg.Error.Message == "" {
				t.Fatalf("refusal carried no message: %+v", msg.Error)
			}
			return
		}
	}
	t.Fatal("the second poke was dropped without a word to the sender")
}
