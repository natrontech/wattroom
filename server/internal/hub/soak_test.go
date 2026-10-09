//go:build soak

package hub

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"runtime"
	"sync"
	"testing"
	"testing/synctest"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// The soak (#3852): an hour of a road session with eight riders, on the
// hub's own clock. testing/synctest is the injected clock, so the hour passes
// in seconds; the build tag keeps it out of `make test`:
//
//	go test -tags soak ./internal/hub/ -run Soak
//
// The sockets are the hub's own clients, fed through handleMessage as a
// socket's reader feeds them and drained as its writer drains them: the
// network is not what soaks.

const (
	soakChannel = "soak"
	soakRoute   = "00000000-0000-4000-8000-000000003852"
	soakWorkout = `{"steps":[{"type":"steady","seconds":3600,"target":0.75}]}`
	// The driver acts this far past a tick's instant. A 4 Hz burst moves the
	// tick's phase by quarters of a second; an action at a tick's own
	// instant would race it.
	soakOffset = 100 * time.Millisecond
	// What the heap may keep once the room is gone: a fraction of the hour's
	// ride records, eight riders' 3600 samples and the bunch's trail, which
	// a room the hub held on to would keep whole.
	soakHeapSlack = 1 << 20
)

// soakSocket is one simulated screen: the hub's client, and what it heard.
// Its fields are its reader's until the reader returns.
type soakSocket struct {
	c *client
	// Closed when the screen leaves the channel.
	left chan struct{}

	ticks, bursts, offBeat int
	lastAt                 int64
	// Frames queued after the screen left.
	afterLeave int
	// Ticks spaced off SPEC's 1 Hz and its sprint windows' 4 Hz, and any
	// refusal: the first few of each.
	gaps, refusals []string
	// Each sprint window seen, by its opening, and each rider seen clear at
	// the front of the bunch.
	sprints map[int64]struct{}
	leaders map[string]struct{}
}

func newSoakSocket(r protocol.Rider) *soakSocket {
	return &soakSocket{
		c:    &client{rider: r, out: make(chan []byte, clientQueue)},
		left: make(chan struct{}), sprints: map[int64]struct{}{}, leaders: map[string]struct{}{},
	}
}

// read drains the socket's queue until the soak finishes, as its writer
// would; anything queued once the screen has left is counted, never heard.
func (s *soakSocket) read(finish <-chan struct{}, done *sync.WaitGroup) {
	defer done.Done()
	left := s.left
	for {
		select {
		case frame := <-s.c.out:
			if left == nil {
				s.afterLeave++
				continue
			}
			s.hear(frame)
		case <-left:
			left = nil
		case <-finish:
			return
		}
	}
}

func (s *soakSocket) hear(frame []byte) {
	var msg struct {
		Tick *struct {
			At     int64                 `json:"at"`
			Sprint *protocol.SprintState `json:"sprint"`
			World  *protocol.World       `json:"world"`
		} `json:"tick"`
		Error *protocol.Error `json:"error"`
	}
	if err := json.Unmarshal(frame, &msg); err != nil {
		note(&s.refusals, "an unreadable frame: "+err.Error())
		return
	}
	if msg.Error != nil {
		note(&s.refusals, msg.Error.Code+": "+msg.Error.Message)
	}
	t := msg.Tick
	if t == nil {
		return
	}
	if s.lastAt != 0 {
		switch gap := time.Duration(t.At-s.lastAt) * time.Millisecond; gap {
		case tickInterval:
		case burstTick:
			s.bursts++
		default:
			s.offBeat++
			note(&s.gaps, fmt.Sprintf("%v after the tick at %d", gap, s.lastAt))
		}
	}
	s.lastAt = t.At
	s.ticks++
	if t.Sprint != nil {
		s.sprints[t.Sprint.StartsAtMs] = struct{}{}
	}
	if t.World != nil {
		if front, clear := clearAtTheFront(t.World.Offsets); clear {
			s.leaders[front] = struct{}{}
		}
	}
}

// clearAtTheFront is the rider furthest up the bunch, when a metre or more
// clear of everyone else.
func clearAtTheFront(offsets map[string]int16) (string, bool) {
	front, best, second := "", int16(-1<<15), int16(-1<<15)
	for id, dm := range offsets {
		switch {
		case dm > best:
			front, best, second = id, dm, best
		case dm > second:
			second = dm
		}
	}
	return front, front != "" && best-second >= 10
}

