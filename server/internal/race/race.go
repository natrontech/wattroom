// Package race is a race on one road (ADR-0067, #3032) as a rule module: it
// takes riders and a plan — never a room — so a crew's session and an open
// ride (ADR-0076) drive the same code. Each rider rides the reference rider
// at their own W/kg, the wheels ahead shelter the ones behind (ADR-0077),
// the line is crossed inside the second it was crossed in, and the results
// are per Category, the riders it cannot place apart and told why.
package race

import (
	"errors"
	"sort"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/road"
)

// Entrant is a rider as the race freezes them at the flag (#3169): their
// race weight, the Category their result is grouped in, and why the race
// cannot place them (protocol.Unranked), if it cannot.
type Entrant struct {
	ID       string
	WeightKg float64
	Category string
	Unranked string
}

// ErrTooFew is a start with fewer than protocol.RaceMinRiders riders.
var ErrTooFew = errors.New("race: too few riders to start")

type racer struct {
	Entrant
	pace     road.Pace
	finishMs int64
	heardAt  time.Time
	out      bool
	// The shelter of every second ridden past km 0, summed (ADR-0077): a
	// time mostly sheltered is not the rider's alone (ADR-0074).
	sheltered float64
	ridden    int
}

// Race is one race: its road, the klaxon every racer leaves km 0 at, and its
// racers. Not goroutine-safe; its owner's lock guards it.
type Race struct {
	profile road.Road
	klaxon  time.Time
	racers  map[string]*racer
	// Time neutralised since the klaxon: a finish is stamped on the race's
	// clock, so a hold never counts against anyone's time.
	held time.Duration
}

// New lines entrants up on profile for a flag dropping at flag: the neutral
// zone rides until the klaxon, protocol.RaceNeutralSeconds later.
func New(profile road.Road, entrants []Entrant, flag time.Time) (*Race, error) {
	if len(entrants) < protocol.RaceMinRiders {
		return nil, ErrTooFew
	}
	klaxon := flag.Add(protocol.RaceNeutralSeconds * time.Second)
	r := &Race{profile: profile, klaxon: klaxon, racers: make(map[string]*racer, len(entrants))}
	for _, e := range entrants {
		r.racers[e.ID] = &racer{Entrant: e, heardAt: klaxon}
	}
	return r, nil
}

// Step rides the second ending at `at`, with each racer's watts heard in it.
// A racer not in watts coasts, and one silent past the disconnect grace is
// out. In the neutral zone everyone rolls on the flat and stays at km 0, so
// the klaxon is a rolling start with nobody ahead.
func (r *Race) Step(at time.Time, watts map[string]int) {
	neutral := !at.After(r.klaxon)
	riding := r.riding()
	// Every gap as the second began: the wheel in front has not moved yet.
	shelters := make([]float64, len(riding))
	for i := range riding {
		shelters[i] = shelterOf(riding, i)
	}
	for i, rc := range riding {
		w, heard := watts[rc.ID]
		switch {
		case heard:
			rc.heardAt = at
		case !neutral && at.Sub(rc.heardAt) > protocol.RaceDisconnectSeconds*time.Second:
			rc.out = true
			continue
		}
		mass := float64(protocol.ReferenceRiderKg + protocol.BikeKg)
		if neutral {
			rc.pace.Step(asReference(w, rc.WeightKg), 0, mass, protocol.PaceDefaultCdA, 0)
			rc.pace.Distance = 0
			continue
		}
		from := rc.pace.Distance
		rc.pace.Step(asReference(w, rc.WeightKg), r.profile.GradeAt(from), mass, protocol.PaceDefaultCdA, shelters[i])
		rc.sheltered += shelters[i]
		rc.ridden++
		if length := r.profile.LengthM; from < length && rc.pace.Distance >= length {
			// The photo finish: the crossing, placed inside this second.
			inside := (length - from) / (rc.pace.Distance - from)
			rc.finishMs = at.Add(-time.Duration((1-inside)*float64(time.Second)) - r.held).UnixMilli()
		}
	}
}

// Join lines up a rider who came to the race after its flag (#3175). Before
// the klaxon they go onto the grid like everyone else; after it they ride
// alongside from km 0, and the race never places them — they were late. A
// rider already in it, still racing or out, is not lined up twice; false
// then, and once the race is over.
func (r *Race) Join(e Entrant, at time.Time) bool {
	if _, in := r.racers[e.ID]; in || r.Done() {
		return false
	}
	rc := &racer{Entrant: e, heardAt: r.klaxon}
	if at.After(r.klaxon) {
		rc.Unranked, rc.heardAt = protocol.UnrankedLate, at
	}
	r.racers[e.ID] = rc
	return true
}

// Span is where the race is on its road: the farthest and the hindmost of
// its field still riding; false when nobody is. A late rider is not waited
// for.
func (r *Race) Span() (lead, tail float64, ok bool) {
	riding := r.field()
	if len(riding) == 0 {
		return 0, 0, false
	}
	return riding[0].pace.Distance, riding[len(riding)-1].pace.Distance, true
}

// Place is one racer's metres from km 0, and the share of the air they were
// sheltered from on average since it (#3722); false for a rider the race
// does not know.
func (r *Race) Place(id string) (metres, meanShelter float64, ok bool) {
	rc, in := r.racers[id]
	if !in {
		return 0, 0, false
	}
	if rc.ridden > 0 {
		meanShelter = rc.sheltered / float64(rc.ridden)
	}
	return min(rc.pace.Distance, r.profile.LengthM), meanShelter, true
}

// Klaxon is when the race leaves km 0: the flag plus the neutral zone, and
// later by any time the race spent neutralised before it.
func (r *Race) Klaxon() time.Time { return r.klaxon }

