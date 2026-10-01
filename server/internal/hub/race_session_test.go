package hub

import (
	"encoding/json"
	"log/slog"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

var raceStart = time.Unix(1_700_000_000, 0)

// racer is a rider a race can place: both numbers chosen, the weight
// confirmed yesterday and never changed.
func racer(id string, kg int) protocol.Rider {
	return protocol.Rider{
		ID: id, Name: id, Role: "member", FtpWatts: 250, WeightKg: kg,
		FtpSource: "manual", WeightSource: "manual",
		WeightConfirmedAt: raceStart.Add(-24 * time.Hour).UnixMilli(),
	}
}

// raceRoom is a race started by the first rider on a flat road of lengthM,
// every rider on its timeline.
type raceRoom struct {
	rm      *channelState
	clients map[string]*client
	now     time.Time
	seq     int
	winners []string
	// The last race state a tick carried: the closing card outlives the
	// game's linger here.
	card *protocol.RaceState
	// The tick that first carried the card, for what each socket is sent.
	cardOut *tickOut
}

func raceOn(t *testing.T, lengthM float64, riders ...protocol.Rider) *raceRoom {
	t.Helper()
	rm, clients := inChannel(t, "race", riders...)
	if refusal := rm.startGameOn(modeRace, rideOn(slope(0, lengthM), 0, false, false), riders[0], raceStart); refusal != "" {
		t.Fatalf("start: %s", refusal)
	}
	for _, r := range riders[1:] {
		joinRide(rm, r.ID)
	}
	return &raceRoom{rm: rm, clients: clients, now: raceStart}
}

// ride ticks the room for so many seconds, each rider's watts from power.
func (r *raceRoom) ride(seconds int, power func(id string) (int, bool)) protocol.ServerTick {
	var tick protocol.ServerTick
	for range seconds {
		r.now = r.now.Add(time.Second)
		r.seq++
		for id, c := range r.clients {
			if w, heard := power(id); heard {
				r.rm.setMetrics(c, protocol.RiderMetrics{Watts: w, Seq: r.seq})
			}
		}
		r.rm.mu.Lock()
		now := r.now
		out := r.rm.tickLocked(func() time.Time { return now }, time.Second, false)
		r.rm.mu.Unlock()
		if out.gameWinner != "" {
			r.winners = append(r.winners, out.gameWinner)
		}
		tick = out.tick
		if tick.Game != nil && tick.Game.Race != nil {
			r.card = tick.Game.Race
			if r.cardOut == nil && r.card.Results != nil {
				r.cardOut = &out
			}
		}
	}
	return tick
}

func watts(w map[string]int) func(string) (int, bool) {
	return func(id string) (int, bool) { v, ok := w[id]; return v, ok }
}

func (r *raceRoom) race() *protocol.RaceState { return r.card }

// Opt-in, on a road of its own (ADR-0067): no road, or a session already
// running, is a refusal — never a race mixed into a workout or a bunch.
func TestARaceRidesARoadOfItsOwn(t *testing.T) {
	ana := racer("ana", 70)
	rm, _ := inChannel(t, "race", ana)
	if refusal := rm.startGameOn(modeRace, nil, ana, raceStart); refusal != refuseRaceRoad {
		t.Errorf("a race with no road: %q", refusal)
	}
	joinRide(rm, "ana")
	rm.session.phase = "running"
	if refusal := rm.startGameOn(modeRace, rideOn(slope(0, 1000), 0, false, false), ana, raceStart); refusal == "" {
		t.Error("a race started inside a running session")
	}
}

// From the flag to the closing card: the countdown, then each racer's own
// place on the tick and no bunch, then the results per Category — and no
// winner handed to the XP ledger, since placings are never stored (ADR-0074).
func TestARaceRunsFromTheFlagToTheClosingCard(t *testing.T) {
	r := raceOn(t, 1000, racer("ana", 70), racer("ben", 80))
	pedal := watts(map[string]int{"ana": 280, "ben": 240})

	tick := r.ride(5, pedal)
	if tick.World != nil {
		t.Fatalf("before the flag the tick carries a world: %+v", tick.World)
	}
	if st := r.race(); st == nil || st.FlagAtMs != raceStart.Add(10*time.Second).UnixMilli() {
		t.Fatalf("the countdown's race state: %+v", st)
	}
	tick = r.ride(10, pedal)
	if tick.World == nil || len(tick.World.Racers) != 2 || r.rm.session.bunch != nil {
		t.Fatalf("after the flag: world %+v, bunch %v", tick.World, r.rm.session.bunch)
	}
	r.ride(protocol.RaceNeutralSeconds+200, pedal)

	st := r.race()
	if st == nil || len(st.Results) != 1 || st.Results[0].Category != "B" {
		t.Fatalf("the closing card: %+v", st)
	}
	placed := st.Results[0].Placed
	if len(placed) != 2 || placed[0].RiderID != "ana" || placed[1].RiderID != "ben" || placed[0].Ms <= 0 || placed[0].Ms >= placed[1].Ms {
		t.Fatalf("placed: %+v", placed)
	}
	if len(r.winners) != 0 {
		t.Errorf("the race told the XP ledger its winner: %v", r.winners)
	}
	if w := r.cardOut.tick.World; w == nil || w.Racers["ben"].FinishMs == 0 {
		t.Errorf("the tick that drew the card lost the last crossing: %+v", w)
	}
	if r.rm.session.open() {
		t.Error("the race finished and left its session open")
	}
}

// The field is frozen at the flag (ADR-0067, ADR-0084): a trainer WattRoom
// holds the watts on, and a number nobody chose, ride unranked and are told
// why — and a screen changing its mind after the flag moves nothing.
func TestTheFlagFreezesTheField(t *testing.T) {
	cara := racer("cara", 60)
	cara.FtpSource = protocol.SourceDefault
	r := raceOn(t, 600, racer("ana", 70), racer("ben", 70), cara)
	r.rm.setDrive(r.clients["ben"], protocol.Drive{ErgByRoad: true})
	pedal := watts(map[string]int{"ana": 250, "ben": 250, "cara": 250})
	r.ride(12, pedal)
	r.rm.setDrive(r.clients["ben"], protocol.Drive{ErgByRoad: false})
	r.ride(protocol.RaceNeutralSeconds+120, pedal)

	why := map[string]string{}
	for _, b := range r.race().Results {
		for _, f := range b.Placed {
			why[f.RiderID] = "placed"
		}
		for _, f := range b.Unranked {
			why[f.RiderID] = f.Why
		}
	}
	want := map[string]string{"ana": "placed", "ben": protocol.UnrankedUntimeable, "cara": protocol.UnrankedDefaultFtp}
	for id, w := range want {
		if why[id] != w {
			t.Errorf("%s: %q, want %q (card %+v)", id, why[id], w, r.race().Results)
		}
	}
}

// A flag with one rider on the timeline starts nothing: the race is void, says
// so, and closes its session.
func TestTooFewAtTheFlagVoidTheRace(t *testing.T) {
	r := raceOn(t, 1000, racer("ana", 70), racer("ben", 70))
	joinRideLeave(r.rm, "ben")
	r.ride(12, watts(map[string]int{"ana": 250}))
	if st := r.race(); st == nil || st.Void != protocol.RaceVoidTooFew {
		t.Fatalf("one rider at the flag: %+v", st)
	}
	if r.rm.session.open() {
		t.Error("a void race left its session open")
	}
}

func joinRideLeave(rm *channelState, id string) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.session.join(id, false)
}

