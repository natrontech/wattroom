package hub

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

func gameMsg(action, id, mode string, watts int) protocol.LobbyClientMessage {
	return protocol.LobbyClientMessage{Game: &protocol.SoloGameControl{
		Action: action, ID: id, Mode: mode, FtpWatts: 250, WeightKg: 70, Watts: watts,
	}}
}

// gameFrames is the game frames one socket got.
func gameFrames(frames []protocol.LobbyLane) []protocol.SoloGameFrame {
	var out []protocol.SoloGameFrame
	for _, f := range frames {
		if f.Game != nil {
			out = append(out, *f.Game)
		}
	}
	return out
}

// A game picked on a ride alone runs on that ride (#4539): the screen that
// started it, and nobody else, hears its state, and the hub keeps the score.
func TestSoloGameRunsOnTheRiderOwnLane(t *testing.T) {
	r := newLaneRig(t)
	desk := r.socket("jan")
	phone := r.socket("jan")
	other := r.socket("ana")

	got := r.send(desk, gameMsg("start", "g1", "backyard-ramp", 0))
	frames := gameFrames(got[desk])
	if len(frames) != 1 || frames[0].State == nil || frames[0].ID != "g1" {
		t.Fatalf("start answered %+v, want the game's state", got[desk])
	}
	if s := frames[0].State; s.Mode != "backyard-ramp" || s.Phase != "running" || s.LinePct != backyardStartPct {
		t.Fatalf("the game opened as %+v", s)
	}
	if len(got[phone]) != 0 || len(got[other]) != 0 {
		t.Fatalf("a game alone reached another screen: phone %v, ana %v", got[phone], got[other])
	}

	// The rider stops: below the line long enough is out, and alone that
	// ends the game, as it does for the last rider standing.
	var last protocol.SoloGameFrame
	for range backyardBelowSecs + 1 {
		frames := gameFrames(r.send(desk, gameMsg("sample", "g1", "", 0))[desk])
		if len(frames) != 1 || frames[0].State == nil {
			t.Fatalf("a sample went unanswered: %+v", frames)
		}
		last = frames[0]
	}
	if last.State.Phase != "done" || !last.State.Riders["jan"].Eliminated {
		t.Fatalf("stopping never put the rider out: %+v", last.State)
	}
}

func TestSoloGameRefusalsAndLifecycle(t *testing.T) {
	cases := []struct {
		name string
		msg  protocol.LobbyClientMessage
		want string // the lane error's code, or "gone"
	}{
		{"a mode that needs others", gameMsg("start", "g", "team-relay", 0), "validation_error"},
		{"a race", gameMsg("start", "g", "race", 0), "validation_error"},
		{"no id", gameMsg("start", "", "watt-golf", 0), "validation_error"},
		{"an id too long", gameMsg("start", strings.Repeat("x", protocol.MaxSoloGameID+1), "watt-golf", 0), "validation_error"},
		{"no FTP", protocol.LobbyClientMessage{Game: &protocol.SoloGameControl{Action: "start", ID: "g", Mode: "watt-golf"}}, "validation_error"},
		{"an unknown action", gameMsg("pause", "g", "", 0), "validation_error"},
		{"a sample for no game", gameMsg("sample", "g", "", 100), "gone"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := newLaneRig(t)
			c := r.socket("jan")
			frames := r.send(c, tc.msg)[c]
			if len(frames) != 1 {
				t.Fatalf("got %d frames, want 1: %+v", len(frames), frames)
			}
			f := frames[0]
			if tc.want == "gone" {
				if f.Game == nil || !f.Game.Gone {
					t.Fatalf("got %+v, want Gone", f)
				}
				return
			}
			if f.Error == nil || f.Error.Code != tc.want {
				t.Fatalf("got %+v, want %s", f, tc.want)
			}
			if len(r.lanes.games) != 0 {
				t.Fatal("a refused start kept a game")
			}
		})
	}

	t.Run("another tab's id never feeds it", func(t *testing.T) {
		r := newLaneRig(t)
		c := r.socket("jan")
		r.send(c, gameMsg("start", "g1", "watt-golf", 0))
		f := gameFrames(r.send(c, gameMsg("sample", "g2", "", 200))[c])
		if len(f) != 1 || !f[0].Gone {
			t.Fatalf("a sample for another game got %+v", f)
		}
	})

	t.Run("a reconnect carries on the same game", func(t *testing.T) {
		r := newLaneRig(t)
		c := r.socket("jan")
		r.send(c, gameMsg("start", "g1", "floor-is-lava", 0))
		r.lanes.remove(c)
		back := r.socket("jan")
		f := gameFrames(r.send(back, gameMsg("sample", "g1", "", 200))[back])
		if len(f) != 1 || f[0].State == nil || f[0].State.Mode != "floor-is-lava" {
			t.Fatalf("the game was lost to a reconnect: %+v", f)
		}
		// A start resent after the reconnect is the same game, not a new one.
		before := r.lanes.games["jan"]
		r.send(back, gameMsg("start", "g1", "floor-is-lava", 0))
		if r.lanes.games["jan"] != before {
			t.Fatal("a resent start replaced the running game")
		}
	})

	t.Run("end lets it go", func(t *testing.T) {
		r := newLaneRig(t)
		c := r.socket("jan")
		r.send(c, gameMsg("start", "g1", "watt-golf", 0))
		r.send(c, gameMsg("end", "g1", "", 0))
		if len(r.lanes.games) != 0 {
			t.Fatal("End kept the game")
		}
	})

	t.Run("a quiet game is forgotten", func(t *testing.T) {
		r := newLaneRig(t)
		c := r.socket("jan")
		r.send(c, gameMsg("start", "g1", "watt-golf", 0))
		r.at = r.at.Add(soloGameIdle + time.Second)
		f := gameFrames(r.send(c, gameMsg("sample", "g1", "", 200))[c])
		if len(f) != 1 || !f[0].Gone {
			t.Fatalf("a game quiet for %s was still held: %+v", soloGameIdle, f)
		}
	})
}

// Over the lobby socket, as the ride alone sends it: the game's state comes
// back on that socket, and the hub opens no room for it, so no crew session
// exists to list or join (#4539).
func TestSoloGameOverTheLobbySocketOpensNoRoom(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	h.SetLobbyAuth(func(r *http.Request) (string, bool) {
		name, _, _ := strings.Cut(r.Header.Get("X-Rider"), ":")
		return name, name != ""
	})
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/presence", h.HandleLobbyWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	desk := dial(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws/presence", "jan:member")

	raw, _ := json.Marshal(gameMsg("start", "g1", "watt-golf", 0))
	if err := desk.Write(t.Context(), websocket.MessageText, raw); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	for {
		_, raw, err := desk.Read(ctx)
		if err != nil {
			t.Fatalf("the game's state never arrived: %v", err)
		}
		var f protocol.LobbyLane
		if json.Unmarshal(raw, &f) == nil && f.Game != nil {
			if f.Game.State == nil || f.Game.State.Mode != "watt-golf" {
				t.Fatalf("got %+v", f.Game)
			}
			break
		}
	}
	if rooms := h.liveChannels(); len(rooms) != 0 {
		t.Fatalf("a game alone opened %d rooms", len(rooms))
	}
}
