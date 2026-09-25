package hub

import (
	"log/slog"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// Who came and went (#984). ADR-0022 described this line and nobody built it,
// so a rider arrived, a rider disappeared, and the timeline said nothing.

func pat(seconds int) time.Time {
	return time.Date(2026, 9, 7, 19, 0, seconds, 0, time.UTC)
}

// A room whose clock the test moves by hand — `-race` and a wall clock make a
// grace window untestable.
func presenceRoom(now *time.Time) *room {
	rm := newRoom("velvet")
	rm.now = func() time.Time { return *now }
	return rm
}

func socket(id, name string) *client {
	return &client{rider: protocol.Rider{ID: id, Name: name}}
}

// verbs is what the room has queued to say, in order.
func verbs(rm *room) []string {
	out := make([]string, 0, len(rm.events.pending))
	for _, ev := range rm.events.pending {
		out = append(out, ev.Verb+":"+ev.Actor)
	}
	return out
}

func TestJoiningAndLeavingSaySo(t *testing.T) {
	now := pat(0)
	rm := presenceRoom(&now)
	kim := socket("r-kim", "Kim")

	rm.join(kim)
	if got := verbs(rm); len(got) != 1 || got[0] != "joined:Kim" {
		t.Fatalf("join line: %v", got)
	}
	rm.events.drain()

	rm.leave(kim)
	// Nothing yet: the grace window is what stops a flap being a strobe.
	now = pat(int(presenceGrace.Seconds()) - 1)
	rm.mu.Lock()
	rm.sayDepartedLocked(now)
	rm.mu.Unlock()
	if got := verbs(rm); len(got) != 0 {
		t.Fatalf("said something inside the grace window: %v", got)
	}

	now = pat(int(presenceGrace.Seconds()) + 1)
	rm.mu.Lock()
	rm.sayDepartedLocked(now)
	rm.mu.Unlock()
	if got := verbs(rm); len(got) != 1 || got[0] != "left:Kim" {
		t.Fatalf("leave line: %v", got)
	}
}

// A phone in a garage flaps constantly. The round trip is worth no line at
// all — not a leave, and not a second arrival either.
func TestAFlapInsideTheGraceWindowSaysNothing(t *testing.T) {
	now := pat(0)
	rm := presenceRoom(&now)
	kim := socket("r-kim", "Kim")
	rm.join(kim)
	rm.events.drain()

	rm.leave(kim)
	now = pat(5)
	rm.join(socket("r-kim", "Kim"))
	now = pat(int(presenceGrace.Seconds()) * 2)
	rm.mu.Lock()
	rm.sayDepartedLocked(now)
	rm.mu.Unlock()
	if got := verbs(rm); len(got) != 0 {
		t.Fatalf("a flap printed: %v", got)
	}
}

// A person on a desktop and a phone is one presence (#219): the second screen
// is not an arrival, and closing it is not a departure.
func TestASecondScreenIsNotAnArrival(t *testing.T) {
	now := pat(0)
	rm := presenceRoom(&now)
	desk := socket("r-kim", "Kim")
	phone := socket("r-kim", "Kim")
	rm.join(desk)
	rm.events.drain()

	rm.join(phone)
	if got := verbs(rm); len(got) != 0 {
		t.Fatalf("second screen announced: %v", got)
	}
	rm.leave(phone)
	now = pat(int(presenceGrace.Seconds()) * 2)
	rm.mu.Lock()
	rm.sayDepartedLocked(now)
	rm.mu.Unlock()
	if got := verbs(rm); len(got) != 0 {
		t.Fatalf("closing one screen announced a leave: %v", got)
	}
}

// Six people turning up when a planned session opens is one growing line, not
// six lines pushing the conversation off the pane (#291).
func TestArrivalsCoalesceIntoOneGrowingLine(t *testing.T) {
	now := pat(0)
	rm := presenceRoom(&now)
	rm.join(socket("r-ana", "Ana"))
	rm.join(socket("r-kim", "Kim"))
	rm.join(socket("r-jan", "Jan"))

	pending := rm.events.pending
	if len(pending) != 1 {
		t.Fatalf("want one line, got %d: %+v", len(pending), pending)
	}
	// The line names the first of them and counts the rest: "Ana and 2
	// others joined". Re-broadcast under one id, so clients replace in place.
	if pending[0].Actor != "Ana" || pending[0].Count != 3 {
		t.Fatalf("coalesced line: %+v", pending[0])
	}
}

// Past the burst window they are separate arrivals again.
func TestArrivalsFarApartAreTheirOwnLines(t *testing.T) {
	now := pat(0)
	rm := presenceRoom(&now)
	rm.join(socket("r-ana", "Ana"))
	now = pat(int(eventBurstWindow.Seconds()) + 1)
	rm.join(socket("r-kim", "Kim"))
	if got := verbs(rm); len(got) != 2 {
		t.Fatalf("want two lines, got %v", got)
	}
}

func TestAwayAndBackEachSayItOnce(t *testing.T) {
	now := pat(0)
	rm := presenceRoom(&now)
	rm.join(socket("r-kim", "Kim"))
	rm.events.drain()

	rm.setAway("r-kim", true, "")
	// A tab restating what it already said on reconnect must not print again.
	rm.setAway("r-kim", true, "")
	if got := verbs(rm); len(got) != 1 || got[0] != "away:Kim" {
		t.Fatalf("away lines: %v", got)
	}
	rm.events.drain()

	rm.setAway("r-kim", false, "")
	rm.setAway("r-kim", false, "")
	if got := verbs(rm); len(got) != 1 || got[0] != "back:Kim" {
		t.Fatalf("back lines: %v", got)
	}
}

// A rider who is not in the room has no name to print — the socket that knew
// it has gone.
func TestAwayForSomebodyNotHereSaysNothing(t *testing.T) {
	now := pat(0)
	rm := presenceRoom(&now)
	rm.setAway("r-ghost", true, "")
	if got := verbs(rm); len(got) != 0 {
		t.Fatalf("announced a ghost: %v", got)
	}
}

// ADR-0022's bargain: none of this is written anywhere.
func TestPresenceLinesAreEphemeral(t *testing.T) {
	now := pat(0)
	rm := presenceRoom(&now)
	rm.join(socket("r-kim", "Kim"))
	if got := rm.events.drain(); len(got) != 1 || got[0].Kind != presenceKind {
		t.Fatalf("drained: %+v", got)
	}
	// Drained is gone: a reload shows no presence lines, which is the bargain
	// working rather than a bug.
	if got := rm.events.drain(); len(got) != 0 {
		t.Fatalf("a line survived the drain: %+v", got)
	}
}

// A room that empties keeps its clock (the session still closes on time), and
// it has to keep its timeline too (#2230): the tick used to skip the departure
// lines entirely while nobody was connected, so the last riders stayed parked
// in `departed` — the room lost the "left" line, and the first rider back
// hours later was read as a flap and lost their "joined" one as well. Silence
// in both directions, which is the opposite of what #984's grace window is for.
func TestAnEmptyRoomStillSaysWhoLeft(t *testing.T) {
	var mu sync.Mutex
	now := pat(0)
	clock := func() time.Time {
		mu.Lock()
		defer mu.Unlock()
		return now
	}
	rm := newRoom("emptied")
	rm.now = clock
	kim := socket("r-kim", "Kim")
	rm.join(kim)
	rm.events.drain() // the arrival, which is not what this is about
	rm.leave(kim)     // and now nobody is connected

	go rm.run(slog.New(slog.DiscardHandler), clock, nil)
	t.Cleanup(func() { close(rm.stop) })

	mu.Lock()
	now = pat(int(presenceGrace.Seconds()) + 1)
	mu.Unlock()

	// The tick is 1 Hz; give it a few of those rather than a fixed sleep.
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		rm.mu.Lock()
		said := verbs(rm)
		rm.mu.Unlock()
		if len(said) == 1 && said[0] == "left:Kim" {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("the room emptied and never said the departure")
}

// A named state is its own verb, and changing between two of them is a change
// the room should hear: "Kim is refuelling" after "Kim went away" is the room
// learning something, unlike a tab restating what it already said.
func TestANamedAwayStateSaysWhichAndOnlyOnChange(t *testing.T) {
	now := pat(0)
	rm := presenceRoom(&now)
	rm.join(socket("r-kim", "Kim"))
	rm.events.drain()

	rm.setAway("r-kim", true, "food")
	rm.setAway("r-kim", true, "food") // a reconnect restating itself
	if got := verbs(rm); len(got) != 1 || got[0] != "away_food:Kim" {
		t.Fatalf("refuelling lines: %v", got)
	}
	rm.events.drain()

	// Still away, now for a different reason.
	rm.setAway("r-kim", true, "shower")
	if got := verbs(rm); len(got) != 1 || got[0] != "away_shower:Kim" {
		t.Fatalf("changing state: %v", got)
	}
	rm.events.drain()

	rm.setAway("r-kim", false, "")
	if got := verbs(rm); len(got) != 1 || got[0] != "back:Kim" {
		t.Fatalf("back lines: %v", got)
	}
}

// The set is closed because the room renders it beside a rider's name
// (errors.md, the same reasoning as the device word). A client that invents
// one is still away — the state is the point — but the room is told the plain
// thing rather than a word nobody chose.
func TestAnUnknownAwayReasonFallsBackToPlainAway(t *testing.T) {
	now := pat(0)
	rm := presenceRoom(&now)
	rm.join(socket("r-kim", "Kim"))
	rm.events.drain()

	rm.setAway("r-kim", true, "<script>alert(1)</script>")
	if got := verbs(rm); len(got) != 1 || got[0] != "away:Kim" {
		t.Fatalf("unknown reason: %v", got)
	}
	if reason := rm.away["r-kim"]; reason != "" {
		t.Errorf("kept %q on the roster, want it dropped", reason)
	}
}

// Coming back has no reason: a client that sends one anyway must not leave a
// state behind on the roster for the next tick to draw.
func TestComingBackCarriesNoReason(t *testing.T) {
	now := pat(0)
	rm := presenceRoom(&now)
	rm.join(socket("r-kim", "Kim"))
	rm.setAway("r-kim", true, "shower")
	rm.events.drain()

	rm.setAway("r-kim", false, "shower")
	if got := verbs(rm); len(got) != 1 || got[0] != "back:Kim" {
		t.Fatalf("back lines: %v", got)
	}
	if _, still := rm.away["r-kim"]; still {
		t.Error("the rider is still marked away")
	}
}

// A session's live line names the riders who joined it (ADR-0059, #2853).
// It named everyone standing in the channel, so a spectator made the crew
// page say "3 riding" while two rode.
func TestALiveSessionNamesOnlyItsRiders(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	rm := h.room("session-count")
	for _, c := range []*client{socket("r-ana", "Ana"), socket("r-kim", "Kim"), socket("r-sofa", "Sofa")} {
		rm.join(c)
	}
	rm.session.pick("Openers", "{}", 3600)
	joinRide(rm, "r-ana", "r-kim")
	rm.session.start(h.now())
	live, ok := h.LiveSession("session-count")
	if !ok {
		t.Fatal("no live session")
	}
	if !slices.Equal(live.RiderIDs, []string{"r-ana", "r-kim"}) || !slices.Equal(live.Riders, []string{"Ana", "Kim"}) {
		t.Fatalf("the session names %v %v — want Ana and Kim, not the spectator", live.Riders, live.RiderIDs)
	}
}
