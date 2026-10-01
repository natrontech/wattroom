package hub

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/workout"
)

// pairsHidden is the block list as the hub reads it (#3202): a pair either
// way round.
type pairsHidden map[[2]string]bool

func (p pairsHidden) Hidden(a, b string) bool { return p[[2]string{a, b}] || p[[2]string{b, a}] }

var rideFlag = time.Unix(1_700_000_000, 0)

// anOpenRide is an hour's group ride at 70 % on a flat 20 km library road.
func anOpenRide(t testing.TB) openRidePlan {
	t.Helper()
	segments, err := workout.Parse(`{"steps":[{"type":"steady","seconds":3600,"target":0.7}]}`)
	if err != nil {
		t.Fatal(err)
	}
	return openRidePlan{
		id: "ride-1", route: rideOn(slope(0, 20_000), 0, false, false), segments: segments,
		flagAt: rideFlag, endsAt: rideFlag.Add(time.Hour),
	}
}

func onRide(id string) *client {
	return &client{rider: protocol.Rider{ID: id}, out: make(chan []byte, clientQueue)}
}

// openRideAt is a ride's room with a clock the test holds.
func openRideAt(t testing.TB, now *time.Time, hider Hider) *openRide {
	t.Helper()
	return newOpenRide(anOpenRide(t), func() time.Time { return *now }, hider, newOpenRideIDs())
}

func tickOf(t testing.TB, frame []byte) protocol.OpenRideTick {
	t.Helper()
	var msg protocol.OpenRideMessage
	if err := json.Unmarshal(frame, &msg); err != nil || msg.Tick == nil {
		t.Fatalf("not a tick: %s (%v)", frame, err)
	}
	return *msg.Tick
}

// One marshal a tick for everyone, however many watch: every socket that
// has nobody hidden from it is sent the very same bytes.
func TestAnOpenRideMarshalsOnceForEveryone(t *testing.T) {
	now := rideFlag.Add(time.Minute)
	o := openRideAt(t, &now, nil)
	var sockets []*client
	for i := range 20 {
		for range 2 { // a rider's second screen joins as that rider
			c := onRide(fmt.Sprintf("r%02d", i))
			if err := o.join(c, 250, 70); err != nil {
				t.Fatal(err)
			}
			sockets = append(sockets, c)
		}
	}
	o.mu.Lock()
	frames := o.tickLocked(now)
	o.mu.Unlock()
	if len(frames) != len(sockets) {
		t.Fatalf("%d frames for %d sockets", len(frames), len(sockets))
	}
	first := &frames[sockets[0]][0]
	for _, c := range sockets {
		if &frames[c][0] != first {
			t.Fatalf("%s got a frame of its own: one marshal a tick is the rule", c.rider.ID)
		}
	}
	if got := tickOf(t, frames[sockets[0]]); len(got.Riders) != 20 || got.Phase != "riding" {
		t.Fatalf("the frame reads %+v, want twenty markers riding", got)
	}
}

// A rider with somebody on the ride hidden from them (#3202) gets a copy
// without that marker — and only they do.
func TestOnlyABlockHolderGetsACopyOfTheirOwn(t *testing.T) {
	now := rideFlag.Add(time.Minute)
	o := openRideAt(t, &now, pairsHidden{{"ana", "ben"}: true})
	sockets := map[string]*client{}
	for _, id := range []string{"ana", "ben", "cat", "dan"} {
		sockets[id] = onRide(id)
		if err := o.join(sockets[id], 250, 70); err != nil {
			t.Fatal(err)
		}
	}
	o.mu.Lock()
	frames := o.tickLocked(now)
	e := map[string]string{}
	for id, r := range o.riders {
		e[id] = r.e
	}
	o.mu.Unlock()
	has := func(frame []byte, id string) bool {
		for _, m := range tickOf(t, frame).Riders {
			if m.E == e[id] {
				return true
			}
		}
		return false
	}
	if has(frames[sockets["ana"]], "ben") || has(frames[sockets["ben"]], "ana") {
		t.Fatal("a hidden pair still see each other's markers")
	}
	if !has(frames[sockets["cat"]], "ana") || !has(frames[sockets["cat"]], "ben") {
		t.Fatal("a rider with no block lost a marker")
	}
	if &frames[sockets["cat"]][0] != &frames[sockets["dan"]][0] || &frames[sockets["ana"]][0] == &frames[sockets["cat"]][0] {
		t.Fatal("copies went to riders with nobody hidden, or none to those with somebody")
	}
}

// The frame names nobody: no account id reaches it, only the ride's ids.
func TestAnOpenRideFrameCarriesNoAccountID(t *testing.T) {
	now := rideFlag.Add(time.Minute)
	o := openRideAt(t, &now, nil)
	c := onRide("7f3c2a4e-account-id")
	if err := o.join(c, 2861, 70); err != nil {
		t.Fatal(err)
	}
	o.sample(c, protocol.OpenRideSample{Seq: 1, Watts: 2973})
	o.mu.Lock()
	frame := o.tickLocked(now.Add(time.Second))[c]
	o.mu.Unlock()
	for _, leak := range []string{"7f3c2a4e", "2973", "2861"} {
		if strings.Contains(string(frame), leak) {
			t.Fatalf("the frame carries %q: %s", leak, frame)
		}
	}
}

