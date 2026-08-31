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

	_, _, _, voice := h.Presence("velvet")
	want := []string{"Fresh", "Kim", "Lena"}
	if !slices.Equal(voice, want) {
		t.Fatalf("voice = %v, want %v", voice, want)
	}

	// An emptied room drops off the reconciler's work list entirely.
	clock = clock.Add(time.Hour)
	h.VoiceSync("velvet", nil, clock)
	if rooms := h.VoiceRooms(); len(rooms) != 0 {
		t.Fatalf("rooms = %v, want none", rooms)
	}
}
