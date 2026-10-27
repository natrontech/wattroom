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
	"github.com/coder/websocket/wsjson"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// remoteRig is a rider with the trainer on a desktop, a phone beside it, and
// a second rider's tab that must never hear either.
type remoteRig struct {
	h                   *Hub
	rm                  *channelState
	desktop, phone, you *client
}

func newRemoteRig(t *testing.T) remoteRig {
	t.Helper()
	h := New(nil, nil, nil)
	rm := newChannelState("test")
	mk := func(rider, tab string) *client {
		c := &client{rider: protocol.Rider{ID: rider}, tab: tab, out: make(chan []byte, 8)}
		rm.join(c)
		return c
	}
	r := remoteRig{h: h, rm: rm, desktop: mk("jan", "desk"), phone: mk("jan", "phone"), you: mk("sam", "other")}
	rm.claimSensors(r.desktop, protocol.SensorClaim{Held: []string{"trainer"}, Tab: "desk"})
	return r
}

func heard(c *client) *protocol.ServerMessage {
	select {
	case frame := <-c.out:
		var msg protocol.ServerMessage
		if json.Unmarshal(frame, &msg) != nil {
			return nil
		}
		return &msg
	default:
		return nil
	}
}

func TestRemoteReachesOnlyTheHoldingTab(t *testing.T) {
	r := newRemoteRig(t)
	r.h.remote(r.phone, r.rm, r.phone.rider, protocol.RemoteCommand{Action: "harder"})
	if got := heard(r.desktop); got == nil || got.Remote == nil || got.Remote.Action != "harder" {
		t.Fatalf("the holding tab heard %+v, want the harder command", got)
	}
	for name, c := range map[string]*client{"sender": r.phone, "other rider": r.you} {
		if got := heard(c); got != nil {
			t.Errorf("%s heard %+v, want nothing", name, got)
		}
	}
}

func TestRemoteWithNoRideRunningIsAConflict(t *testing.T) {
	r := newRemoteRig(t)
	r.rm.claimSensors(r.desktop, protocol.SensorClaim{Tab: "desk"})
	r.h.remote(r.phone, r.rm, r.phone.rider, protocol.RemoteCommand{Action: "page"})
	if got := heard(r.phone); got == nil || got.Error == nil || got.Error.Code != "remote_conflict" {
		t.Fatalf("the phone heard %+v, want remote_conflict", got)
	}
}

func TestRemoteFloodIsRefusedAndKeepaliveIsQuiet(t *testing.T) {
	r := newRemoteRig(t)
	harder := protocol.RemoteCommand{Action: "harder"}
	r.h.remote(r.phone, r.rm, r.phone.rider, harder)
	r.h.remote(r.phone, r.rm, r.phone.rider, harder)
	if got := heard(r.phone); got == nil || got.Error == nil || got.Error.Code != "remote_rate_limited" {
		t.Fatalf("a repeated tap answered %+v, want remote_rate_limited", got)
	}
	keep := protocol.RemoteCommand{Action: "talk-keepalive"}
	r.h.remote(r.phone, r.rm, r.phone.rider, keep)
	r.h.remote(r.phone, r.rm, r.phone.rider, keep)
	if got := heard(r.phone); got != nil {
		t.Errorf("a refused keepalive answered %+v, want silence", got)
	}
}

func TestRemoteUnknownActionIsRefused(t *testing.T) {
	r := newRemoteRig(t)
	r.h.remote(r.phone, r.rm, r.phone.rider, protocol.RemoteCommand{Action: "reboot"})
	if got := heard(r.phone); got == nil || got.Error == nil || got.Error.Code != "remote_validation_error" {
		t.Fatalf("an unknown action answered %+v, want remote_validation_error", got)
	}
	if got := heard(r.desktop); got != nil {
		t.Errorf("the holder heard %+v for an unknown action", got)
	}
}

