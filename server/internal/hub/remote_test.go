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
