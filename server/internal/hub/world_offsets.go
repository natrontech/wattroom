package hub

import (
	"math"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// Each rider's place in the bunch (ADR-0065, #3097): an elastic offset from
// its one position. Ride harder and you move up it, ease off and you drift
// back; fall silent and the bunch carries you at its tail until the team car
// tows you back in. Nobody is ever removed, and nothing is ranked (ADR-0036):
// an offset is where a figure stands, never a gap anyone is told about.

// docs/SPEC.md "Riding a road together" (defaults — tune in alpha).
const (
	offsetTauSeconds = 20.0
	offsetMinM       = -10.0
	offsetMaxM       = 25.0
	// Where a silent rider coasts back to. Silent is ridingWindow, the
	// riding rule's own 10 s.
	restingOffsetM = -40.0
	towSeconds     = 20.0
)

// sample is one rider's second as the bunch reads it.
type sample struct {
	watts, ftp, weightKg int
	// The rider's own trim on their targets (#795); 1 when not sent.
	bias float64
}

func sampleOf(m protocol.RiderMetrics, rider protocol.Rider) sample {
	bias := m.Bias
	if bias == 0 {
		bias = 1
	}
	return sample{watts: m.Watts, ftp: rider.FtpWatts, weightKg: rider.WeightKg, bias: bias}
}

// pct is the sample's %FTP, uncapped; 0 without an FTP to take it of.
func (s sample) pct() float64 {
	if s.ftp <= 0 {
		return 0
	}
	return float64(s.watts) / float64(s.ftp)
}

// wkg is the sample's W/kg; 0 without a weight.
func (s sample) wkg() float64 {
	if s.weightKg <= 0 {
		return 0
	}
	return float64(s.watts) / float64(s.weightKg)
}

// place is one joined rider's place in the bunch.
type place struct {
	offset float64
	// The latest sample, held while the rider is not silent.
	last    sample
	heardAt time.Time
	resting bool
	// The tow back in from a rest: where it started and when; towAt is
	// zero while nobody is towing this rider.
	towFrom float64
	towAt   time.Time
}

// surplus is how far over the plan a rider rides this second, as a fraction
// of FTP: their %FTP less their own biased target, so a personal trim is
// never punished — the bunch's live mean standing in for the target where
// the plan prescribes none. In a sprint it is their W/kg over the mean.
func surplus(s sample, p planned, livePct, meanWkg float64) float64 {
	if p.sprint {
		if meanWkg <= 0 || s.wkg() <= 0 {
			return 0
		}
		return s.wkg()/meanWkg - 1
	}
	if s.ftp <= 0 {
		return 0
	}
	target := livePct
	switch {
	case p.absolute > 0:
		target = p.absolute / float64(s.ftp)
	case p.pct > 0:
		target = p.pct
	}
	return s.pct() - target*s.bias
}

// settle moves every joined rider's place on by the second just ridden:
// o ← o·e^(−1/τ) + s·v·1 s, clamped, at the bunch's speed after the step. A
// rider who left the session leaves the bunch with it.
func (b *bunch) settle(joined map[string]struct{}, p planned, livePct float64) {
	for id := range b.places {
		if _, in := joined[id]; !in {
			delete(b.places, id)
		}
	}
	decay := math.Exp(-1 / offsetTauSeconds)
	meanWkg := b.meanWkg()
	for id := range joined {
		pl := b.places[id]
		if pl == nil {
			pl = &place{heardAt: b.at}
			b.places[id] = pl
		}
		if s, ok := b.heard[id]; ok {
			pl.last, pl.heardAt = s, b.at
			if pl.resting {
				pl.resting, pl.towFrom, pl.towAt = false, pl.offset, b.at
			}
		}
		towed := b.at.Sub(pl.towAt).Seconds()
		switch {
		case b.at.Sub(pl.heardAt) > ridingWindow:
			pl.resting, pl.towAt = true, time.Time{}
			pl.offset = restingOffsetM + (pl.offset-restingOffsetM)*decay
		case !pl.towAt.IsZero() && towed <= towSeconds:
			pl.offset = pl.towFrom * (1 - towed/towSeconds)
		default:
			pl.towAt = time.Time{}
			moved := pl.offset*decay + surplus(pl.last, p, livePct, meanWkg)*b.pace.Speed
			pl.offset = min(max(moved, offsetMinM), offsetMaxM)
		}
	}
}

// meanWkg is the mean W/kg of the riders pedalling this second with a weight
// to take it of — a sprint's yardstick.
func (b *bunch) meanWkg() float64 {
	sum, n := 0.0, 0
	for _, s := range b.heard {
		if s.watts > 0 && s.wkg() > 0 {
			sum += s.wkg()
			n++
		}
	}
	if n == 0 {
		return 0
	}
	return sum / float64(n)
}
