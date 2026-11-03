package hub

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// AuthorizeCrew admits as Authorize does: the X-Rider header is the member.
func (f fakeAccess) AuthorizeCrew(r *http.Request, crew string) (protocol.Rider, string, error) {
	rider, _, err := f.Authorize(r, crew)
	return rider, crew, err
}

const crewWorkout = `{"name":"Tempo","steps":[{"type":"steady","seconds":600,"target":0.8}]}`

func crewSessionServer(t *testing.T, h *Hub) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/crews/{crew}/sessions/{id}", h.HandleCrewSessionWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

// A crew's own session (docs/SESSIONS.md) runs in a room of its own: no
// voice channel names it, the crew's live list shows it, and another crew's
// does not.
func TestCrewSessionOpensItsOwnRoom(t *testing.T) {
	alice := protocol.Rider{ID: "alice", Name: "Alice", Role: "member", FtpWatts: 250}
	tests := []struct {
		name      string
		pick      protocol.Control
		wantCode  string
		wantLive  int
		wantPhase string
	}{
		{
			name:     "a workout counts down with its starter coaching",
			pick:     protocol.Control{WorkoutName: "Tempo", WorkoutJSON: crewWorkout},
			wantLive: 1, wantPhase: "countdown",
		},
		{
			name:     "a workout the engine cannot ride leaves no room behind",
			pick:     protocol.Control{WorkoutName: "Tempo", WorkoutJSON: `{"steps":[]}`},
			wantCode: "validation_error",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
			id, code, _ := h.OpenCrewSession("crew1", alice, tt.pick)
			if code != tt.wantCode {
				t.Fatalf("code = %q, want %q", code, tt.wantCode)
			}
			live := h.CrewSessions("crew1")
			if len(live) != tt.wantLive {
				t.Fatalf("live = %+v, want %d", live, tt.wantLive)
			}
			if len(h.CrewSessions("crew2")) != 0 {
				t.Fatal("another crew lists this crew's session")
			}
			if tt.wantLive == 0 {
				if n := len(h.liveChannels()); n != 0 {
					t.Fatalf("%d rooms left behind by a refusal", n)
				}
				return
			}
			got := live[0]
			if got.ID != id || got.Channel != "" || got.Phase != tt.wantPhase || got.Coach != "alice" {
				t.Fatalf("live = %+v, want id %s, no channel, %s, coached by alice", got, id, tt.wantPhase)
			}
		})
	}
}

// The socket admits a crew member to a session that is there, and makes none
// for an id nobody opened.
func TestCrewSessionSocket(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	h.SetCrewAccess(fakeAccess{})
	srv := crewSessionServer(t, h)
	base := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/crews/crew1/sessions/"
	alice := protocol.Rider{ID: "alice", Name: "alice", Role: "member", FtpWatts: 250}
	id, code, msg := h.OpenCrewSession("crew1", alice, protocol.Control{WorkoutName: "Tempo", WorkoutJSON: crewWorkout})
	if code != "" {
		t.Fatalf("open: %s %s", code, msg)
	}

	bob := dial(t, base+id, "bob:member")
	if tick := readTick(t, bob); tick.State.ID != id || tick.State.WorkoutName != "Tempo" {
		t.Fatalf("bob's tick = %+v, want session %s riding Tempo", tick.State, id)
	}

	for _, refused := range []struct{ name, url, rider string }{
		{"an id nobody opened", base + "6d4f6d1e-0000-4000-8000-000000000000", "bob:member"},
		{"no member at the door", base + id, ""},
	} {
		t.Run(refused.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
			defer cancel()
			conn, res, err := websocket.Dial(ctx, refused.url, &websocket.DialOptions{
				HTTPHeader: http.Header{"X-Rider": []string{refused.rider}},
			})
			if res != nil && res.Body != nil {
				_ = res.Body.Close()
			}
			if err == nil {
				_ = conn.CloseNow()
				t.Fatal("dial succeeded")
			}
		})
	}
	if n := len(h.liveChannels()); n != 1 {
		t.Fatalf("%d rooms, want the one session's", n)
	}

	// A ban takes the rider out of every crew session of the crew.
	h.KickCrew("crew1", "bob")
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	for {
		var m protocol.ServerMessage
		if err := wsjson.Read(ctx, bob, &m); err != nil {
			break
		}
	}
	if ctx.Err() != nil {
		t.Fatal("bob's socket outlived the kick")
	}
}

// A crew session's room holds its one session: once it has run and ended,
// another is another room, and its recap is never written over.
func TestCrewSessionRoomHoldsOneSession(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	var clock atomic.Int64 // read by the room's tick
	clock.Store(time.Unix(1_800_000_000, 0).UnixNano())
	h.now = func() time.Time { return time.Unix(0, clock.Load()) }
	alice := protocol.Rider{ID: "alice", Name: "Alice", Role: "member"}
	id, code, msg := h.OpenCrewSession("crew1", alice, protocol.Control{WorkoutName: "Tempo", WorkoutJSON: crewWorkout})
	if code != "" {
		t.Fatalf("open: %s %s", code, msg)
	}
	rm := h.stateOf(protocol.CrewSessionPlace("crew1", id))
	clock.Add(int64((countdownSeconds + 5) * time.Second))
	if code, msg := rm.control(protocol.Control{Action: "end"}, alice, h.now()); code != "" {
		t.Fatalf("end: %s %s", code, msg)
	}
	again := protocol.Control{Action: "pick", WorkoutName: "Tempo", WorkoutJSON: crewWorkout}
	if code, _ := rm.control(again, alice, h.now()); code != "conflict" {
		t.Fatalf("a second pick answered %q, want conflict", code)
	}
}