// docs/SPEC.md's cap: the 101st rider is refused as rate_limited, and a
// rider's own second screen never counts as another.
func TestAnOpenRideIsFullAtAHundred(t *testing.T) {
	now := rideFlag
	o := openRideAt(t, &now, nil)
	for i := range maxOpenRideRiders {
		if err := o.join(onRide(fmt.Sprintf("r%03d", i)), 250, 70); err != nil {
			t.Fatalf("rider %d refused: %+v", i, err)
		}
	}
	if err := o.join(onRide("r000"), 250, 70); err != nil {
		t.Fatalf("a rider's second screen was refused: %+v", err)
	}
	err := o.join(onRide("one-too-many"), 250, 70)
	if err == nil || err.Code != "rate_limited" || err.Message != "This ride is full." {
		t.Fatalf("the 101st rider was answered %+v, want rate_limited", err)
	}
}

// The id map outlives the room by 24 h (ADR-0076) and not a second more; a
// rider back on the ride is the same marker.
func TestTheRideIDMapIsDropped24HoursAfterTheRide(t *testing.T) {
	ids := newOpenRideIDs()
	ends := rideFlag.Add(time.Hour)
	e := ids.idFor("ride-1", "ana", ends, rideFlag)
	if again := ids.idFor("ride-1", "ana", ends, rideFlag.Add(time.Minute)); again != e {
		t.Fatalf("ana came back as %q, was %q", again, e)
	}
	if who, ok := ids.riderOf("ride-1", e, ends.Add(24*time.Hour-time.Second)); !ok || who != "ana" {
		t.Fatalf("a day less a second after the ride, %q resolves to %q %v", e, who, ok)
	}
	if who, ok := ids.riderOf("ride-1", e, ends.Add(24*time.Hour+time.Second)); ok {
		t.Fatalf("a day and a second after the ride, %q still resolves to %q", e, who)
	}
}

// A restart forms the room again (ADR-0052): the bunch is re-derived from
// the flag and the plan and lands within 25 m of where it was.
func TestARestartedOpenRideFindsItsBunch(t *testing.T) {
	now := rideFlag
	before := openRideAt(t, &now, nil)
	riders := map[string]*client{"ana": onRide("ana"), "ben": onRide("ben")}
	for _, c := range riders {
		if err := before.join(c, 250, 70); err != nil {
			t.Fatal(err)
		}
	}
	for s := range 20 * 60 {
		now = now.Add(time.Second)
		for _, c := range riders {
			before.sample(c, protocol.OpenRideSample{Seq: s + 1, Watts: 150 + s%120})
		}
		before.mu.Lock()
		before.tickLocked(now)
		before.mu.Unlock()
	}
	after := openRideAt(t, &now, nil)
	was, is := before.bunch.fromM+before.bunch.pace.Distance, after.bunch.fromM+after.bunch.pace.Distance
	if math.Abs(was-is) > 25 || was < 1000 {
		t.Fatalf("the bunch was at %.1f m and came back at %.1f m, want within 25 m", was, is)
	}
}

// The pen, the count-in, the ride and its end, by the clock.
func TestAnOpenRidesPhases(t *testing.T) {
	p := anOpenRide(t)
	for _, c := range []struct {
		at   time.Duration
		want string
	}{
		{-openRidePen, "pen"},
		{-11 * time.Second, "pen"},
		{-5 * time.Second, "countIn"},
		{0, "riding"},
		{time.Hour - time.Second, "riding"},
		{time.Hour, "done"},
	} {
		if got := p.phaseAt(rideFlag.Add(c.at)); got != c.want {
			t.Errorf("at the flag %+v: %s, want %s", c.at, got, c.want)
		}
	}
}

// Made at the first admitted connection, reused by the next, and let go of
// once nobody is on it.
func TestAnOpenRideRoomIsMadeOnceAndForgottenWhenEmpty(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), nil, nil)
	now := rideFlag.Add(time.Minute)
	h.now = func() time.Time { return now }
	ana, ben := onRide("ana"), onRide("ben")
	first, err := h.joinOpenRide(anOpenRide(t), ana, 250, 70)
	if err != nil {
		t.Fatal(err)
	}
	second, err := h.joinOpenRide(anOpenRide(t), ben, 250, 70)
	if err != nil || second != first {
		t.Fatalf("a second rider got a room of their own: %v", err)
	}
	first.leave(ana)
	first.leave(ben)
	deadline := time.Now().Add(3 * time.Second)
	for {
		if rooms, _ := h.openRideCounts(); rooms == 0 {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("an empty open ride was never let go")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// Well under 1 ms per ride per tick at a hundred riders (#3303).
func BenchmarkAnOpenRideTickAtAHundred(b *testing.B) {
	now := rideFlag.Add(time.Minute)
	o := openRideAt(b, &now, pairsHidden{{"r000", "r001"}: true})
	var sockets []*client
	for i := range maxOpenRideRiders {
		c := onRide(fmt.Sprintf("r%03d", i))
		if err := o.join(c, 250, 70); err != nil {
			b.Fatal(err)
		}
		sockets = append(sockets, c)
	}
	b.ResetTimer()
	for i := range b.N {
		now = now.Add(time.Second)
		for _, c := range sockets {
			o.sample(c, protocol.OpenRideSample{Seq: i + 1, Watts: 200 + i%50})
		}
		o.mu.Lock()
		o.tickLocked(now)
		o.mu.Unlock()
	}
}
