package race

import (
	"math"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/road"
)

// Handicap is a Wheelrace's (#3172): head starts from the pace model, so that
// every rider riding at their race FTP reaches the line at the same moment,
// at par. The strongest rider rides scratch from km 0; the line goes where
// they get in par; everyone else starts as far up the road as their own
// watts need to arrive with them.
type Handicap struct {
	profile road.Road
	// LineM is where the line goes, on one of the road's own height steps,
	// so a cut of the road there ends exactly on it.
	LineM float64
	// The scratch rider's predicted seconds to the line: par, or less where
	// the road ends sooner.
	par float64
}

// handicapRollIn is how long the model rolls a rider on the flat before it
// times them: a race leaves the neutral zone rolling, not from a standstill.
const handicapRollIn = 120

// handicapGiveUp is the longest any prediction rides, so a rider the model
// cannot move up a climb is never waited for.
const handicapGiveUp = 24 * 60 * 60

// NewHandicap sets the line for a field whose strongest rider's race FTP is
// scratch watts of the reference rider's (their W/kg × 75 kg): where they get
// in par from km 0, or the road's end when that is nearer.
func NewHandicap(profile road.Road, par time.Duration, scratch float64) Handicap {
	h := Handicap{profile: profile}
	p := rolling(scratch)
	for range int(par / time.Second) {
		if p.Distance >= profile.LengthM {
			break
		}
		p.Step(scratch, profile.GradeAt(p.Distance), riderMass, protocol.PaceDefaultCdA, 0)
	}
	step := profile.Step()
	h.LineM = min(math.Floor(p.Distance/step)*step, profile.LengthM)
	h.par = timeAlong(profile, 0, h.LineM, scratch)
	return h
}

// Start is where a rider whose race FTP is w of the reference rider's watts
// starts, in metres from km 0: 0 for the scratch rider and anyone stronger,
// up the road for everyone weaker, so that the pace model brings them to the
// line together. A rider the model cannot move starts at km 0.
func (h Handicap) Start(w float64) float64 {
	if w <= 0 || h.LineM <= 0 || timeAlong(h.profile, 0, h.LineM, w) <= h.par {
		return 0
	}
	lo, hi := 0.0, h.LineM
	for hi-lo > 0.25 {
		mid := (lo + hi) / 2
		if timeAlong(h.profile, mid, h.LineM, w) > h.par {
			lo = mid
		} else {
			hi = mid
		}
	}
	return hi
}

var riderMass = float64(protocol.ReferenceRiderKg + protocol.BikeKg)

// rolling is the reference rider at w watts, rolled in to their speed on
// the flat and set back at km 0.
func rolling(w float64) road.Pace {
	var p road.Pace
	for range handicapRollIn {
		p.Step(w, 0, riderMass, protocol.PaceDefaultCdA, 0)
	}
	p.Distance = 0
	return p
}

// timeAlong is how many seconds the reference rider at w watts takes from
// `from` to `to` on profile, rolling in; +Inf for one the model cannot get
// there.
func timeAlong(profile road.Road, from, to, w float64) float64 {
	p := rolling(w)
	p.Distance = from
	for seconds := 0.0; seconds < handicapGiveUp; seconds++ {
		before := p.Distance
		if before >= to {
			return seconds
		}
		p.Step(w, profile.GradeAt(before), riderMass, protocol.PaceDefaultCdA, 0)
		if p.Distance >= to {
			return seconds + (to-before)/(p.Distance-before)
		}
	}
	return math.Inf(1)
}
