package hub

import (
	"log/slog"
	"slices"
	"testing"
	"time"
)

// VoiceSync is the reconciler's write path (#234): prune what LiveKit no
// longer knows, keep joins newer than the snapshot, heal missed webhooks.
func TestVoiceSync(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), nil, nil)
	base := time.Now()
	clock := base
	h.now = func() time.Time { return clock }

	h.VoiceJoined("velvet", "ghost", "Ghost") // LiveKit crashed before goodbye
	h.VoiceJoined("velvet", "kim", "Kim")
	snapshot := base.Add(time.Minute)
	clock = snapshot.Add(time.Second)
	h.VoiceJoined("velvet", "fresh", "Fresh") // joined after the snapshot

	// LiveKit's answer as of `snapshot`: kim is there, ghost is not, and lena's
	// join webhook never arrived.
	h.VoiceSync("velvet", map[string]string{"kim": "Kim", "lena": "Lena"}, snapshot)

	voice := h.Presence("velvet").Voice
	want := []string{"Fresh", "Kim", "Lena"}
	if !slices.Equal(voice, want) {
		t.Fatalf("voice = %v, want %v", voice, want)
	}

	// A camera flag rides the same map (#251) — set by track_published, kept
	// across a reconcile, gone with the leave.
	h.VoiceCamera("velvet", "kim", "Kim", true)
	if cams := h.Presence("velvet").Cameras; !slices.Equal(cams, []string{"Kim"}) {
		t.Fatalf("cameras = %v, want [Kim]", cams)
	}
	h.VoiceSync("velvet", map[string]string{"kim": "Kim"}, clock)
	if cams := h.Presence("velvet").Cameras; !slices.Equal(cams, []string{"Kim"}) {
		t.Fatalf("cameras after sync = %v, want [Kim]", cams)
	}
	h.VoiceLeft("velvet", "kim")
	if cams := h.Presence("velvet").Cameras; len(cams) != 0 {
		t.Fatalf("cameras after leave = %v, want none", cams)
	}

	// An emptied room drops off the reconciler's work list entirely.
	clock = clock.Add(time.Hour)
	h.VoiceSync("velvet", nil, clock)
	if rooms := h.VoiceRooms(); len(rooms) != 0 {
		t.Fatalf("rooms = %v, want none", rooms)
	}
}

// Two tabs are one person on the radar (#293): LiveKit identities carry a
// per-connection nonce, so the same rider holds several entries at once.
func TestVoiceFoldsTabsPerRider(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), nil, nil)

	h.VoiceJoined("velvet", "kim-id#aaa", "Kim")
	h.VoiceJoined("velvet", "kim-id#bbb", "Kim")
	h.VoiceJoined("velvet", "lena-id#ccc", "Lena")

	if voice := h.Presence("velvet").Voice; !slices.Equal(voice, []string{"Kim", "Lena"}) {
		t.Fatalf("voice = %v, want [Kim Lena] — a second tab is not a second rider", voice)
	}

	// A camera live in either tab is that rider on camera.
	h.VoiceCamera("velvet", "kim-id#bbb", "Kim", true)
	if cams := h.Presence("velvet").Cameras; !slices.Equal(cams, []string{"Kim"}) {
		t.Fatalf("cameras = %v, want [Kim]", cams)
	}

	// Closing one tab must not take the rider out of voice, nor out of camera
	// while the other tab still has one open.
	h.VoiceLeft("velvet", "kim-id#aaa")
	p := h.Presence("velvet")
	if !slices.Equal(p.Voice, []string{"Kim", "Lena"}) {
		t.Fatalf("voice after one tab closed = %v, want [Kim Lena]", p.Voice)
	}
	if !slices.Equal(p.Cameras, []string{"Kim"}) {
		t.Fatalf("cameras after one tab closed = %v, want [Kim]", p.Cameras)
	}

	h.VoiceLeft("velvet", "kim-id#bbb")
	if voice := h.Presence("velvet").Voice; !slices.Equal(voice, []string{"Lena"}) {
		t.Fatalf("voice after last tab closed = %v, want [Lena]", voice)
	}
}

// Who a gate change asks about again (#2808) is everyone who can hear the
// channel: a socket in its room, or a connection in its call with no socket
// open. Two tabs are one rider, and another channel's call is not this one.
func TestOccupantsAreTheSocketsAndTheCall(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), nil, nil)
	rm := h.room("velvet")
	rm.join(socket("kim-id", "Kim"))
	rm.join(socket("kim-id", "Kim"))
	rm.join(socket("jan-id", "Jan"))
	h.VoiceJoined("velvet", "kim-id#aaa", "Kim")
	h.VoiceJoined("velvet", "lena-id#bbb", "Lena")
	h.VoiceJoined("elsewhere", "omar-id#ccc", "Omar")

	if got, want := h.Occupants("velvet"), []string{"jan-id", "kim-id", "lena-id"}; !slices.Equal(got, want) {
		t.Fatalf("occupants = %v, want %v", got, want)
	}
	// A call with no room open yet is still somebody listening.
	if got, want := h.Occupants("elsewhere"), []string{"omar-id"}; !slices.Equal(got, want) {
		t.Fatalf("occupants of a call with no room = %v, want %v", got, want)
	}
	if got := h.Occupants("nowhere"); len(got) != 0 {
		t.Fatalf("occupants of an empty channel = %v, want none", got)
	}
}

// Voice is keyed by voice channel (#2436): two channels of one crew are two
// calls, and a join in one is nothing in the other — not on the radar, not in
// the channel's live room, not a hold that keeps it from being forgotten.
func TestAVoiceJoinStaysInItsChannel(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), nil, nil)
	const a, b = "0b6c1f3e-0000-4000-8000-00000000000a", "0b6c1f3e-0000-4000-8000-00000000000b"
	roomB := h.room(b)

	h.VoiceJoined(a, "kim-id#aaa", "Kim")
	h.VoiceCamera(a, "kim-id#aaa", "Kim", true)

	if p := h.Presence(a); !slices.Equal(p.Voice, []string{"Kim"}) || !slices.Equal(p.Cameras, []string{"Kim"}) {
		t.Fatalf("channel A: voice %v cameras %v, want Kim in both", p.Voice, p.Cameras)
	}
	if p := h.Presence(b); len(p.Voice) != 0 || len(p.Cameras) != 0 {
		t.Fatalf("channel B hears a join in A: voice %v cameras %v", p.Voice, p.Cameras)
	}
	roomB.mu.Lock()
	inB := len(roomB.voiceNow)
	roomB.mu.Unlock()
	if inB != 0 {
		t.Fatalf("channel B's live room counts %d in voice, want 0", inB)
	}
	if got := h.VoiceRooms(); !slices.Equal(got, []string{a}) {
		t.Fatalf("channels with anyone in voice = %v, want only A", got)
	}
}