// docs/SPEC.md "Races": 1 Hz until the leader is 30 s from the line, then 4 Hz
// until the race is done.
func TestTheFinishTicksAtFourHertz(t *testing.T) {
	r := raceOn(t, 800, racer("ana", 75), racer("ben", 75))
	pedal := watts(map[string]int{"ana": 250, "ben": 60})
	interval := func() time.Duration {
		r.rm.mu.Lock()
		defer r.rm.mu.Unlock()
		return r.rm.tickIntervalLocked(r.now)
	}
	r.ride(10+protocol.RaceNeutralSeconds+5, pedal)
	if got := interval(); got != tickInterval {
		t.Fatalf("hundreds of metres out: %v", got)
	}
	burst := false
	for range 120 {
		r.ride(1, pedal)
		if interval() == burstTick {
			burst = true
			break
		}
	}
	if !burst {
		t.Fatal("the finish never went to 4 Hz")
	}
	// ana over the line, ben far back: the leader now is ben, minutes out.
	for range 60 {
		if tick := r.ride(1, pedal); tick.World.Racers["ana"].FinishMs != 0 {
			break
		}
	}
	r.ride(2, pedal)
	if got := interval(); got != tickInterval {
		t.Fatalf("with the leader over the line and the tail far back: %v", got)
	}
}