func note(into *[]string, line string) {
	if len(*into) < 5 {
		*into = append(*into, line)
	}
}

// soakSaver counts what the hub hands it and keeps only the road summaries,
// so the heap can come back down.
type soakSaver struct {
	mu     sync.Mutex
	saves  int
	amends int
	rides  map[string]int
	roads  map[string]RecordRoad
}

func (s *soakSaver) SaveSession(_ context.Context, _, _, _, _ string, _ time.Time, riders []RiderRecord) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.saves++
	for _, r := range riders {
		s.rides[r.Rider.ID]++
		if r.Road != nil {
			s.roads[r.Rider.ID] = *r.Road
		}
	}
}

func (s *soakSaver) AmendRide(context.Context, string, string, string, string, time.Time, RiderRecord) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.amends++
}

// soakWatts is a rider's second: three quarters of their FTP, and a 45 s
// surge to 110 % every six minutes, each rider in their turn, so the bunch
// reshuffles all hour.
func soakWatts(i int, r protocol.Rider, second int) int {
	if (second+i*45)%360 < 45 {
		return r.FtpWatts * 110 / 100
	}
	return r.FtpWatts * 75 / 100
}

func heapAlloc() uint64 {
	// Twice: the first cycle moves the pools' contents to their victim
	// caches, the second frees them.
	runtime.GC()
	runtime.GC()
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	return m.HeapAlloc
}

