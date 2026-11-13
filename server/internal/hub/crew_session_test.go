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

// A voice channel shows who in it rides a crew session, and which one, from
// the session's own tick: the riding mark and the session's id, never a
// number of theirs (docs/SESSIONS.md).
func TestVoiceChannelShowsItsSessionRiders(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	h.SetCrewAccess(fakeAccess{})
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/channels/{id}", h.HandleWS)
	mux.HandleFunc("GET /ws/crews/{crew}/sessions/{id}", h.HandleCrewSessionWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	ws := "ws" + strings.TrimPrefix(srv.URL, "http")

	alice := protocol.Rider{ID: "alice", Name: "alice", Role: "member", FtpWatts: 250}
	id, code, msg := h.OpenCrewSession("crew1", alice, protocol.Control{WorkoutName: "Tempo", WorkoutJSON: crewWorkout})
	if code != "" {
		t.Fatalf("open: %s %s", code, msg)
	}
	call := dial(t, ws+"/ws/channels/lounge", "alice:member")
	ride := dial(t, ws+"/ws/crews/crew1/sessions/"+id, "alice:member")
	for seq := 1; seq <= 3; seq++ {
		if err := wsjson.Write(t.Context(), ride, protocol.ClientMessage{
			Metrics: &protocol.RiderMetrics{Watts: 200, Cadence: 90, Seq: seq},
		}); err != nil {
			t.Fatalf("metrics: %v", err)
		}
	}
	for range 10 {
		tick := readTick(t, call)
		for _, r := range tick.Roster {
			if r.ID == "alice" && r.OnSession == id && r.Riding {
				if _, numbers := tick.Riders["alice"]; numbers {
					t.Fatal("the call carries the session rider's numbers")
				}
				return
			}
		}
	}
	t.Fatal("the call never showed alice riding her session")
}

// Riding together (docs/SESSIONS.md) runs at once with no workout and no
// clock to end it, and saves no ride of its own: each rider's free ride is
// theirs. The coach ends it.
func TestRideTogether(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	var clock atomic.Int64
	clock.Store(time.Unix(1_800_000_000, 0).UnixNano())
	h.now = func() time.Time { return time.Unix(0, clock.Load()) }
	alice := protocol.Rider{ID: "alice", Name: "Alice", Role: "member"}
	id := h.OpenRideTogether("crew1", alice)

	live := h.CrewSessions("crew1")
	if len(live) != 1 || live[0].ID != id || live[0].Phase != "running" || live[0].Workout != "Ride together" {
		t.Fatalf("live = %+v, want Ride together running", live)
	}
	rm := h.stateOf(protocol.CrewSessionPlace("crew1", id))
	clock.Add(int64(3 * time.Hour))
	rm.mu.Lock()
	state := rm.session.state(h.now())
	rm.mu.Unlock()
	if state.Phase != "running" || !state.Together {
		t.Fatalf("three hours in: %+v, want still running, together", state)
	}
	// Ended and closed under one hold of the lock, so the room's own tick
	// cannot close it first.
	rm.mu.Lock()
	rm.session.end(h.now())
	end := rm.closeLocked(rm.session.state(h.now()), h.now(), true)
	rm.mu.Unlock()
	if end == nil || len(end.records) != 0 {
		t.Fatalf("close = %+v, want a close with no rides of its own", end)
	}
}

// A plan and a game started from a call open sessions of the crew's own
// (docs/SESSIONS.md): each in a room of its own, and no voice channel holds
// one, so a call keeps its room while they ride.
func TestPlansAndGamesOpenCrewSessions(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	alice := protocol.Rider{ID: "alice", Name: "Alice", Role: "member", FtpWatts: 250}
	plan, code, msg := h.OpenSession(protocol.CrewSessionPlace("crew1", ""), alice, "Tempo", crewWorkout, nil, "", "", nil)
	if code != "" {
		t.Fatalf("plan: %s %s", code, msg)
	}
	game, code, msg := h.OpenCrewGame("crew1", alice, protocol.Control{GameMode: "points-race"})
	if code != "" {
		t.Fatalf("game: %s %s", code, msg)
	}
	live := h.CrewSessions("crew1")
	ids := map[string]string{}
	for _, l := range live {
		ids[l.ID] = l.Phase
	}
	if len(live) != 2 || ids[plan] != "countdown" || ids[game] != "running" {
		t.Fatalf("live = %+v, want the plan counting down and the game running, side by side", live)
	}
	for _, rm := range h.liveChannels() {
		if _, crewOwn := protocol.CrewOfPlace(rm.channel); !crewOwn {
			t.Fatalf("a voice channel %q holds a session", rm.channel)
		}
	}
	if _, code, _ := h.OpenCrewGame("crew1", alice, protocol.Control{GameMode: "no-such-mode"}); code == "" {
		t.Fatal("an unknown game opened")
	}
	if n := len(h.CrewSessions("crew1")); n != 2 {
		t.Fatalf("%d sessions after a refused game, want 2: a refusal leaves no room", n)
	}
}

// sessionDoor is the voice channel's door with the call's mark off: the room
// rides sessions, as a crew session's does, for the tests that ride one
// through a plain room. Since docs/SESSIONS.md a voice channel opens none.
func sessionDoor(h *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) { h.door(w, r, false) }
}

