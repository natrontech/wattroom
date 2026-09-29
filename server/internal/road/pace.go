// Package road is the server's half of riding a road: for now the pace
// model, the twin of web/src/lib/road/pace.ts.
package road

import (
	"math"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// Pace is one rider's speed and distance on a road, advanced a second at a
// time (#3048). The client's dot, the hub's bunch, stats replay and races
// share this model; the golden vectors in internal/protocol/testdata hold
// this and the TypeScript twin to 0.1 %.
//
// Martin et al. 1998, stepped once a second in protocol.PaceSubsteps
// substeps and integrated as kinetic energy, so a rider carries speed over a
// crest, gains it downhill, and rolls away from a standstill without a P/v
// singularity:
//
//	½·m·v² += (η·P − (m·g·sinθ + Crr·m·g·cosθ + ½·ρ·CdA·(1 − shelter)·v²)·v)·dt
//
// ponytail: no wheel inertia and no wind; Martin's I/r² term is a few percent
// of a bike's mass, add it when a race is decided by a sprint's first second.
type Pace struct {
	Speed    float64 // m/s
	Distance float64 // metres ridden
}

// Step advances the pace one second at these watts, on this grade (%), for
// this total mass (rider and bike, kg), CdA (m²) and shelter (the fraction of
// the air the bunch takes, 0–1). Exactly these five: no gear and no trainer
// speed ever reaches the dot (ADR-0084), and a test pins the names.
func (p *Pace) Step(watts, grade, mass, cda, shelter float64) {
	dt := 1.0 / protocol.PaceSubsteps
	for range protocol.PaceSubsteps {
		v := p.Speed
		drag := resistance(v, grade, mass, cda, shelter)
		energy := 0.5*mass*v*v + (protocol.PaceDrivetrainEfficiency*watts-drag*v)*dt
		next := 0.0
		if energy > 0 {
			next = math.Sqrt(2 * energy / mass)
		}
		p.Distance += (v + next) / 2 * dt
		p.Speed = next
	}
}

// SteadySpeed is the speed these watts hold on this grade once the rider
// settles, m/s.
func SteadySpeed(watts, grade, mass, cda, shelter float64) float64 {
	lo, hi := 0.0, 40.0
	for range 60 {
		mid := (lo + hi) / 2
		if protocol.PaceDrivetrainEfficiency*watts > resistance(mid, grade, mass, cda, shelter)*mid {
			lo = mid
		} else {
			hi = mid
		}
	}
	return lo
}

// resistance is everything but the rider's own power, in newtons, at speed v.
func resistance(v, grade, mass, cda, shelter float64) float64 {
	theta := math.Atan(grade / 100)
	sheltered := 1 - math.Min(1, math.Max(0, shelter))
	return mass*protocol.PaceGravity*math.Sin(theta) +
		protocol.PaceCrr*mass*protocol.PaceGravity*math.Cos(theta) +
		0.5*protocol.PaceAirDensity*cda*sheltered*v*v
}
