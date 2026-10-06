package race

import (
	"sort"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/road"
)

// A Category's par on the race's road (#3174, docs/SPEC.md "Races"): the
// reference rider at the Category's par W/kg, on the race's own physics,
// rolled in as the neutral zone rolls everyone in and sent from a racer's
// start at km 0. The RACE page reads how far ahead of it each racer is.

type parKey struct {
	cat  string
	from float64
}

// parTrack is one par rider's metre at each whole second from its start,
// grown only as far as a racer has got.
type parTrack struct {
	pace   road.Pace
	w      float64
	metres []float64
}

// parAt is the seconds the par rider of cat, sent from `from`, takes to m;
// false for a Category with no par.
func (r *Race) parAt(cat string, from, m float64) (float64, bool) {
	wkg := protocol.ParWkg(cat)
	if wkg <= 0 {
		return 0, false
	}
	k := parKey{cat, from}
	t := r.pars[k]
	if t == nil {
		w := wkg * protocol.ReferenceRiderKg
		t = &parTrack{pace: rolling(w), w: w, metres: []float64{from}}
		t.pace.Distance = from
		if r.pars == nil {
			r.pars = make(map[parKey]*parTrack)
		}
		r.pars[k] = t
	}
	for len(t.metres) <= handicapGiveUp && t.metres[len(t.metres)-1] < m {
		t.pace.Step(t.w, r.profile.GradeAt(t.pace.Distance), riderMass, protocol.PaceDefaultCdA, 0)
		t.metres = append(t.metres, t.pace.Distance)
	}
	i := sort.SearchFloat64s(t.metres, m)
	switch {
	case i == 0:
		return 0, true
	case i == len(t.metres):
		return float64(i - 1), true
	}
	lo, hi := t.metres[i-1], t.metres[i]
	return float64(i-1) + (m-lo)/(hi-lo), true
}
