package hub

import (
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// What the deck puts on the room timeline (#321): every jukebox action a
// rider cannot otherwise attribute becomes a line, and the actions the dock
// already shows the instant they happen stay quiet.

func TestFirstAddAnnouncesItselfAsNowPlaying(t *testing.T) {
	j := newJukebox()
	events, ok := j.apply(protocol.JukeboxCommand{Action: "add", VideoID: "dQw4w9WgXcQ", Title: "Midnight City"}, "r-jan", "jan", jat(0))
	if !ok || len(events) != 1 {
		t.Fatalf("first add: ok=%v events=%+v", ok, events)
	}
	// One action, one line — and the now-playing line already names who
	// queued it, so a "jan queued …" above it would only repeat itself.
	got := events[0]
	if got.Kind != "jukebox" || got.Verb != "playing" || got.Track != "Midnight City" ||
		got.QueuedBy != "jan" || got.Actor != "" || got.Count != 1 || got.At != jat(0).UnixMilli() {
		t.Fatalf("now-playing line: %+v", got)
	}
}

func TestQueueingBehindTheDeckSaysWhoQueuedWhat(t *testing.T) {
	j := newJukebox()
	add(j, "dQw4w9WgXcQ", jat(0))
	events, _ := j.apply(protocol.JukeboxCommand{Action: "add", VideoID: "abcdefghijk", Title: "Sandstorm"}, "r-ada", "ada", jat(1))
	if len(events) != 1 {
		t.Fatalf("queued lines: %+v", events)
	}
	if got := events[0]; got.Verb != "queued" || got.Actor != "ada" || got.Track != "Sandstorm" || got.Count != 1 {
		t.Fatalf("queued line: %+v", got)
	}
}

func TestSkipNamesTheTrackItDroppedAndTheOneItStarted(t *testing.T) {
	j := newJukebox()
	add(j, "dQw4w9WgXcQ", jat(0))
	j.apply(protocol.JukeboxCommand{Action: "add", VideoID: "abcdefghijk", Title: "Sandstorm"}, "r-ada", "ada", jat(1))
	events, ok := j.apply(protocol.JukeboxCommand{Action: "skip"}, "r-jan", "jan", jat(2))
	if !ok || len(events) != 2 {
		t.Fatalf("skip lines: %+v", events)
	}
	if events[0].Verb != "skipped" || events[0].Actor != "jan" || events[0].Track != "t-dQw4w9WgXcQ" {
		t.Fatalf("skipped line: %+v", events[0])
	}
	if events[1].Verb != "playing" || events[1].Track != "Sandstorm" || events[1].QueuedBy != "ada" {
		t.Fatalf("follow-on now-playing line: %+v", events[1])
	}
}

func TestSkipIntoAnEmptyQueueSaysOnlyThatItWasSkipped(t *testing.T) {
	j := newJukebox()
	add(j, "dQw4w9WgXcQ", jat(0))
	events, _ := j.apply(protocol.JukeboxCommand{Action: "skip"}, "r-jan", "jan", jat(2))
	if len(events) != 1 || events[0].Verb != "skipped" {
		t.Fatalf("skip into silence: %+v", events)
	}
}

func TestTrackEndingAnnouncesTheNextOneWithNoActor(t *testing.T) {
	j := newJukebox()
	add(j, "dQw4w9WgXcQ", jat(0))
	j.apply(protocol.JukeboxCommand{Action: "add", VideoID: "abcdefghijk", Title: "Sandstorm"}, "r-ada", "ada", jat(1))
	anchor := j.snapshot().AnchorMs
	events, _ := j.apply(protocol.JukeboxCommand{Action: "ended", VideoID: "dQw4w9WgXcQ", AnchorMs: anchor}, "r-jan", "jan", jat(200))
	if len(events) != 1 {
		t.Fatalf("ended lines: %+v", events)
	}
	// Nobody did this: the deck advanced on its own, so the line has no actor.
	if events[0].Verb != "playing" || events[0].Actor != "" || events[0].Track != "Sandstorm" {
		t.Fatalf("ended line: %+v", events[0])
	}
	// The last track ending leaves silence, which needs no line.
	anchor = j.snapshot().AnchorMs
	events, _ = j.apply(protocol.JukeboxCommand{Action: "ended", VideoID: "abcdefghijk", AnchorMs: anchor}, "r-jan", "jan", jat(400))
	if len(events) != 0 {
		t.Fatalf("running dry should be silent: %+v", events)
	}
}

func TestRemovingFromTheQueueIsALine(t *testing.T) {
	j := newJukebox()
	add(j, "dQw4w9WgXcQ", jat(0))
	j.apply(protocol.JukeboxCommand{Action: "add", VideoID: "abcdefghijk", Title: "Sandstorm"}, "r-ada", "ada", jat(1))
	entry := j.snapshot().Queue[0].ID
	events, _ := j.apply(protocol.JukeboxCommand{Action: "remove", EntryID: entry}, "r-jan", "jan", jat(2))
	if len(events) != 1 || events[0].Verb != "removed" || events[0].Actor != "jan" || events[0].Track != "Sandstorm" {
		t.Fatalf("removed line: %+v", events)
	}
}

func TestQuietActionsWriteNoLine(t *testing.T) {
	j := newJukebox()
	add(j, "dQw4w9WgXcQ", jat(0))
	j.apply(protocol.JukeboxCommand{Action: "add", VideoID: "abcdefghijk", Title: "Sandstorm"}, "r-ada", "ada", jat(1))
	entry := j.snapshot().Queue[0].ID
	// Pausing, seeking, voting and reordering show themselves in the dock the
	// instant they happen; only the queue changing under you does not.
	quiet := []protocol.JukeboxCommand{
		{Action: "pause"},
		{Action: "seek", PositionSec: 30},
		{Action: "play"},
		{Action: "vote", EntryID: entry},
		{Action: "move", EntryID: entry, Index: 0},
		{Action: "add", VideoID: "'; drop--"}, // junk never reaches the timeline
	}
	for _, cmd := range quiet {
		if events, _ := j.apply(cmd, "r-jan", "jan", jat(3)); len(events) != 0 {
			t.Fatalf("%s wrote a line: %+v", cmd.Action, events)
		}
	}
}

// How the room buffers those lines.

func queued(actor string, at time.Time) protocol.RoomEvent {
	return protocol.RoomEvent{Kind: "jukebox", Verb: "queued", Actor: actor, Track: "t", Count: 1, At: at.UnixMilli()}
}

func TestBurstOfAddsIsOneLine(t *testing.T) {
	var el eventLog
	for i := range 8 {
		el.add(queued("kim", jat(i)), jat(i))
	}
	out := el.drain()
	if len(out) != 1 {
		t.Fatalf("eight adds in one sitting must read as one line: %+v", out)
	}
	// No single title survives a burst — the line counts tracks instead.
	if out[0].Count != 8 || out[0].Track != "" {
		t.Fatalf("coalesced line: %+v", out[0])
	}
}

func TestGrownLineKeepsItsIDAcrossTicks(t *testing.T) {
	var el eventLog
	el.add(queued("kim", jat(0)), jat(0))
	first := el.drain()
	el.add(queued("kim", jat(1)), jat(1))
	second := el.drain()
	if len(first) != 1 || len(second) != 1 {
		t.Fatalf("one line per tick: %+v / %+v", first, second)
	}
	// Same id, higher count: the client replaces the line it already shows
	// instead of stacking a second one under it.
	if second[0].ID != first[0].ID || second[0].Count != 2 {
		t.Fatalf("re-sent line %+v does not grow %+v", second[0], first[0])
	}
}

func TestAnotherActorGetsTheirOwnLine(t *testing.T) {
	var el eventLog
	el.add(queued("kim", jat(0)), jat(0))
	el.add(queued("ada", jat(1)), jat(1))
	el.add(queued("kim", jat(2)), jat(2))
	out := el.drain()
	if len(out) != 3 {
		t.Fatalf("interleaved actors must not merge: %+v", out)
	}
	// Kim's second add opens a new line rather than growing the one now
	// sitting above Ada's — a count must never climb over a later line.
	if out[0].ID == out[2].ID {
		t.Fatalf("kim's burst reopened across ada's line: %+v", out)
	}
}

func TestSomethingElseHappeningClosesTheBurst(t *testing.T) {
	var el eventLog
	el.add(queued("kim", jat(0)), jat(0))
	el.add(protocol.RoomEvent{Kind: "jukebox", Verb: "skipped", Actor: "kim", Track: "t", Count: 1, At: jat(1).UnixMilli()}, jat(1))
	el.add(queued("kim", jat(2)), jat(2))
	out := el.drain()
	if len(out) != 3 || out[0].ID == out[2].ID {
		t.Fatalf("a skip between adds must break the run: %+v", out)
	}
}

func TestBurstExpiresAfterTheWindow(t *testing.T) {
	var el eventLog
	el.add(queued("kim", jat(0)), jat(0))
	late := jat(0).Add(eventBurstWindow + time.Second)
	el.add(queued("kim", late), late)
	out := el.drain()
	if len(out) != 2 {
		t.Fatalf("adds a window apart are two sittings: %+v", out)
	}
}

func TestPendingEventsAreBounded(t *testing.T) {
	var el eventLog
	// Distinct verbs so nothing coalesces — a hostile client must not grow
	// room memory through the timeline either.
	for i := range maxPendingEvents * 3 {
		el.add(protocol.RoomEvent{Kind: "jukebox", Verb: "skipped", Actor: "kim", Track: "t", Count: 1, At: jat(i).UnixMilli()}, jat(i))
	}
	if got := len(el.drain()); got != maxPendingEvents {
		t.Fatalf("pending events unbounded: %d", got)
	}
}

// What the SESSION puts on the same timeline (#359). The deck was writing
// there alone, so a room could plan, start and finish a workout and the chat
// showed nothing but music.

func TestSessionPhaseSpeaksOncePerCrossing(t *testing.T) {
	rm := newRoom("test")
	at := func(s int) time.Time { return time.Unix(int64(s), 0) }
	rm.session.pick("Sweet Spot", `{"name":"S","steps":[{"type":"steady","seconds":60,"target":0.9}]}`, 60)

	// Idle is not news: the first tick of a quiet room says nothing.
	rm.sayPhaseLocked(rm.session.state(at(0)), at(0))
	if got := rm.events.drain(); len(got) != 0 {
		t.Fatalf("idle spoke: %+v", got)
	}

	rm.session.start(at(1))
	rm.sayPhaseLocked(rm.session.state(at(1)), at(1))
	got := rm.events.drain()
	if len(got) != 1 || got[0].Kind != "session" || got[0].Verb != "started" ||
		got[0].Subject != "Sweet Spot" || got[0].When != 0 {
		t.Fatalf("started line: %+v", got)
	}

	// Every tick the countdown stays up must not stack another line.
	rm.sayPhaseLocked(rm.session.state(at(2)), at(2))
	rm.sayPhaseLocked(rm.session.state(at(3)), at(3))
	if lines := rm.events.drain(); len(lines) != 0 {
		t.Fatalf("countdown repeated itself: %+v", lines)
	}

	// The clock, not a coach, closes this one — the line lands all the same.
	rm.sayPhaseLocked(rm.session.state(at(20)), at(20)) // countdown -> running
	rm.events.drain()
	rm.sayPhaseLocked(rm.session.state(at(200)), at(200)) // running -> done
	got = rm.events.drain()
	if len(got) != 1 || got[0].Verb != "ended" || got[0].Subject != "Sweet Spot" {
		t.Fatalf("ended line: %+v", got)
	}
}

func TestPlanLineCarriesTheTimeItIsFor(t *testing.T) {
	now, starts := time.Unix(1000, 0), time.Unix(9000, 0)
	got := sessionLine("planned", "Jan", "Recovery Spin", starts, now)
	if got.Kind != "session" || got.Verb != "planned" || got.Actor != "Jan" ||
		got.Subject != "Recovery Spin" || got.Count != 1 ||
		got.At != now.UnixMilli() || got.When != starts.UnixMilli() {
		t.Fatalf("planned line: %+v", got)
	}
	// A line about right now has no time of its own to render.
	if got := sessionLine("cancelled", "Jan", "Recovery Spin", time.Time{}, now); got.When != 0 {
		t.Fatalf("zero start leaked a time: %+v", got)
	}
}
