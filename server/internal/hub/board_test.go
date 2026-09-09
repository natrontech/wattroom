package hub

import (
	"reflect"
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

// A stop (#1321) is a fire with no clip, and it skips the cooldown — the fire
// it takes back is half a second old. This is what bounds it instead: a
// second stop with nothing of the rider's fired in between says nothing and
// is dropped, while a stop after a fresh fire, or from another rider, stands.
func TestStopIsQueuedOncePerFire(t *testing.T) {
	rm := newRoom("velvet")
	shot := protocol.Board{ClipID: "3f2504e0-4f89-11d3-9a0c-0305e82c3301", FromID: "jan", From: "Jan"}
	stop := protocol.Board{FromID: "jan", From: "Jan"}
	svensStop := protocol.Board{FromID: "sven", From: "Sven"}
	for _, b := range []protocol.Board{stop, stop, shot, stop, stop, svensStop, stop, shot, stop} {
		rm.fire(b)
	}
	want := []protocol.Board{stop, shot, stop, svensStop, shot, stop}
	if !reflect.DeepEqual(rm.board, want) {
		t.Fatalf("queued %+v\nwant   %+v", rm.board, want)
	}
}

// A fire is one tick and gone (ADR-0022), so a rider who walked in halfway
// through a clip heard silence and saw nobody playing anything (#1681). The
// room remembers the press for as long as it could still be sounding, and the
// roster carries it with how far in the room already is.
func TestTheRoomRemembersWhatIsStillSounding(t *testing.T) {
	const clip = "3f2504e0-4f89-11d3-9a0c-0305e82c3301"
	at := time.Unix(100, 0)
	rm := newRoom("velvet")
	rm.now = func() time.Time { return at }

	if id, _ := rm.soundingLocked("jan", at); id != "" {
		t.Fatalf("a room nobody fired in reports %q sounding", id)
	}
	rm.fire(protocol.Board{ClipID: clip, FromID: "jan", From: "Jan"})

	// Ten seconds in, a joiner is told to start ten seconds in.
	id, since := rm.soundingLocked("jan", at.Add(10*time.Second))
	if id != clip || since != 10_000 {
		t.Errorf("mid-clip roster = %q at %d ms; want %q at 10000", id, since, clip)
	}
	// Another rider's board is their own.
	if id, _ := rm.soundingLocked("sven", at.Add(time.Second)); id != "" {
		t.Errorf("sven inherited jan's clip: %q", id)
	}
	// Past the ceiling nothing can still be playing, and the entry goes with it.
	if id, _ := rm.soundingLocked("jan", at.Add(soundingCeiling)); id != "" {
		t.Errorf("a clip past the ceiling still reported: %q", id)
	}
	if _, held := rm.sounding["jan"]; held {
		t.Error("the expired entry was left behind")
	}
}

// The stop (#1321) takes the clip off the roster too — otherwise the next
// rider through the door starts a sound the room has already ended.
func TestAStopClearsWhatIsSounding(t *testing.T) {
	at := time.Unix(100, 0)
	rm := newRoom("velvet")
	rm.now = func() time.Time { return at }
	rm.fire(protocol.Board{ClipID: "3f2504e0-4f89-11d3-9a0c-0305e82c3301", FromID: "jan", From: "Jan"})
	rm.fire(protocol.Board{FromID: "jan", From: "Jan"})
	if id, _ := rm.soundingLocked("jan", at.Add(time.Second)); id != "" {
		t.Errorf("a stopped clip is still on the roster: %q", id)
	}
}
