package hub

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// TestOneRiderOneVoice is ADR-0089 on real sockets (#4164): the desk joins
// voice first, the same rider's phone is refused and told where the voice
// is, a crewmate's own claim is untouched, and the phone's one tap moves the
// voice while the desk hears it went.
func TestOneRiderOneVoice(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/channels/{id}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/channels/lounge"

	desk := dial(t, url, "jan:member")
	phone := dial(t, url, "jan:member")
	crewmate := dial(t, url, "sam:member")
	send := func(conn *websocket.Conn, claim protocol.VoiceClaim) {
		t.Helper()
		if err := wsjson.Write(t.Context(), conn, protocol.ClientMessage{Voice: &claim}); err != nil {
			t.Fatalf("write: %v", err)
		}
	}
	carries := func(m protocol.ServerMessage) bool {
		return m.Pairing != nil && slices.Contains(m.Pairing.Held, "voice")
	}
	elsewhere := func(device string) func(protocol.ServerMessage) bool {
		return func(m protocol.ServerMessage) bool {
			return m.Pairing != nil && m.Pairing.Elsewhere["voice"] == device
		}
	}

	send(desk, protocol.VoiceClaim{On: true, Tab: "desk", Device: "desktop"})
	if readUntil(t, desk, 5*time.Second, carries) == nil {
		t.Fatal("the desk, first in voice, was never told it carries it")
	}

	send(phone, protocol.VoiceClaim{On: true, Tab: "phone", Device: "phone"})
	refused := readUntil(t, phone, 5*time.Second, func(m protocol.ServerMessage) bool { return m.Error != nil })
	if refused == nil || refused.Error.Code != "voice_conflict" || !strings.Contains(refused.Error.Message, "desktop") {
		t.Fatalf("the phone's second claim answered %+v, want voice_conflict naming the desktop", refused)
	}
	if readUntil(t, phone, 5*time.Second, elsewhere("desktop")) == nil {
		t.Fatal("the refused phone never heard its voice is on the desktop")
	}

	send(crewmate, protocol.VoiceClaim{On: true, Tab: "sam", Device: "desktop"})
	if readUntil(t, crewmate, 5*time.Second, carries) == nil {
		t.Fatal("another rider's claim was refused: the claim must be per rider")
	}

	send(phone, protocol.VoiceClaim{On: true, Take: true, Tab: "phone", Device: "phone"})
	if readUntil(t, phone, 5*time.Second, carries) == nil {
		t.Fatal("the phone's take never moved the voice to it")
	}
	if readUntil(t, desk, 5*time.Second, elsewhere("phone")) == nil {
		t.Fatal("the desk never heard its voice moved to the phone")
	}

	// The phone hangs up: the voice is nobody's, and the desk may claim again.
	send(phone, protocol.VoiceClaim{On: false, Tab: "phone"})
	// Two sockets, so nothing orders the release before the claim: the desk
	// claims once it has heard the voice is free.
	if readUntil(t, desk, 5*time.Second, func(m protocol.ServerMessage) bool {
		return m.Pairing != nil && m.Pairing.Elsewhere["voice"] == "" && !slices.Contains(m.Pairing.Held, "voice")
	}) == nil {
		t.Fatal("the desk never heard the phone let go")
	}
	send(desk, protocol.VoiceClaim{On: true, Tab: "desk", Device: "desktop"})
	if readUntil(t, desk, 5*time.Second, carries) == nil {
		t.Fatal("after the phone let go, the desk's claim was not granted")
	}
}

// TestVoiceClaimGoesWithTheTabsLastSocket: a dropped carrier lets go, so the
// rider's other screen is never locked out by a socket that is gone.
func TestVoiceClaimGoesWithTheTabsLastSocket(t *testing.T) {
	r := newRemoteRig(t)
	r.h.voiceClaim(r.desktop, r.rm, r.desktop.rider, protocol.VoiceClaim{On: true, Tab: "desk"})
	if _, here := r.rm.claimVoice(r.phone, protocol.VoiceClaim{On: true, Tab: "phone"}); here {
		t.Fatal("the phone was granted the voice the desk carries")
	}
	r.rm.leave(r.desktop)
	if _, here := r.rm.claimVoice(r.phone, protocol.VoiceClaim{On: true, Tab: "phone"}); !here {
		t.Fatal("the desk's last socket left, and its voice claim stayed behind")
	}
}
