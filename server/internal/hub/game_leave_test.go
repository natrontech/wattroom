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
//
// docs/SPEC.md states the rule for elimination modes, not for one of them,
// and both implement it — so both are ridden here. Backyard charges the
// silence as the elimination itself, Floor is Lava as a life (#2371).
func TestBackfillVouchesForTheGrace(t *testing.T) {
	for _, mode := range []string{"backyard-ramp", "floor-is-lava"} {
		for _, vouch := range []bool{false, true} {
			name := map[bool]string{false: "no backfill", true: "backfill of the silence"}[vouch]
			t.Run(mode+"/"+name, func(t *testing.T) {
				game := newGameMode(mode, gat(0))
				roster := backyardRoster()
				a, b := 160, 240 // 80 % of each FTP: on the line
				if mode == "floor-is-lava" {
					low := zoneBounds[game.state(gat(0)).CalledZone][0]
					a, b = int(low*200)+5, int(low*300)+5 // just inside the called floor
				}
				// What the silence costs, in the currency the mode charges.
				penalized := func(sec int) bool {
					rider := game.state(gat(sec)).Riders["a"]
					if mode == "floor-is-lava" {
						return rider.Lives < lavaLives
					}
					return rider.Eliminated
				}
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
						t.Fatalf("the sampled %s cannot be vouched to", mode)
					}
					p.keptPedalling("a", 34, gat(36))
				}
				for s := 37; s <= 44; s++ {
					game.advance(gat(s), map[string]int{"b": b}, roster)
				}
				// Without the vouch the silence past the lapsed grace has been
				// charged by t=44 — backyard eliminated a at t=42, lava took a
				// life at t=38. With it, the grace holds until t=66.
				if out := penalized(44); out == vouch {
					t.Fatalf("penalized=%v with vouch=%v", out, vouch)
				}
				for s := 45; s <= 60; s++ {
					game.advance(gat(s), map[string]int{"a": a, "b": b}, roster)
				}
				if vouch && penalized(60) {
					t.Fatal("penalized after riding back on the line")
				}
			})
		}
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

// A reload is a leave and a join a second later, and a garage phone flaps
// the same way: inside docs/SPEC.md's presence grace neither is a departure
// (#2832). The game used to withdraw the rider on the leave itself, so a
// reload lost Sprint Roulette and the Points Race for good and sent a relay
// rider to the back of the line. Past the grace without coming back, they are
// withdrawn as before (#1577).
func TestAReloadKeepsTheRiderInTheGame(t *testing.T) {
	for _, mode := range []string{"sprint-roulette", "points-race", "team-relay"} {
		t.Run(mode, func(t *testing.T) {
			now := gat(0)
			rm := newRoom("reload")
			rm.now = func() time.Time { return now }
			if refusal := rm.startGame(mode, gameStarter, now); refusal != "" {
				t.Fatal(refusal)
			}
			withdrawn := func() bool {
				switch g := rm.game.(*sampledGame).gameMode.(type) {
				case *roulette:
					return g.left["jan"]
				case *pointsRace:
					return g.roulette.left["jan"]
				case *relay:
					return !g.joined["jan"]
				}
				t.Fatalf("unexpected mode %T", rm.game)
				return false
			}
			jan := sock("jan")
			rm.join(jan)
			now = now.Add(time.Second) // the sampled game's first second
			rm.game.advance(now, map[string]int{"jan": 200}, backyardRoster())
			if withdrawn() {
				t.Fatal("jan never took a seat, so this proves nothing")
			}

			rm.leave(jan)
			now = now.Add(time.Second)
			rm.join(sock("jan"))
			now = now.Add(presenceGrace + time.Second)
			rm.mu.Lock()
			rm.sayDepartedLocked(now)
			rm.mu.Unlock()
			if withdrawn() {
				t.Fatal("a reload inside the grace withdrew the rider")
			}

			for c := range rm.clients {
				rm.leave(c)
			}
			if withdrawn() {
				t.Fatal("the rider was withdrawn before the grace ran out")
			}
			now = now.Add(presenceGrace + time.Second)
			rm.mu.Lock()
			rm.sayDepartedLocked(now)
			rm.mu.Unlock()
			if !withdrawn() {
				t.Fatal("a rider gone past the grace is still in the game")
			}

			// And back after that: a returning rider is in the room again.
			rm.join(sock("jan"))
			now = now.Add(time.Second)
			rm.game.advance(now, map[string]int{"jan": 200}, backyardRoster())
			if withdrawn() {
				t.Fatal("a rider back in the room is still counted as gone")
			}
		})
	}
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
	t.Run("the points-race podium ranks who is still here first", func(t *testing.T) {
		// The same rule, written a second time in mode_points.go (#2371).
		p := newPointsRace(gat(0), rand.New(rand.NewSource(1))) //nolint:gosec // a test seed
		p.joined = map[string]bool{"a": true, "b": true}
		p.points = map[string]float64{"a": 9, "b": 8}
		p.withdraw("a")
		p.buildPodium(backyardRoster())
		if len(p.podium) != 2 || p.podium[0].RiderID != "b" || p.podium[1].RiderID != "a" {
			t.Fatalf("podium %+v", p.podium)
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
		if refusal := rm.startGame("team-relay", gameStarter, gat(0)); refusal != "" {
			t.Fatal(refusal)
		}
		rm.game.advance(gat(1), map[string]int{"a": 200, "b": 200}, backyardRoster())
		rm.game.advance(gat(2), nil, backyardRoster())
		c := sock("b")
		rm.join(c)
		rm.leave(c)
		// Once the presence grace is out without b coming back (#2832).
		rm.mu.Lock()
		rm.sayDepartedLocked(rm.now().Add(presenceGrace + time.Second))
		rm.mu.Unlock()
		sampled, _ := rm.game.(*sampledGame)
		r, _ := sampled.gameMode.(*relay)
		if r == nil || len(r.order) != 1 || r.order[0] != "a" {
			t.Fatalf("paceline after b left: %+v", r)
		}
	})
}
