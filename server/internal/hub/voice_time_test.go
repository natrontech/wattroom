package hub

import (
	"context"
	"log/slog"
	"maps"
	"slices"
	"sync"
	"testing"
	"testing/synctest"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// minutesKept is a VoiceTimeKeeper that adds up what it is handed.
type minutesKept struct {
	mu       sync.Mutex
	riders   map[string]int
	together map[string]int
	calls    int
}

func newMinutesKept() *minutesKept {
	return &minutesKept{riders: map[string]int{}, together: map[string]int{}}
}

func (k *minutesKept) AddVoiceTime(riders, together []string, seconds int) {
	k.mu.Lock()
	defer k.mu.Unlock()
	k.calls++
	for _, id := range riders {
		k.riders[id] += seconds
	}
	for _, id := range together {
		k.together[id] += seconds
	}
}

func (k *minutesKept) seconds() (riders, together map[string]int, calls int) {
	k.mu.Lock()
	defer k.mu.Unlock()
	return maps.Clone(k.riders), maps.Clone(k.together), k.calls
}

// Each minute in voice is a minute for the rider, once however many tabs or
// channels; a channel's minute is its crew's only with two riders or more in
// it, and the clock stops with its context.
func TestTheVoiceClockAddsAMinuteForEachRiderAndEachChannelOfTwo(t *testing.T) {
	// Outside the bubble: the hub's autoplay worker waits on a channel for
	// good, which a bubble reads as a deadlock.
	h := New(slog.New(slog.DiscardHandler), nil, nil)
	synctest.Test(t, func(t *testing.T) {
		kept := newMinutesKept()
		ctx, cancel := context.WithCancel(t.Context())
		done := make(chan struct{})
		go func() {
			defer close(done)
			h.runVoiceTime(ctx, kept)
		}()

		// Nobody in voice: a minute passes and nothing is handed over.
		time.Sleep(time.Minute)
		synctest.Wait()
		if _, _, calls := kept.seconds(); calls != 0 {
			t.Fatalf("an empty minute was handed over %d times", calls)
		}

		// Kim on two tabs in the lounge, Lena beside her; Ole alone upstairs.
		h.VoiceJoined("lounge", "kim#a1", "Kim")
		h.VoiceJoined("lounge", "kim#b2", "Kim")
		h.VoiceJoined("lounge", "lena#c3", "Lena")
		h.VoiceJoined("upstairs", "ole#d4", "Ole")
		time.Sleep(time.Minute)
		synctest.Wait()
		riders, together, _ := kept.seconds()
		if want := map[string]int{"kim": 60, "lena": 60, "ole": 60}; !maps.Equal(riders, want) {
			t.Fatalf("riders = %v, want %v", riders, want)
		}
		if want := map[string]int{"lounge": 60}; !maps.Equal(together, want) {
			t.Fatalf("together = %v, want %v: a rider alone is not together", together, want)
		}

		// Lena leaves: the lounge is down to Kim's two tabs, which are one rider.
		h.VoiceLeft("lounge", "lena#c3")
		time.Sleep(time.Minute)
		synctest.Wait()
		riders, together, _ = kept.seconds()
		if riders["kim"] != 120 || riders["lena"] != 60 || together["lounge"] != 60 {
			t.Fatalf("after Lena left: riders %v, together %v", riders, together)
		}

		cancel()
		synctest.Wait()
		select {
		case <-done:
		default:
			t.Fatal("the clock outlived its context")
		}
	})
}

// A saved ride's level and rider streak reach every socket and copy of the
// rider in every live channel; nobody else moves, and XP never goes down.
func TestAStandingReachesEveryChannelTheRiderIsIn(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), nil, nil)
	lounge, upstairs := h.stateOf("lounge"), h.stateOf("upstairs")
	kim := &client{rider: protocol.Rider{ID: "kim", TotalXp: 900, StreakWeeks: 2}}
	kimPhone := &client{rider: protocol.Rider{ID: "kim", TotalXp: 900, StreakWeeks: 2}}
	lena := &client{rider: protocol.Rider{ID: "lena", TotalXp: 50}}
	lounge.clients[kim], lounge.clients[lena] = struct{}{}, struct{}{}
	upstairs.clients[kimPhone] = struct{}{}
	lounge.seen["kim"] = kim.rider
	upstairs.departedRiders["kim"] = kim.rider

	h.SetStanding("kim", 1400, 3)

	for _, got := range []protocol.Rider{kim.rider, kimPhone.rider, lounge.seen["kim"], upstairs.departedRiders["kim"]} {
		if got.TotalXp != 1400 || got.StreakWeeks != 3 {
			t.Fatalf("a copy of Kim kept the old standing: %+v", got)
		}
	}
	if lena.rider.TotalXp != 50 || lena.rider.StreakWeeks != 0 {
		t.Fatalf("Lena moved with Kim: %+v", lena.rider)
	}

	// A read that raced an older one lands second: the level stays, the
	// streak is what the newer read says.
	h.SetStanding("kim", 1200, 3)
	if kim.rider.TotalXp != 1400 {
		t.Fatalf("XP went back to %d", kim.rider.TotalXp)
	}
	var roster protocol.ServerTick
	lounge.mu.Lock()
	lounge.rosterLocked(&roster, time.Now)
	lounge.mu.Unlock()
	if i := slices.IndexFunc(roster.Roster, func(r protocol.Rider) bool { return r.ID == "kim" }); i < 0 || roster.Roster[i].StreakWeeks != 3 {
		t.Fatalf("the tick's roster misses Kim's streak: %+v", roster.Roster)
	}
}