// #3852: two riders drop and reconnect, one leaves early, the bunch
// reshuffles, KOM sprints fire and the workout's end closes the session. The
// ticks keep SPEC's 1 Hz and 4 Hz, nothing reaches a screen that left, every
// ride saves once with its road, and the goroutines and the heap come back
// to where they started once the room is let go of.
func TestSoakAnHourOfARoadSessionWithEightRiders(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		saver := &soakSaver{rides: map[string]int{}, roads: map[string]RecordRoad{}}
		h := New(slog.New(slog.DiscardHandler), fakeAccess{}, saver)
		// A 12 km loop with a class III climb, the KOM on it.
		loop := stretches([2]float64{4000, 0}, classIII, [2]float64{1000, 0}, [2]float64{2000, -10}, [2]float64{3000, 0})
		h.SetRoads(fakeRoads{heights: loop.Heights})
		goroutines, heap := runtime.NumGoroutine(), heapAlloc()

		rm := h.stateOf(soakChannel)
		stop := rm.stop
		riders := make([]protocol.Rider, 8)
		for i := range riders {
			id := fmt.Sprintf("r%d", i+1)
			riders[i] = protocol.Rider{ID: id, Name: id, Role: "member", FtpWatts: 200 + 15*i, WeightKg: 60 + 3*i}
		}
		coach, early := riders[0], riders[7]
		finish := make(chan struct{})
		var readers sync.WaitGroup
		var sockets []*soakSocket
		// The screen each rider is on, absent while they are away.
		screens := map[string]*soakSocket{}
		connect := func(r protocol.Rider) {
			s := newSoakSocket(r)
			sockets = append(sockets, s)
			screens[r.ID] = s
			readers.Add(1)
			go s.read(finish, &readers)
			rm.join(s.c)
		}
		drop := func(r protocol.Rider) {
			s := screens[r.ID]
			rm.leave(s.c)
			close(s.left)
			delete(screens, r.ID)
		}
		say := func(r protocol.Rider, msg protocol.ClientMessage) {
			h.handleMessage(screens[r.ID].c, rm, soakChannel, r, msg)
		}

		// What happens when, by the driver's second: r3 flaps six times in
		// a minute, r4 is gone a minute and a half and the bunch carries
		// them, r8 leaves the session for good at minute 25.
		script := map[int][]func(){}
		at := func(second int, f func()) { script[second] = append(script[second], f) }
		for k := range 6 {
			at(720+7*k, func() { drop(riders[2]) })
			at(722+7*k, func() { connect(riders[2]) })
		}
		at(1860, func() { drop(riders[3]) })
		at(1950, func() { connect(riders[3]) })
		at(1500, func() {
			say(early, protocol.ClientMessage{Control: &protocol.Control{Action: "leave"}})
			drop(early)
		})

		time.Sleep(soakOffset)
		for _, r := range riders {
			connect(r)
		}
		say(coach, protocol.ClientMessage{Control: &protocol.Control{
			Action: "pick", WorkoutName: "Soak", WorkoutJSON: soakWorkout,
			Route: &protocol.ControlRoute{ID: soakRoute, Loop: true},
		}})
		for _, r := range riders[1:] {
			say(r, protocol.ClientMessage{Control: &protocol.Control{Action: "join"}})
		}
		say(coach, protocol.ClientMessage{Control: &protocol.Control{Action: "start"}})
		seq := map[string]int{}
		for second := range countdownSeconds + 3600 + 5 {
			for _, f := range script[second] {
				f()
			}
			for i, r := range riders {
				if screens[r.ID] == nil {
					continue
				}
				seq[r.ID]++
				say(r, protocol.ClientMessage{Metrics: &protocol.RiderMetrics{Watts: soakWatts(i, r, second), Seq: seq[r.ID]}})
			}
			time.Sleep(time.Second)
		}
		rm.mu.Lock()
		phase := rm.session.phase
		rm.mu.Unlock()
		// Errorf, never Fatalf, until the bubble is closed below: a room
		// still ticking keeps synctest's clock running for good.
		if phase != "done" {
			t.Errorf("an hour and a countdown on, the session is %q, want done", phase)
		}
		for _, r := range riders {
			if screens[r.ID] != nil {
				drop(r)
			}
		}
		// Empty and between sessions, the room is let go of (forget.go) —
		// by the test too, whose own pointer would otherwise hold the hour's
		// records for the heap to find.
		rm = nil
		time.Sleep(channelIdleTTL + 5*time.Minute)
		synctest.Wait()
		close(finish)
		readers.Wait()

		forgotten := live(h, soakChannel) == nil
		if !forgotten {
			t.Error("the room outlived its idle window")
		}
		// Every rider's ride, once, with the road the bunch carried them.
		saver.mu.Lock()
		if saver.saves != 1 || saver.amends != 0 {
			t.Errorf("the session was saved %d times and amended %d, want once and never", saver.saves, saver.amends)
		}
		for _, r := range riders {
			road, carried := saver.roads[r.ID]
			if saver.rides[r.ID] != 1 || !carried || road.RouteID != soakRoute || road.DistanceM <= 0 {
				t.Errorf("%s saved %d times, road %+v; want once, along the loop", r.ID, saver.rides[r.ID], road)
			}
		}
		if left, stayed := saver.roads[early.ID].DistanceM, saver.roads[coach.ID].DistanceM; left >= stayed {
			t.Errorf("the early leaver rode %.0f m of the road and the coach %.0f m; want theirs ending where they left", left, stayed)
		}
		saver.mu.Unlock()
		// The ticks: SPEC's 1 Hz and 4 Hz alone, nothing to a screen gone.
		var bursts int
		sprints, leaders := map[int64]struct{}{}, map[string]struct{}{}
		for _, s := range sockets {
			id := s.c.rider.ID
			if s.offBeat > 0 {
				t.Errorf("%s heard %d ticks spaced off 1 s and 250 ms, the first %v", id, s.offBeat, s.gaps)
			}
			if s.afterLeave > 0 {
				t.Errorf("%s was queued %d frames after leaving", id, s.afterLeave)
			}
			if len(s.refusals) > 0 {
				t.Errorf("%s was refused: %v", id, s.refusals)
			}
			bursts += s.bursts
			for at := range s.sprints {
				sprints[at] = struct{}{}
			}
			for front := range s.leaders {
				leaders[front] = struct{}{}
			}
		}
		if len(sprints) == 0 || bursts == 0 {
			t.Errorf("%d sprint windows armed and %d ticks at 4 Hz, want the KOM's", len(sprints), bursts)
		}
		if len(leaders) < len(riders)/2 {
			t.Errorf("only %v led the bunch all hour, want it reshuffling", leaders)
		}
		// And the hour left nothing behind.
		if now := runtime.NumGoroutine(); now != goroutines {
			t.Errorf("%d goroutines after the session, %d before", now, goroutines)
		}
		if now := heapAlloc(); now > heap+soakHeapSlack {
			t.Errorf("the heap holds %d KiB after the session, %d KiB before", now>>10, heap>>10)
		}
		t.Logf("%d sprint windows, %d gaps at 4 Hz across the screens, %d leaders; %d goroutines, heap %d → %d KiB",
			len(sprints), bursts, len(leaders), goroutines, heap>>10, heapAlloc()>>10)

		// Let the bubble close, measured or not: the autoplay worker, and a
		// room loop the hub failed to end.
		close(stop)
		close(h.autoplays)
	})
}