func TestRemoteTalkReleasesAtOnceWhenThePhoneDrops(t *testing.T) {
	r := newRemoteRig(t)
	r.h.remote(r.phone, r.rm, r.phone.rider, protocol.RemoteCommand{Action: "talk-down"})
	if got := heard(r.desktop); got == nil || got.Remote.Action != "talk-down" {
		t.Fatalf("the holder heard %+v, want talk-down", got)
	}
	r.rm.leave(r.phone)
	if got := heard(r.desktop); got == nil || got.Remote == nil || got.Remote.Action != "talk-up" {
		t.Fatalf("after the phone dropped the holder heard %+v, want talk-up", got)
	}
}

func TestRemoteTalkStaysHeldAfterAnOrderlyRelease(t *testing.T) {
	r := newRemoteRig(t)
	r.h.remote(r.phone, r.rm, r.phone.rider, protocol.RemoteCommand{Action: "talk-down"})
	r.h.remote(r.phone, r.rm, r.phone.rider, protocol.RemoteCommand{Action: "talk-up"})
	heard(r.desktop)
	heard(r.desktop)
	r.rm.leave(r.phone)
	if got := heard(r.desktop); got != nil {
		t.Errorf("a phone that released before dropping sent %+v, want nothing", got)
	}
}

func TestGearStateReachesOnlyTheRidersOtherScreens(t *testing.T) {
	r := newRemoteRig(t)
	g := protocol.GearState{Label: "G3", AtEnd: true}
	r.h.gearState(r.desktop, r.rm, r.desktop.rider, g)
	if got := heard(r.phone); got == nil || got.Gear == nil || *got.Gear != g {
		t.Fatalf("the phone heard %+v, want %+v", got, g)
	}
	for name, c := range map[string]*client{"holder": r.desktop, "other rider": r.you} {
		if got := heard(c); got != nil {
			t.Errorf("%s heard %+v, want nothing", name, got)
		}
	}
}

func TestPauseStateReachesOnlyTheRidersOtherScreens(t *testing.T) {
	r := newRemoteRig(t)
	p := protocol.PauseState{Pausable: true, Paused: true}
	r.h.pauseState(r.desktop, r.rm, r.desktop.rider, p)
	if got := heard(r.phone); got == nil || got.Pause == nil || *got.Pause != p {
		t.Fatalf("the phone heard %+v, want %+v", got, p)
	}
	for name, c := range map[string]*client{"holder": r.desktop, "other rider": r.you} {
		if got := heard(c); got != nil {
			t.Errorf("%s heard %+v, want nothing", name, got)
		}
	}
}

func TestPauseStateFromANonHolderIsDropped(t *testing.T) {
	r := newRemoteRig(t)
	r.h.pauseState(r.phone, r.rm, r.phone.rider, protocol.PauseState{Pausable: true})
	if got := heard(r.desktop); got != nil {
		t.Errorf("the holder heard %+v from a screen that does not hold the trainer", got)
	}
}

func TestGearStateFromANonHolderIsDropped(t *testing.T) {
	r := newRemoteRig(t)
	r.h.gearState(r.phone, r.rm, r.phone.rider, protocol.GearState{Label: "G9"})
	if got := heard(r.desktop); got != nil {
		t.Errorf("the holder heard %+v from a screen that does not hold the trainer", got)
	}
}

func TestViewStateReachesOnlyTheRidersOtherScreens(t *testing.T) {
	for _, tc := range []struct {
		name  string
		from  func(remoteRig) *client
		view  protocol.ViewState
		phone bool
	}{
		{"the holder's view", func(r remoteRig) *client { return r.desktop }, protocol.ViewState{Page: "map", World: true}, true},
		{"a page too long to render", func(r remoteRig) *client { return r.desktop }, protocol.ViewState{Page: strings.Repeat("x", protocol.MaxViewPage+1)}, false},
		{"the holder's camera and pictures", func(r remoteRig) *client { return r.desktop }, protocol.ViewState{Page: "ride", World: true, Camera: "heli", Pictures: 2}, true},
		{"a camera too long to render", func(r remoteRig) *client { return r.desktop }, protocol.ViewState{Page: "ride", Camera: strings.Repeat("x", protocol.MaxViewPage+1)}, false},
		{"a negative picture count", func(r remoteRig) *client { return r.desktop }, protocol.ViewState{Page: "ride", Pictures: -1}, false},
		{"a screen that does not hold the trainer", func(r remoteRig) *client { return r.phone }, protocol.ViewState{Page: "ride"}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := newRemoteRig(t)
			from := tc.from(r)
			r.h.viewState(from, r.rm, from.rider, tc.view)
			got := heard(r.phone)
			if tc.phone && (got == nil || got.View == nil || *got.View != tc.view) {
				t.Fatalf("the phone heard %+v, want %+v", got, tc.view)
			}
			if !tc.phone && got != nil {
				t.Fatalf("the phone heard %+v, want nothing", got)
			}
			for name, c := range map[string]*client{"holder": r.desktop, "other rider": r.you} {
				if got := heard(c); got != nil {
					t.Errorf("%s heard %+v, want nothing", name, got)
				}
			}
		})
	}
}

