package hub

import (
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// Skip block and +1 min reach the holding tab like any press (#4425), and the
// holder's answer about them reaches the phone whole: in a voice channel ...
func TestSkipAndExtendInAVoiceChannel(t *testing.T) {
	r := newRemoteRig(t)
	for _, action := range []string{"skip", "extend"} {
		r.h.remote(r.phone, r.rm, r.phone.rider, protocol.RemoteCommand{Action: action})
		if got := heard(r.desktop); got == nil || got.Remote == nil || got.Remote.Action != action {
			t.Fatalf("the holding tab heard %+v, want %s", got, action)
		}
		if got := heard(r.you); got != nil {
			t.Fatalf("another rider heard %+v", got)
		}
	}
	p := protocol.PauseState{Pausable: true, Blocks: true, Last: true}
	r.h.pauseState(r.desktop, r.rm, r.desktop.rider, p)
	if got := heard(r.phone); got == nil || got.Pause == nil || *got.Pause != p {
		t.Fatalf("the phone heard %+v, want %+v", got, p)
	}
}

// ... and over the rider's lane, for a ride alone.
func TestSkipAndExtendOnTheRiderLane(t *testing.T) {
	r := newLaneRig(t)
	desk, phone, sven := r.socket("jan"), r.socket("jan"), r.socket("sven")
	r.send(phone, rideClaim(false, "phone-tab", "phone"))
	r.send(desk, rideClaim(true, "desk-tab", "desktop"))
	for _, action := range []string{"skip", "extend"} {
		got := r.send(phone, press(action))
		if len(got[desk]) != 1 || got[desk][0].Remote == nil || got[desk][0].Remote.Action != action {
			t.Fatalf("the desk heard %+v, want %s", got[desk], action)
		}
		if len(got[sven]) != 0 {
			t.Fatalf("another rider heard %+v", got[sven])
		}
	}
	p := protocol.PauseState{Pausable: true, Blocks: true, Last: true}
	got := r.send(desk, protocol.LobbyClientMessage{Pause: &p})
	if len(got[phone]) != 1 || got[phone][0].Pause == nil || *got[phone][0].Pause != p {
		t.Fatalf("the phone heard %+v, want %+v", got[phone], p)
	}
}