// Neutralised takes the span [from, to) out of the race (#3658): the coach
// held it, so nobody moved and nobody's silence in it counts against the
// disconnect grace. A neutral zone the hold reached ends that much later;
// one after the klaxon comes off every later finish instead. The owner does
// not Step inside the span.
func (r *Race) Neutralised(from, to time.Time) {
	held := to.Sub(from)
	if held <= 0 {
		return
	}
	if r.klaxon.After(from) {
		r.klaxon = r.klaxon.Add(held)
	} else {
		r.held += held
	}
	for _, rc := range r.racers {
		rc.heardAt = rc.heardAt.Add(held)
	}
}

// Close ends the race where it stands (#3658): whoever has not crossed the
// line is out of it, and the finishers keep their places. False when it was
// already over.
func (r *Race) Close() bool {
	riding := r.riding()
	for _, rc := range riding {
		rc.out = true
	}
	return len(riding) > 0
}

// LeaderETA is how long the racer of its field farthest along, still riding,
// takes to the line at their speed now; false when nobody is riding towards
// it.
func (r *Race) LeaderETA() (time.Duration, bool) {
	riding := r.field()
	if len(riding) == 0 || riding[0].pace.Speed <= 0 {
		return 0, false
	}
	lead := riding[0]
	left := max(0, r.profile.LengthM-lead.pace.Distance)
	return time.Duration(left / lead.pace.Speed * float64(time.Second)), true
}

// asReference is ADR-0067's physics: the reference rider's watts at this
// rider's W/kg, so weight neither buys speed nor costs it.
func asReference(watts int, weightKg float64) float64 {
	if weightKg <= 0 {
		weightKg = protocol.ReferenceRiderKg
	}
	return float64(watts) / weightKg * protocol.ReferenceRiderKg
}

// riding is the racers still on the road, farthest first — the order the
// wheels shelter each other in; ties by id, so a second is repeatable.
func (r *Race) riding() []*racer {
	out := make([]*racer, 0, len(r.racers))
	for _, rc := range r.racers {
		if !rc.out && rc.finishMs == 0 {
			out = append(out, rc)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].pace.Distance != out[j].pace.Distance {
			return out[i].pace.Distance > out[j].pace.Distance
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// shelterOf is the air the wheels ahead take from riding[i] (ADR-0077): its
// gap to the rider in front, and its place in the line they make — a line
// breaks wherever a gap reaches protocol.ShelterNoneGapM.
func shelterOf(riding []*racer, i int) float64 {
	line := 0
	for k := 1; k <= i; k++ {
		if riding[k-1].pace.Distance-riding[k].pace.Distance < protocol.ShelterNoneGapM {
			line++
		} else {
			line = 0
		}
	}
	if i == 0 {
		return 0
	}
	return road.Shelter(riding[i-1].pace.Distance-riding[i].pace.Distance, 0, line)
}

// Racers is the race as the tick carries it (protocol.World.Racers).
func (r *Race) Racers() map[string]protocol.RaceRider {
	out := make(map[string]protocol.RaceRider, len(r.racers))
	for id, rc := range r.racers {
		out[id] = protocol.RaceRider{
			M:        min(rc.pace.Distance, r.profile.LengthM),
			V:        rc.pace.Speed,
			FinishMs: rc.finishMs,
		}
	}
	return out
}

// Done is whether every racer has crossed the line or is out.
func (r *Race) Done() bool { return len(r.field()) == 0 }

// field is the riders still racing who started it: riding, less whoever
// came after the klaxon (#3175). They ride alongside, shelter and are
// sheltered like anyone (ADR-0077), and the race neither waits for them nor
// finishes on them.
func (r *Race) field() []*racer {
	riding := r.riding()
	out := riding[:0:0]
	for _, rc := range riding {
		if rc.Unranked != protocol.UnrankedLate {
			out = append(out, rc)
		}
	}
	return out
}

// Finisher is one racer over the line, and why they are unplaced, if they are.
type Finisher struct {
	ID       string
	FinishMs int64
	Why      string
}

// Result is one Category's bracket on the closing card (ADR-0067): its
// finishers in order, the ones the race could not place — shown, told why —
// and whether the Category had one rider, who "rode alone".
type Result struct {
	Category string
	Placed   []Finisher
	Unranked []Finisher
	Alone    bool
}

// Results is the closing card: a bracket per Category with a finisher in it.
// Nothing here is stored — race placings never are (ADR-0074).
func (r *Race) Results() []Result {
	var out []Result
	// The closing card's order: D to A.
	for _, cat := range [...]string{"D", "C", "B", "A"} {
		res := Result{Category: cat}
		entered := 0
		for _, rc := range r.racers {
			if rc.Category != cat {
				continue
			}
			// "Rode alone" is about who raced it, not who came along late.
			if rc.Unranked != protocol.UnrankedLate {
				entered++
			}
			if rc.finishMs == 0 {
				continue
			}
			f := Finisher{ID: rc.ID, FinishMs: rc.finishMs, Why: rc.Unranked}
			if f.Why == "" {
				res.Placed = append(res.Placed, f)
			} else {
				res.Unranked = append(res.Unranked, f)
			}
		}
		if len(res.Placed)+len(res.Unranked) == 0 {
			continue
		}
		byFinish(res.Placed)
		byFinish(res.Unranked)
		res.Alone = entered == 1
		out = append(out, res)
	}
	return out
}

func byFinish(fs []Finisher) {
	sort.Slice(fs, func(i, j int) bool {
		if fs[i].FinishMs != fs[j].FinishMs {
			return fs[i].FinishMs < fs[j].FinishMs
		}
		return fs[i].ID < fs[j].ID
	})
}
