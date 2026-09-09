package hub

import (
	"math/rand"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// A rider who drops at t=2 and returns at t=36 with a buffer of the whole
// silence kept pedalling (docs/SPEC.md): the backfill vouches for them and
// the below-band clock the lapsed grace started is forgiven (#1576).
func TestBackfillVouchesForTheGrace(t *testing.T) {
	for _, vouch := range []bool{false, true} {
		t.Run(map[bool]string{false: "no backfill", true: "backfill of the silence"}[vouch], func(t *testing.T) {
			game := newGameMode("backyard-ramp", gat(0))
			roster := backyardRoster()
			a, b := 160, 240 // 80 % of each FTP: on the line
			game.advance(gat(1), map[string]int{"a": a, "b": b}, roster)
			game.advance(gat(2), map[string]int{"a": a, "b": b}, roster)
			// a's Wi-Fi drops at t=2; b rides on. The grace lapses at t=32
			// and the below-band clock starts counting a's silence.
			for s := 3; s <= 36; s++ {
				game.advance(gat(s), map[string]int{"b": b}, roster)
			}
			// t=36: the socket is back and replays 34 s of pedalling. The
			// trainer takes a few more seconds to resume its stream.
			if vouch {
				p, ok := game.(pedalled)
				if !ok {
					t.Fatal("the sampled backyard cannot be vouched to")
				}
				p.keptPedalling("a", 34, gat(36))
			}
			for s := 37; s <= 44; s++ {
				game.advance(gat(s), map[string]int{"b": b}, roster)
			}
			// Without the vouch, ten silent seconds past the lapsed grace
			// eliminated a at t=42; with it, the grace holds until t=66.
			out := game.state(gat(44)).Riders["a"].Eliminated
			if out == vouch {
				t.Fatalf("eliminated=%v with vouch=%v", out, vouch)
			}
			for s := 45; s <= 60; s++ {
				game.advance(gat(s), map[string]int{"a": a, "b": b}, roster)
			}
			if vouch && game.state(gat(60)).Riders["a"].Eliminated {
				t.Fatal("eliminated after riding back on the line")
			}
		})
	}
	t.Run("a buffer shorter than the silence proves nothing", func(t *testing.T) {
		g := newGraceTracker()
		g.observe(map[string]int{"a": 1}, gat(0))
		if g.vouch("a", 10, gat(40)) {
			t.Fatal("ten seconds vouched for forty")
		}
		if !g.inGrace("a", gat(20)) || g.inGrace("a", gat(40)) {
			t.Fatal("the grace moved without cover")
		}
	})
}

// The rider whose last socket left is out of the game (#1577).
func TestLeavingRiderIsWithdrawn(t *testing.T) {
	t.Run("the paceline drops the seat", func(t *testing.T) {
		r := newRelay(gat(0), rand.New(rand.NewSource(1))) //nolint:gosec // a test seed
		r.order, r.joined = []string{"a", "b", "c"}, map[string]bool{"a": true, "b": true, "c": true}
		r.front = 1
		r.withdraw("b")
		if len(r.order) != 2 || r.order[r.front] != "c" {
			t.Fatalf("order %v front %d", r.order, r.front)
		}
		r.withdraw("c") // the front itself, at the end of the line: wraps
		if len(r.order) != 1 || r.front != 0 {
			t.Fatalf("order %v front %d", r.order, r.front)
		}
		r.withdraw("nobody")
		r.withdraw("a")
		if len(r.order) != 0 || r.front != 0 {
			t.Fatalf("empty line: %v %d", r.order, r.front)
		}
	})
	t.Run("the roulette podium ranks who is still here first", func(t *testing.T) {
		r := newRoulette(gat(0), rand.New(rand.NewSource(1))) //nolint:gosec // a test seed
		r.best = map[string]protocol.SprintScore{
			"a": {RiderID: "a", Wkg: 9},
			"b": {RiderID: "b", Wkg: 8},
		}
		r.withdraw("a")
		r.buildPodium()
		if r.podium[0].RiderID != "b" || r.podium[1].RiderID != "a" {
			t.Fatalf("podium %+v", r.podium)
		}
	})
	t.Run("the room's sprint scores the present", func(t *testing.T) {
		rm := newRoom("sprint-leave")
		rm.session.pick("W", `{"name":"W","steps":[{"type":"steady","seconds":600,"target":0.9}]}`, 600)
		rm.session.start(time.Unix(0, 0))
		rm.session.state(time.Unix(20, 0))
		rm.armIfRunning(time.Unix(30, 0))
		jan, ana := sock("jan"), sock("ana")
		rm.join(jan)
		rm.join(ana)
		rm.mu.Lock()
		rm.seen["jan"] = protocol.Rider{ID: "jan", Name: "Jan", FtpWatts: 250, WeightKg: 80}
		rm.seen["ana"] = protocol.Rider{ID: "ana", Name: "Ana", FtpWatts: 250, WeightKg: 60}
		for i := 0; i < 10; i++ {
			rm.sprint.collect("jan", 600, time.Unix(34+int64(i), 0))
			rm.sprint.collect("ana", 700, time.Unix(34+int64(i), 0))
		}
		rm.mu.Unlock()
		// Ana, the stronger w/kg, closes her tab at second six.
		rm.leave(ana)
		rm.mu.Lock()
		st, winner := rm.scoreSprintLocked(time.Unix(50, 0))
		rm.mu.Unlock()
		if st == nil || len(st.Results) != 1 || st.Results[0].RiderID != "jan" || winner != "" {
			t.Fatalf("podium %+v winner %q", st, winner)
		}
	})
	t.Run("the room tells the game", func(t *testing.T) {
		rm := newRoom("relay-leave")
		if refusal := rm.startGame("team-relay", gat(0)); refusal != "" {
			t.Fatal(refusal)
		}
		rm.game.advance(gat(1), map[string]int{"a": 200, "b": 200}, backyardRoster())
		rm.game.advance(gat(2), nil, backyardRoster())
		c := sock("b")
		rm.join(c)
		rm.leave(c)
		sampled, _ := rm.game.(*sampledGame)
		r, _ := sampled.gameMode.(*relay)
		if r == nil || len(r.order) != 1 || r.order[0] != "a" {
			t.Fatalf("paceline after b left: %+v", r)
		}
	})
}
