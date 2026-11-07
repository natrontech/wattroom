package hub

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

type tableWins struct {
	mu  sync.Mutex
	got []string
}

func (w *tableWins) Won(channel, rider string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.got = append(w.got, channel+"/"+rider)
}

func (w *tableWins) all() []string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return append([]string(nil), w.got...)
}

// readTable reads a socket's messages until want takes one.
func readTable(t *testing.T, conn *websocket.Conn, what string, want func(protocol.ServerMessage) bool) protocol.ServerMessage {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 8*time.Second)
	defer cancel()
	for {
		var msg protocol.ServerMessage
		if err := wsjson.Read(ctx, conn, &msg); err != nil {
			t.Fatalf("waiting for %s: %v", what, err)
		}
		if want(msg) {
			return msg
		}
	}
}

func say(t *testing.T, conn *websocket.Conn, cmd protocol.ToeggeliCommand) {
	t.Helper()
	if err := wsjson.Write(t.Context(), conn, protocol.ClientMessage{Toeggeli: &cmd}); err != nil {
		t.Fatalf("send %s: %v", cmd.Op, err)
	}
}

func tableHub(t *testing.T) (*Hub, string, *tableWins) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	kept := &tableWins{}
	h.SetToeggeliKeeper(kept)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/channels/{id}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return h, "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/channels/velvet", kept
}

func TestToeggeliMatchIsWonAndKept(t *testing.T) {
	h, url, kept := tableHub(t)
	jan := dial(t, url, "jan:member")
	sven := dial(t, url, "sven:member")
	kai := dial(t, url, "kai:member")
	eventually(t, "three riders joined", func() bool { return h.Presence("velvet").Connected == 3 })

	say(t, jan, protocol.ToeggeliCommand{Op: protocol.ToeggeliChallenge, To: "sven"})
	invite := readTable(t, sven, "the challenge", func(m protocol.ServerMessage) bool { return m.Invite != nil }).Invite
	if invite.From != "jan" || invite.To != "sven" || invite.Gone {
		t.Fatalf("the challenge reads %+v", invite)
	}
	// Only the challenger can be accepted, and only by who was challenged.
	say(t, kai, protocol.ToeggeliCommand{Op: protocol.ToeggeliAccept, To: "jan"})
	if got := readTable(t, kai, "a refusal", func(m protocol.ServerMessage) bool { return m.Error != nil }); got.Error.Code != "invalid_request" {
		t.Fatalf("a stranger accepted: %+v", got.Error)
	}
	say(t, sven, protocol.ToeggeliCommand{Op: protocol.ToeggeliAccept, To: "jan"})

	// Everyone in the channel watches, a spectator too.
	match := readTable(t, kai, "the match", func(m protocol.ServerMessage) bool { return m.Toeggeli != nil }).Toeggeli
	if match.Left != "jan" || match.Right != "sven" || match.Phase != protocol.ToeggeliPlay {
		t.Fatalf("the match opened as %+v", match)
	}
	say(t, jan, protocol.ToeggeliCommand{Op: protocol.ToeggeliMove, Y: 0.9})
	readTable(t, kai, "jan's rods move", func(m protocol.ServerMessage) bool {
		return m.Toeggeli != nil && m.Toeggeli.LeftY == 0.9
	})
	// A spectator's move moves nothing.
	say(t, kai, protocol.ToeggeliCommand{Op: protocol.ToeggeliMove, Y: 0.1})

	// Four goals up, and the ball rolling into the right goal.
	rm := h.stateOf("velvet")
	rm.mu.Lock()
	rm.table.state.LeftGoals = 4
	rm.table.state.LeftY, rm.table.state.RightY = 0, 0
	rm.table.state.BallX, rm.table.state.BallY, rm.table.vx, rm.table.vy = 0.97, 0.5, 1.2, 0
	rm.mu.Unlock()
	over := readTable(t, sven, "the result", func(m protocol.ServerMessage) bool {
		return m.Toeggeli != nil && m.Toeggeli.Phase == protocol.ToeggeliOver
	}).Toeggeli
	if over.Winner != "jan" || over.LeftGoals != 5 || over.RightY != 0 {
		t.Fatalf("the result reads %+v", over)
	}
	eventually(t, "the win is kept", func() bool {
		got := kept.all()
		return len(got) == 1 && got[0] == "velvet/jan"
	})
	readTable(t, kai, "the table clears", func(m protocol.ServerMessage) bool {
		return m.Toeggeli != nil && m.Toeggeli.Phase == protocol.ToeggeliCleared
	})
	eventually(t, "the table is free", func() bool {
		rm.mu.Lock()
		defer rm.mu.Unlock()
		return rm.table == nil
	})
}

func TestToeggeliWalkAwayKeepsNoWin(t *testing.T) {
	h, url, kept := tableHub(t)
	jan := dial(t, url, "jan:member")
	sven := dial(t, url, "sven:member")
	eventually(t, "both riders joined", func() bool { return h.Presence("velvet").Connected == 2 })
	say(t, jan, protocol.ToeggeliCommand{Op: protocol.ToeggeliChallenge, To: "sven"})
	readTable(t, sven, "the challenge", func(m protocol.ServerMessage) bool { return m.Invite != nil })
	say(t, sven, protocol.ToeggeliCommand{Op: protocol.ToeggeliAccept, To: "jan"})
	readTable(t, jan, "the match", func(m protocol.ServerMessage) bool { return m.Toeggeli != nil })

	// A second challenge while the table is taken is turned away.
	say(t, sven, protocol.ToeggeliCommand{Op: protocol.ToeggeliChallenge, To: "jan"})
	if got := readTable(t, sven, "a refusal", func(m protocol.ServerMessage) bool { return m.Error != nil }); got.Error.Code != "conflict" {
		t.Fatalf("a busy table took a challenge: %+v", got.Error)
	}

	rm := h.stateOf("velvet")
	rm.mu.Lock()
	rm.table.state.RightGoals = 3
	rm.mu.Unlock()
	say(t, sven, protocol.ToeggeliCommand{Op: protocol.ToeggeliLeave})
	over := readTable(t, jan, "the walk-away", func(m protocol.ServerMessage) bool {
		return m.Toeggeli != nil && m.Toeggeli.Phase == protocol.ToeggeliOver
	}).Toeggeli
	if over.Ended != "left" || over.Winner != "" {
		t.Fatalf("a walk-away reads %+v", over)
	}
	if got := kept.all(); len(got) != 0 {
		t.Fatalf("a walk-away was kept as a win: %v", got)
	}
}
