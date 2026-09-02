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

// The lobby socket (#251): holding it is being online, every presence change
// pings it, and closing it is going offline — the Slack green dot, derived
// from connection state instead of heartbeats.
func TestLobbyPresence(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	h.SetLobbyAuth(func(r *http.Request) (string, bool) {
		v := r.Header.Get("X-Rider")
		if v == "" {
			return "", false
		}
		name, _, _ := strings.Cut(v, ":")
		return name, true
	})
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/rooms/{slug}", h.HandleWS)
	mux.HandleFunc("GET /ws/presence", h.HandleLobbyWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	base := "ws" + strings.TrimPrefix(srv.URL, "http")

	// No session, no socket.
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	_, res, err := websocket.Dial(ctx, base+"/ws/presence", nil)
	if res != nil && res.Body != nil {
		defer func() { _ = res.Body.Close() }()
	}
	if err == nil || res == nil || res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("stranger was not refused with 401 (err %v)", err)
	}

	lobby := dial(t, base+"/ws/presence", "jan:member")

	// Holding the lobby socket IS being online — no room involved. Present in
	// the map with "" = online; absent = offline. The handler registers the
	// client just after the handshake it returned from, so this waits for that
	// rather than assuming it has already happened (#307).
	eventually(t, "jan reads lobby-online", func() bool {
		slug, online := h.WhereIs([]string{"jan"})["jan"]
		return online && slug == ""
	})
	if _, online := h.WhereIs([]string{"sven"})["sven"]; online {
		t.Fatalf("sven reads online without any socket")
	}

	// A room join elsewhere pings the lobby — the client's cue to re-fetch.
	// Two messages guaranteed: jan's own coming-online, then sven's join.
	dial(t, base+"/ws/rooms/velvet", "sven:member")
	for range 2 {
		readCtx, readCancel := context.WithTimeout(t.Context(), 5*time.Second)
		_, _, err := lobby.Read(readCtx)
		readCancel()
		if err != nil {
			t.Fatalf("lobby ping never arrived: %v", err)
		}
	}

	where := h.WhereIs([]string{"jan", "sven"})
	if where["sven"] != "velvet" {
		t.Fatalf("sven's room: %q", where["sven"])
	}
	if slug, online := where["jan"]; !online || slug != "" {
		t.Fatalf("jan after sven joined: %q %v", slug, online)
	}

	// Closing the socket is going offline — no timeout window to wait out.
	_ = lobby.CloseNow()
	eventually(t, "jan reads offline after closing the lobby socket", func() bool {
		_, online := h.WhereIs([]string{"jan"})["jan"]
		return !online
	})
}

// The landing page's live number: distinct riders holding a lobby socket. Two
// tabs are one rider, and the count drops when the last one closes.
func TestOnlineCount(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	h.SetLobbyAuth(func(r *http.Request) (string, bool) {
		name, _, _ := strings.Cut(r.Header.Get("X-Rider"), ":")
		return name, name != ""
	})
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/presence", h.HandleLobbyWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	base := "ws" + strings.TrimPrefix(srv.URL, "http")

	if n := h.OnlineCount(); n != 0 {
		t.Fatalf("empty hub counts %d online", n)
	}
	tabs := []*websocket.Conn{
		dial(t, base+"/ws/presence", "jan:member"),
		dial(t, base+"/ws/presence", "jan:member"),
	}
	dial(t, base+"/ws/presence", "sven:member")
	eventually(t, "jan's two tabs and sven count as two riders", func() bool {
		return h.OnlineCount() == 2
	})

	for _, c := range tabs {
		_ = c.CloseNow()
	}
	eventually(t, "count drops when jan's last tab closes", func() bool {
		return h.OnlineCount() == 1
	})
}

// A line said in a room pings the lobby (#568): a rider who is NOT standing
// in that room announces it off the unread count the ping tells them to
// re-fetch, and before this only phase and riding changes woke the lobby —
// so a message waited on the client's 60 s fallback poll.
func TestChatPingsTheLobby(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	h.SetLobbyAuth(func(r *http.Request) (string, bool) {
		name, _, _ := strings.Cut(r.Header.Get("X-Rider"), ":")
		return name, name != ""
	})
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/rooms/{slug}", h.HandleWS)
	mux.HandleFunc("GET /ws/presence", h.HandleLobbyWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	base := "ws" + strings.TrimPrefix(srv.URL, "http")

	// Jan is in the lobby and nowhere else; sven is in the room talking.
	lobby := dial(t, base+"/ws/presence", "jan:member")
	sven := dial(t, base+"/ws/rooms/velvet", "sven:member")
	readTick(t, sven)

	// Pings coalesce into a one-deep channel, so counting the ones the
	// arrivals cause proves nothing. Read them off the socket in the
	// background and wait for the lobby to fall QUIET instead — a room that
	// is idle and nobody riding pings on nothing else.
	pings := make(chan struct{}, 16)
	go func() {
		defer close(pings)
		for {
			if _, _, err := lobby.Read(context.Background()); err != nil {
				return
			}
			pings <- struct{}{}
		}
	}()
	for quiet := false; !quiet; {
		select {
		case _, open := <-pings:
			if !open {
				t.Fatal("lobby socket closed while the arrivals settled")
			}
		case <-time.After(500 * time.Millisecond):
			quiet = true
		}
	}

	if err := wsjson.Write(t.Context(), sven, protocol.ClientMessage{
		Chat: &protocol.ChatLine{Text: "queue this one"},
	}); err != nil {
		t.Fatalf("send: %v", err)
	}

	select {
	case _, open := <-pings:
		if !open {
			t.Fatal("lobby socket closed")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("a line said in velvet never pinged the lobby")
	}
}
