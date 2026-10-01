package hub

import (
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// #3175: a rider who joins the session after the flag rides the race — onto
// the grid before km 0, placed like anyone; after km 0 alongside from km 0,
// and never ranked however fast they go.
func TestALateJoinAfterKmZeroIsNeverRanked(t *testing.T) {
	cara, dan := racer("cara", 70), racer("dan", 70)
	r := raceOn(t, 600, racer("ana", 70), racer("ben", 70))
	for _, late := range []protocol.Rider{cara, dan} {
		c := &client{rider: late, out: make(chan []byte, clientQueue)}
		r.rm.join(c)
		r.clients[late.ID] = c
	}
	pedal := watts(map[string]int{"ana": 250, "ben": 250, "cara": 250, "dan": 500})
	r.ride(30, pedal)
	joinRide(r.rm, "cara")
	r.ride(protocol.RaceNeutralSeconds, pedal)
	joinRide(r.rm, "dan")
	tick := r.ride(2, pedal)
	if _, in := tick.World.Racers["dan"]; !in {
		t.Fatalf("dan joined after km 0 and rides nothing: %+v", tick.World.Racers)
	}
	r.ride(200, pedal)

	why := map[string]string{}
	for _, b := range r.race().Results {
		for _, f := range b.Placed {
			why[f.RiderID] = "placed"
		}
		for _, f := range b.Unranked {
			why[f.RiderID] = f.Why
		}
	}
	for id, want := range map[string]string{"ana": "placed", "cara": "placed"} {
		if why[id] != want {
			t.Errorf("%s: %q, want %q (card %+v)", id, why[id], want, r.race().Results)
		}
	}
	if why["dan"] == "placed" {
		t.Errorf("dan joined after km 0 and was placed: %+v", r.race().Results)
	}
	// Twenty seconds down on 600 m, dan is still riding when the field is
	// in: the race closes on its field and does not wait for him.
	if r.cardOut == nil || r.cardOut.tick.World.Racers["dan"].FinishMs != 0 {
		t.Errorf("the card waited for the late rider: %+v", r.cardOut)
	}
}

// A join inside a hold before km 0 is still before km 0 (#3175): the lift
// moves the klaxon on, and the rider goes onto the grid, placed like anyone.
func TestAJoinDuringAHoldBeforeKmZeroGoesOnTheGrid(t *testing.T) {
	ana, cara := racer("ana", 70), racer("cara", 70)
	r := raceOn(t, 600, ana, racer("ben", 70))
	c := &client{rider: cara, out: make(chan []byte, clientQueue)}
	r.rm.join(c)
	r.clients["cara"] = c
	pedal := watts(map[string]int{"ana": 250, "ben": 250, "cara": 250})
	r.ride(10+protocol.RaceNeutralSeconds-10, pedal)
	if code, _ := r.rm.control(protocol.Control{Action: "pause"}, ana, r.now); code != "" {
		t.Fatalf("the hold: %q", code)
	}
	r.ride(40, pedal) // past where the klaxon stood
	joinRide(r.rm, "cara")
	r.ride(2, pedal)
	if code, _ := r.rm.control(protocol.Control{Action: "resume"}, ana, r.now); code != "" {
		t.Fatalf("the lift: %q", code)
	}
	r.ride(200, pedal)
	for _, b := range r.race().Results {
		for _, f := range b.Placed {
			if f.RiderID == "cara" {
				return
			}
		}
	}
	t.Fatalf("cara joined in a hold before km 0 and is not placed: %+v", r.race().Results)
}

// The roadside beside a race (#3175): a spectator stands ahead of the
// leader, and the stand waits for the last racer, not the first.
func TestTheRoadsideWaitsForEveryRacer(t *testing.T) {
	r := raceOn(t, 3000, racer("ana", 70), racer("ben", 70))
	cy := racer("cy", 70)
	r.rm.join(&client{rider: cy, out: make(chan []byte, clientQueue)})
	pedal := watts(map[string]int{"ana": 300, "ben": 120})
	r.ride(10+protocol.RaceNeutralSeconds+20, pedal)
	stand := func(atM float64) string {
		code, _ := r.rm.roadsideVerb("cy", protocol.Roadside{Kind: protocol.RoadsideKindStand, AtM: atM}, r.now)
		return code
	}
	lead := r.ride(1, pedal).World.Racers["ana"].M
	if code := stand(lead + 100); code != "validation_error" {
		t.Fatalf("a stand 100 m ahead of the leader: %q", code)
	}
	at := lead + 500
	if code := stand(at); code != "" {
		t.Fatalf("a stand 500 m ahead of the leader: %q", code)
	}
	if code, _ := r.rm.roadsideVerb("ana", protocol.Roadside{Kind: protocol.RoadsideKindStand, AtM: at}, r.now); code != "forbidden" {
		t.Fatalf("a racer took a stand: %q", code)
	}
	standing := func() bool {
		r.rm.mu.Lock()
		defer r.rm.mu.Unlock()
		st := r.rm.roadsideLocked()
		return st != nil && len(st.Stands) == 1
	}
	passed := false
	for range 400 {
		racers := r.ride(1, pedal).World.Racers
		if racers["ana"].M > at && racers["ben"].M < at {
			passed = true
			if !standing() {
				t.Fatal("the stand went once the leader passed, before the last rider")
			}
		}
		if racers["ben"].M > at {
			break
		}
	}
	if !passed || standing() {
		t.Fatalf("leader passed %v; the stand still up after the last rider: %v", passed, standing())
	}
}
