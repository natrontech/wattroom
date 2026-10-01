package hub

import (
	"context"
	"log/slog"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket/wsjson"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// #3171's acceptance, a mode table at 10, 20 and 30 minutes: Last Light's
// clock starts at the klaxon and runs that long; the fog stays wide until its
// final minute and closes to 150 m as it runs out; the card ranks how far
// each rider got, farther first, with no time on anyone who never reached
// the line; and its rides save as races.
func TestLastLightRunsItsClock(t *testing.T) {
	for _, minutes := range []int{10, 20, 30} {
		t.Run(time.Duration(minutes*int(time.Minute)).String(), func(t *testing.T) {
			ana, ben := racer("ana", 70), racer("ben", 70)
			rm, clients := inChannel(t, "last-light", ana, ben)
			r := &raceRoom{rm: rm, clients: clients, now: raceStart}
			rm.now = func() time.Time { return r.now }
			// A road nobody can ride to its end inside the clock.
			if refusal := rm.startGameOn(modeLastLight, rideOn(slope(0, 100_000), 0, false, false), minutes, ana, raceStart); refusal != "" {
				t.Fatalf("start: %s", refusal)
			}
			joinRide(rm, "ben")
			if rm.session.workoutJSON == "" || !strings.Contains(rm.session.workoutJSON, `"race":true`) {
				t.Errorf("Last Light's session saves as: %s", rm.session.workoutJSON)
			}
			pedal := watts(map[string]int{"ana": 200, "ben": 260})
			klaxon := raceStart.Add((countdownSeconds + protocol.RaceNeutralSeconds) * time.Second)
			ends := klaxon.Add(time.Duration(minutes) * time.Minute)

			r.ride(int(ends.Sub(raceStart)/time.Second)-90, pedal)
			st := r.race()
			if st == nil || st.EndsAtMs != ends.UnixMilli() || st.FogM != protocol.LastLightFogFromM || len(st.Results) != 0 {
				t.Fatalf("ninety seconds out: %+v", st)
			}
			r.ride(60, pedal) // thirty seconds out: half the fog's minute left
			if st := r.race(); math.Abs(st.FogM-protocol.LastLightFog(30*time.Second)) > 1e-6 || st.FogM >= protocol.LastLightFogFromM {
				t.Fatalf("thirty seconds out the fog is %.0f m", st.FogM)
			}
			r.ride(29, pedal)
			if st := r.race(); len(st.Results) != 0 {
				t.Fatalf("Last Light ended a second early: %+v", st.Results)
			}
			r.ride(3, pedal)
			card := r.race()
			if card == nil || len(card.Results) != 1 || len(card.Results[0].Placed) != 2 {
				t.Fatalf("the card after the clock: %+v", card)
			}
			placed := card.Results[0].Placed
			if placed[0].RiderID != "ben" || placed[1].RiderID != "ana" || placed[0].M <= placed[1].M || placed[1].M <= 0 ||
				placed[0].Ms != 0 || placed[1].Ms != 0 {
				t.Errorf("the card ranks %+v, want ben farther than ana, and no time on either", placed)
			}
			if r.rm.session.open() {
				t.Error("the clock ran out and left its session open")
			}
		})
	}
}

// The fog's one curve (docs/SPEC.md "Races"): the whole 3 km until the final
// minute, then closing evenly to 150 m.
func TestLastLightFog(t *testing.T) {
	for _, c := range []struct {
		left time.Duration
		want float64
	}{
		{5 * time.Minute, 3000}, {60 * time.Second, 3000}, {30 * time.Second, 1575}, {0, 150}, {-time.Second, 150},
	} {
		if got := protocol.LastLightFog(c.left); math.Abs(got-c.want) > 1e-9 {
			t.Errorf("fog with %v left: %.1f m, want %.1f m", c.left, got, c.want)
		}
	}
}

// Last Light runs 10, 20 or 30 minutes: any other length is refused at the
// door, said so to the coach.
func TestLastLightRefusesAnotherLength(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/channels/{id}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	coach := dial(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws/channels/fog", "jan:owner")
	if err := wsjson.Write(t.Context(), coach, protocol.ClientMessage{Control: &protocol.Control{
		Action: "game", GameMode: modeLastLight, Minutes: 15,
	}}); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	for {
		var msg protocol.ServerMessage
		if err := wsjson.Read(ctx, coach, &msg); err != nil {
			t.Fatalf("no refusal: %v", err)
		}
		if msg.Error != nil {
			if msg.Error.Code != "validation_error" || !strings.Contains(msg.Error.Message, "10, 20 or 30") {
				t.Fatalf("refusal: %+v", msg.Error)
			}
			return
		}
	}
}
