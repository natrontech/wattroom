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

// wheelrace starts a Wheelrace of par minutes on a flat road of lengthM, ana
// (FTP 250) and ben (FTP 200), both 70 kg.
func wheelrace(t *testing.T, lengthM float64, par int) *raceRoom {
	t.Helper()
	ana, ben := racer("ana", 70), racer("ben", 70)
	ben.FtpWatts = 200
	rm, clients := inChannel(t, "wheelrace", ana, ben)
	r := &raceRoom{rm: rm, clients: clients, now: raceStart}
	rm.now = func() time.Time { return r.now }
	if refusal := rm.startGameOn(modeWheelrace, rideOn(slope(0, lengthM), 0, false, false), par, ana, raceStart); refusal != "" {
		t.Fatalf("start: %s", refusal)
	}
	joinRide(rm, "ben")
	return r
}

var wheelraceKlaxon = raceStart.Add((countdownSeconds + protocol.RaceNeutralSeconds) * time.Second)

// #3172's head-start table: at the flag the scratch rider — the higher race
// FTP for the same weight — starts at km 0 and the weaker rider up the road;
// the line sits where par puts it, short of the road's end; the hard close
// is par + 15 %; and both riding their race FTP reach the line together,
// ranked by who crossed first.
func TestAWheelraceBringsTheFieldToTheLineTogether(t *testing.T) {
	r := wheelrace(t, 20_000, 15)
	pedal := watts(map[string]int{"ana": 250, "ben": 200})
	tick := r.ride(15, pedal)
	st := r.race()
	if st == nil || st.LineM <= 5_000 || st.LineM >= 20_000 ||
		st.EndsAtMs != wheelraceKlaxon.Add(15*time.Minute*115/100).UnixMilli() {
		t.Fatalf("the race at the flag: %+v", st)
	}
	if a, b := tick.World.Racers["ana"].M, tick.World.Racers["ben"].M; a != 0 || b <= 500 || b >= st.LineM {
		t.Fatalf("head starts: ana at %.0f m, ben at %.0f m, line at %.0f m", a, b, st.LineM)
	}
	r.ride(protocol.RaceNeutralSeconds+15*60+60, pedal)
	// Two Categories, as a Wheelrace's field is (B and C here): each bracket
	// holds its own finisher.
	card := r.race()
	var placed []protocol.RaceFinisher
	for _, b := range card.Results {
		placed = append(placed, b.Placed...)
	}
	if len(card.Results) != 2 || len(placed) != 2 {
		t.Fatalf("the card: %+v", card)
	}
	if placed[1].Ms < placed[0].Ms {
		placed[0], placed[1] = placed[1], placed[0]
	}
	if gap := math.Abs(float64(placed[0].Ms - placed[1].Ms)); gap > 15_000 {
		t.Errorf("riding their race FTP they finished %.1f s apart: %+v", gap/1000, placed)
	}
	if par := float64(15 * 60 * 1000); math.Abs(float64(placed[0].Ms)-par) > 15_000 {
		t.Errorf("the first over the line took %.1f s, par is %.0f s", float64(placed[0].Ms)/1000, par/1000)
	}
}

// The hard close (SPEC: par + 15 %): a rider still on the road when it
// closes is off the card, and the card is the finishers'.
func TestAWheelraceClosesHard(t *testing.T) {
	r := wheelrace(t, 20_000, 15)
	r.ride(10+protocol.RaceNeutralSeconds+60, watts(map[string]int{"ana": 250, "ben": 200}))
	// ben eases to a crawl and cannot reach the line inside the close.
	r.ride(15*60*115/100, watts(map[string]int{"ana": 250, "ben": 40}))
	card := r.race()
	if card == nil || len(card.Results) != 1 || len(card.Results[0].Placed) != 1 || card.Results[0].Placed[0].RiderID != "ana" {
		t.Fatalf("the card after the hard close: %+v", card)
	}
	for _, b := range card.Results {
		for _, f := range append(b.Placed, b.Unranked...) {
			if f.RiderID == "ben" {
				t.Fatalf("ben, still on the road at the close, is on the card: %+v", card)
			}
		}
	}
	if r.rm.session.open() {
		t.Error("the hard close left the session open")
	}
}

// A Wheelrace with no par named runs the default 30 minutes (#3172).
func TestAWheelraceDefaultsToThirtyMinutes(t *testing.T) {
	r := wheelrace(t, 40_000, 0)
	r.ride(15, watts(map[string]int{"ana": 250, "ben": 200}))
	want := wheelraceKlaxon.Add(protocol.WheelraceDefaultMinutes * time.Minute * 115 / 100)
	if st := r.race(); st == nil || st.EndsAtMs != want.UnixMilli() {
		t.Fatalf("a Wheelrace with no par: %+v", st)
	}
}

// A Wheelrace's par is 15 to 45 minutes: another is refused at the door.
func TestAWheelraceRefusesAnotherPar(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/channels/{id}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	coach := dial(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws/channels/handicap", "jan:owner")
	if err := wsjson.Write(t.Context(), coach, protocol.ClientMessage{Control: &protocol.Control{
		Action: "game", GameMode: modeWheelrace, Minutes: 50,
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
			if msg.Error.Code != "validation_error" || !strings.Contains(msg.Error.Message, "15 to 45") {
				t.Fatalf("refusal: %+v", msg.Error)
			}
			return
		}
	}
}

// A Wheelrace's saved ride starts where its rider did (#3172): the head
// start is where their road begins, and its metres are the ones they rode.
func TestAWheelraceRideStartsAtItsHeadStart(t *testing.T) {
	r := wheelrace(t, 20_000, 15)
	r.saving = true
	pedal := watts(map[string]int{"ana": 250, "ben": 200})
	start := r.ride(15, pedal).World.Racers["ben"].M
	r.ride(protocol.RaceNeutralSeconds+15*60+60, pedal)
	line := r.race().LineM
	road := recordOf(t, r.ended, "ben").Road
	if road == nil || math.Abs(road.FromM-start) > 1e-6 || math.Abs(road.DistanceM-(line-start)) > 1e-6 {
		t.Fatalf("ben started %.0f m up a %.0f m race and saved %+v", start, line, road)
	}
	if ana := recordOf(t, r.ended, "ana").Road; ana == nil || ana.FromM != 0 || math.Abs(ana.DistanceM-line) > 1e-6 {
		t.Fatalf("ana, scratch, saved %+v", ana)
	}
}
