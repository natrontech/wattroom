package hub

import (
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

func TestFireBufferIsBounded(t *testing.T) {
	rm := newRoom("velvet")
	for range 50 {
		rm.fire(protocol.Board{ClipID: "3f2504e0-4f89-11d3-9a0c-0305e82c3301", FromID: "jan", From: "Jan"})
	}
	if len(rm.board) != 32 {
		t.Fatalf("fire buffer unbounded: %d", len(rm.board))
	}
}

// SPEC: one fire a second per rider. The limiter is per rider, not per room —
// a second rider firing must not be refused because the first just did.
func TestFireIsOneASecondPerRider(t *testing.T) {
	rm := newRoom("velvet")
	at := time.Unix(100, 0)
	if !rm.allow("board", "jan", at, time.Second) {
		t.Fatal("first fire refused")
	}
	if rm.allow("board", "jan", at.Add(400*time.Millisecond), time.Second) {
		t.Error("a second fire inside the window was allowed")
	}
	if !rm.allow("board", "sven", at, time.Second) {
		t.Error("another rider was held to jan's window")
	}
	if !rm.allow("board", "jan", at.Add(time.Second), time.Second) {
		t.Error("the window never reopened")
	}
	// The board's limit is its own: leaning on a pad must not cost the rider
	// their cheers.
	if !rm.allow("cheer", "jan", at.Add(400*time.Millisecond), time.Second) {
		t.Error("the board's limiter swallowed the cheer limiter")
	}
}

// The hub never resolves a clip id — the audio endpoint authorizes the fetch
// — so this pins that it at least refuses to put junk on every client's tick.
func TestFireShapeCheckIsConsulted(t *testing.T) {
	if !protocol.IsClipID("3f2504e0-4f89-11d3-9a0c-0305e82c3301") {
		t.Fatal("shape check refuses a real clip id")
	}
	for _, bad := range []string{"", "<script>", "../../etc/passwd"} {
		if protocol.IsClipID(bad) {
			t.Errorf("shape check let %q through", bad)
		}
	}
}