func TestALateScreenIsToldWhatTheTrainerHolderHolds(t *testing.T) {
	r := newRemoteRig(t)
	late := &client{rider: protocol.Rider{ID: "jan"}, tab: "late", out: make(chan []byte, 8)}
	r.rm.join(late)
	r.h.handleMessage(late, r.rm, "test", late.rider, protocol.ClientMessage{Sensors: &protocol.SensorClaim{Tab: "late"}})
	r.rm.mu.Lock()
	got, queued := r.rm.pendingPairing[late]
	r.rm.mu.Unlock()
	if _, held := got.Elsewhere["trainer"]; !queued || !held {
		t.Fatalf("the late screen was queued %+v (queued %v), want the trainer held elsewhere", got, queued)
	}
}

// readUntil reads conn until a frame satisfies want, or nil once within passes.
func readUntil(t *testing.T, conn *websocket.Conn, within time.Duration, want func(protocol.ServerMessage) bool) *protocol.ServerMessage {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), within)
	defer cancel()
	for {
		var msg protocol.ServerMessage
		if err := wsjson.Read(ctx, conn, &msg); err != nil {
			return nil
		}
		if want(msg) {
			return &msg
		}
	}
}

// TestRemoteOverTheWire is Jan's ride (#4163) on real sockets: a desktop
// holding the trainer, the same rider's phone pressing Bias + and Talk, and
// a crewmate who must hear none of it.
func TestRemoteOverTheWire(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/channels/{id}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/channels/lounge"

	desk := dial(t, url, "jan:member")
	phone := dial(t, url, "jan:member")
	crewmate := dial(t, url, "sam:member")
	send := func(conn *websocket.Conn, msg protocol.ClientMessage) {
		t.Helper()
		if err := wsjson.Write(t.Context(), conn, msg); err != nil {
			t.Fatalf("write: %v", err)
		}
	}
	send(desk, protocol.ClientMessage{Sensors: &protocol.SensorClaim{Held: []string{"trainer"}, Tab: "desk", Device: "desktop"}})
	// The phone learns the desk holds the trainer: what draws its offer.
	send(phone, protocol.ClientMessage{Sensors: &protocol.SensorClaim{Tab: "phone", Device: "phone"}})
	if readUntil(t, phone, 5*time.Second, func(m protocol.ServerMessage) bool {
		return m.Pairing != nil && m.Pairing.Elsewhere["trainer"] != ""
	}) == nil {
		t.Fatal("the phone never heard that another of its rider's screens holds the trainer")
	}

	isRemote := func(action string) func(protocol.ServerMessage) bool {
		return func(m protocol.ServerMessage) bool { return m.Remote != nil && m.Remote.Action == action }
	}
	for _, action := range []string{"harder", "talk-down", "talk-up"} {
		send(phone, protocol.ClientMessage{Remote: &protocol.RemoteCommand{Action: action}})
		if readUntil(t, desk, 5*time.Second, isRemote(action)) == nil {
			t.Fatalf("the desk never heard %s from the phone", action)
		}
	}
	if got := readUntil(t, crewmate, 1500*time.Millisecond, func(m protocol.ServerMessage) bool {
		return m.Remote != nil
	}); got != nil {
		t.Errorf("a crewmate heard the phone's %+v", got.Remote)
	}
}