// A voice channel is a call and nothing else (docs/SESSIONS.md): its socket
// opens no session and no game, so its room stays its room.
func TestAVoiceChannelOpensNoSession(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/channels/{id}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	ana := dial(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws/channels/lounge", "ana:member")
	for _, cmd := range []protocol.Control{
		{Action: "pick", WorkoutName: "Tempo", WorkoutJSON: crewWorkout},
		{Action: "game", GameMode: "points-race"},
	} {
		if err := wsjson.Write(t.Context(), ana, protocol.ClientMessage{Control: &cmd}); err != nil {
			t.Fatalf("send %s: %v", cmd.Action, err)
		}
		refused := false
		for range 5 {
			ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
			var m protocol.ServerMessage
			err := wsjson.Read(ctx, ana, &m)
			cancel()
			if err != nil {
				t.Fatalf("read: %v", err)
			}
			if m.Error != nil && m.Error.Code == "forbidden" {
				refused = true
				break
			}
		}
		if !refused {
			t.Fatalf("the call took a %s", cmd.Action)
		}
	}
	rm := h.stateOf("lounge")
	rm.mu.Lock()
	open := rm.session.open()
	rm.mu.Unlock()
	if open {
		t.Fatal("a session opened in the voice channel")
	}
}

// A member who opens a crew session and has not joined it is watching: their
// own ride came along to the page, and its numbers stay on their screen
// (#4469). Only the session's riders reach everyone.
func TestACrewSessionKeepsAWatchersNumbersTheirOwn(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	alice := protocol.Rider{ID: "alice", Name: "Alice", Role: "member", FtpWatts: 250}
	id, code, msg := h.OpenCrewSession("crew1", alice, protocol.Control{WorkoutName: "Tempo", WorkoutJSON: crewWorkout})
	if code != "" {
		t.Fatalf("open: %s %s", code, msg)
	}
	rm := h.stateOf(protocol.CrewSessionPlace("crew1", id))
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if !rm.session.join("alice", true) {
		t.Fatal("alice could not join an open session")
	}
	free := rm.freeRidersLocked(map[string]protocol.RiderMetrics{
		"alice": {Watts: 200},
		"bob":   {Watts: 150},
	})
	if _, watching := free["bob"]; !watching {
		t.Errorf("free = %v, want bob's numbers his own", free)
	}
	if _, riding := free["alice"]; riding {
		t.Errorf("free = %v, want alice's numbers the session's", free)
	}
}