// The coach neutralises the race and lifts it (#3658): nobody moves, and a
// rider silent through a hold longer than the disconnect grace is still in
// it. Only the coach may, and only a race under way can be held.
func TestTheCoachNeutralisesTheRace(t *testing.T) {
	ana, ben := racer("ana", 70), racer("ben", 70)
	r := raceOn(t, 5000, ana, ben)
	pedal := watts(map[string]int{"ana": 250, "ben": 250})
	control := func(action string, by protocol.Rider) string {
		code, _ := r.rm.control(protocol.Control{Action: action}, by, r.now)
		return code
	}
	if code := control("pause", ana); code == "" {
		t.Fatal("neutralised before the flag")
	}
	r.ride(10+protocol.RaceNeutralSeconds+20, pedal)
	if code := control("pause", ben); code != "forbidden" {
		t.Fatalf("a rider who is not the coach neutralised it: %q", code)
	}
	if code := control("pause", ana); code != "" {
		t.Fatalf("the coach's hold: %q", code)
	}
	before := r.ride(1, pedal).World.Racers
	held := r.ride(2*protocol.RaceDisconnectSeconds, watts(map[string]int{"ana": 250}))
	if !r.race().Neutralised || held.World.Racers["ana"].M != before["ana"].M {
		t.Fatalf("held: neutralised %v, ana %.1f m then %.1f m", r.race().Neutralised, before["ana"].M, held.World.Racers["ana"].M)
	}
	if code := control("resume", ana); code != "" {
		t.Fatalf("the coach's lift: %q", code)
	}
	after := r.ride(5, pedal).World.Racers
	if after["ben"].M <= before["ben"].M {
		t.Fatalf("ben, silent through the hold, is out of the race: %.1f m then %.1f m", before["ben"].M, after["ben"].M)
	}
}

// A restart voids the race (ADR-0067): it lives in the room's memory and
// nowhere else, so the room made again after a restart has none — the same
// riders back and pedalling ride no racers and see no card.
func TestARestartVoidsTheRace(t *testing.T) {
	r := raceOn(t, 5000, racer("ana", 70), racer("ben", 70))
	r.ride(10+protocol.RaceNeutralSeconds+30, watts(map[string]int{"ana": 250, "ben": 250}))

	again := &raceRoom{now: r.now}
	again.rm, again.clients = inChannel(t, "race", racer("ana", 70), racer("ben", 70))
	tick := again.ride(5, watts(map[string]int{"ana": 250, "ben": 250}))
	if tick.World != nil || tick.Game != nil {
		t.Fatalf("after a restart: world %+v, game %+v", tick.World, tick.Game)
	}
}

// Opt-in (ADR-0067): a rider who never chose racing never sees its results.
// Someone in the channel, not on the race, is sent the tick without the card.
func TestOnlyTheRidersSeeTheClosingCard(t *testing.T) {
	r := raceOn(t, 600, racer("ana", 70), racer("ben", 70))
	watcher := &client{rider: racer("cy", 70), out: make(chan []byte, clientQueue)}
	r.rm.join(watcher)
	r.ride(10+protocol.RaceNeutralSeconds+120, watts(map[string]int{"ana": 250, "ben": 250}))
	if r.cardOut == nil {
		t.Fatal("the race never drew its card")
	}
	sees := func(c *client) bool {
		for len(c.out) > 0 {
			<-c.out
		}
		r.rm.sendTick(slog.New(slog.DiscardHandler), r.cardOut)
		var msg protocol.ServerMessage
		if err := json.Unmarshal(<-c.out, &msg); err != nil {
			t.Fatal(err)
		}
		finished := msg.Tick.World != nil && msg.Tick.World.Racers["ana"].FinishMs != 0
		card := msg.Tick.Game != nil && msg.Tick.Game.Race != nil && msg.Tick.Game.Race.Results != nil
		if finished != card {
			t.Errorf("%s: finish times %v, card %v — one without the other", c.rider.ID, finished, card)
		}
		return card
	}
	if !sees(r.clients["ana"]) {
		t.Error("a racer was not sent the closing card")
	}
	if sees(watcher) {
		t.Error("a rider who never joined the race was sent its results")
	}
}

// The coach's End on a race under way still draws its card (#3658): the
// riders over the line keep their places, the rest are out of it, and a
// second End clears it.
func TestEndingARaceUnderWayKeepsItsCard(t *testing.T) {
	ana, ben := racer("ana", 70), racer("ben", 70)
	r := raceOn(t, 600, ana, ben)
	r.ride(10+protocol.RaceNeutralSeconds+120, watts(map[string]int{"ana": 280, "ben": 0}))
	if !r.rm.endGame(r.now) {
		t.Fatal("the coach could not end the race")
	}
	r.ride(1, watts(nil))
	card := r.race()
	if card == nil || len(card.Results) != 1 || len(card.Results[0].Placed) != 1 || card.Results[0].Placed[0].RiderID != "ana" {
		t.Fatalf("the card after an End: %+v", card)
	}
	if r.rm.session.open() {
		t.Error("the race ended and left its session open")
	}
	r.rm.endGame(r.now)
	r.rm.mu.Lock()
	defer r.rm.mu.Unlock()
	if r.rm.game != nil {
		t.Error("a second End left the card up")
	}
}
