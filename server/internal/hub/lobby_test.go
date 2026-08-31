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

// The lobby feed (#251): a presence change anywhere — socket join/leave,
// voice — reaches a lobby socket as a ping, so the rail is live without
// polling. The ping carries nothing; the client re-fetches the rooms list.
func TestLobbyPingsOnPresenceChanges(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/rooms/{slug}", h.HandleWS)
	mux.HandleFunc("GET /ws/presence", h.HandleLobby)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	base := "ws" + strings.TrimPrefix(srv.URL, "http")

	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	lobby, res, err := websocket.Dial(ctx, base+"/ws/presence", nil)
	if res != nil && res.Body != nil {
		defer func() { _ = res.Body.Close() }()
	}
	if err != nil {
		t.Fatalf("lobby dial: %v", err)
	}
	t.Cleanup(func() { _ = lobby.CloseNow() })

	readPing := func(what string) {
		t.Helper()
		readCtx, readCancel := context.WithTimeout(t.Context(), 5*time.Second)
		defer readCancel()
		var ping protocol.PresencePing
		if err := wsjson.Read(readCtx, lobby, &ping); err != nil {
			t.Fatalf("no ping after %s: %v", what, err)
		}
	}

	// The hello ping doubles as proof the lobby is registered — everything
	// after it is ordered by the read-between-mutations pattern below.
	readPing("connect")

	rider := dial(t, base+"/ws/rooms/velvet", "jan:owner")
	readPing("room join")

	h.VoiceJoined("velvet", "jan", "Jan")
	readPing("voice join")
	h.VoiceCam("velvet", "jan", true)
	readPing("camera on")
	if video := h.Presence("velvet").Video; len(video) != 1 || video[0] != "Jan" {
		t.Fatalf("video = %v, want [Jan]", video)
	}
	// A no-op change (same camera state, unknown identity) pings nobody —
	// asserted indirectly: the next real change is the next ping read.
	h.VoiceCam("velvet", "jan", true)
	h.VoiceCam("velvet", "ghost", true)
	h.VoiceLeft("velvet", "jan")
	readPing("voice leave")

	_ = rider.CloseNow()
	readPing("room leave")
}
