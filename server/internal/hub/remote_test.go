package hub

import (
	"encoding/json"
	"testing"

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
