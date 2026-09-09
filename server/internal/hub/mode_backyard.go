package hub

import (
	"math"
	"sort"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// Backyard Ramp (docs/SPEC.md): 3-min rounds, the line starts at 80 % FTP and
// climbs 5 %/round; 10 s continuously below the band eliminates; eliminated
// riders drop to a 50 % FTP ERG and stay in the room. Last rider standing —
// or the collective variant (#32), where the same rules judge the room
// average and the score is rounds survived together.
const (
	backyardRound     = 3 * time.Minute
	backyardStartPct  = 0.80
	backyardStepPct   = 0.05
	backyardBelowSecs = 10
	eliminatedPct     = 0.50
	collectiveStart   = 0.75
	collectiveStep    = 0.04
)

type backyard struct {
	collective bool
	round      int
	roundEnds  time.Time
	below      map[string]int // consecutive seconds under the band
	out        map[string]bool
	// The round each rider went out in (#1593): the podium's number is
	// rounds survived, and the placing score alone could not say it.
	outRound map[string]int
	joined   map[string]bool
	grace    *graceTracker
	finished bool
	podium   []protocol.SprintScore
	// eliminationOrder, last first, feeds the podium.
	order []string
}

func newBackyard(now time.Time, collective bool) *backyard {
	return &backyard{
		collective: collective,
		round:      1,
		roundEnds:  now.Add(backyardRound),
		below:      make(map[string]int),
		out:        make(map[string]bool),
		outRound:   make(map[string]int),
		joined:     make(map[string]bool),
		grace:      newGraceTracker(),
	}
}

func (b *backyard) linePct() float64 {
	// Rounded to whole percent: the line is a product number riders read out
	// loud, not a float accumulation.
	var pct float64
	if b.collective {
		pct = collectiveStart + collectiveStep*float64(b.round-1)
	} else {
		pct = backyardStartPct + backyardStepPct*float64(b.round-1)
	}
	return math.Round(pct*100) / 100
}

// keptPedalling: the buffer covered the silence, so the below-band clock the
// lapsed grace started is forgiven (#1576).
func (b *backyard) keptPedalling(riderID string, seconds int, now time.Time) {
	if b.grace.vouch(riderID, seconds, now) {
		b.below[riderID] = 0
	}
}

func (b *backyard) advance(now time.Time, samples map[string]int, roster map[string]protocol.Rider) {
	if b.finished {
		return
	}
	b.grace.observe(samples, now)
	for id := range samples {
		b.joined[id] = true
	}

	if now.After(b.roundEnds) {
		b.round++
		b.roundEnds = now.Add(backyardRound)
	}
	line := b.linePct()

	if b.collective {
		// The room average against the line: everyone survives or nobody does.
		// Over the joined set, not this tick's samples: a rider who drops out
		// counts as 0 W once the disconnect grace lapses, the way the
		// individual rules see them. Off the samples map they simply left the
		// mean — and the room got stronger for losing them (#824).
		var avgPct, ftpSum float64
		riders := 0
		for id := range b.joined {
			rider, ok := roster[id]
			if !ok || rider.FtpWatts <= 0 {
				continue
			}
			watts, reported := samples[id]
			if !reported {
				if b.grace.inGrace(id, now) {
					continue
				}
				watts = 0
			}
			avgPct += float64(watts) / float64(rider.FtpWatts)
			ftpSum += float64(rider.FtpWatts)
			riders++
		}
		if riders == 0 {
			return
		}
		avgPct /= float64(riders)
		band := math.Max(line*0.05, 10/(ftpSum/float64(riders)))
		if avgPct < line-band {
			b.below["room"]++
		} else {
			b.below["room"] = 0
		}
		if b.below["room"] >= backyardBelowSecs {
			b.finished = true
		}
		return
	}

	for id := range b.joined {
		if b.out[id] {
			continue
		}
		rider, ok := roster[id]
		if !ok || rider.FtpWatts <= 0 {
			continue
		}
		watts, reported := samples[id]
		if !reported {
			// Silent rider: only the lapsed-grace kind counts as below.
			if b.grace.inGrace(id, now) {
				continue
			}
			watts = 0
		}
		target := line * float64(rider.FtpWatts)
		band := math.Max(target*0.05, 10)
		if float64(watts) < target-band {
			b.below[id]++
		} else {
			b.below[id] = 0
		}
		if b.below[id] >= backyardBelowSecs {
			b.out[id] = true
			b.outRound[id] = b.round
			b.order = append(b.order, id)
		}
	}

	// One rider left standing (and at least one eliminated): the game ends.
	alive := 0
	for id := range b.joined {
		if !b.out[id] {
			alive++
		}
	}
	if len(b.out) > 0 && alive <= 1 {
		b.finished = true
		b.podium = b.buildPodium(roster)
	}
}

func (b *backyard) buildPodium(roster map[string]protocol.Rider) []protocol.SprintScore {
	// Survivors first, then eliminated in reverse order of elimination.
	var out []protocol.SprintScore
	var survivors []string
	for id := range b.joined {
		if !b.out[id] {
			survivors = append(survivors, id)
		}
	}
	sort.Strings(survivors)
	standing := append(survivors, reverse(b.order)...)
	for place, id := range standing {
		rider := roster[id]
		// Rounds survived: a survivor stood through every round so far; a
		// rider who went out in round n finished n-1 of them.
		rounds := b.round
		if r, gone := b.outRound[id]; gone {
			rounds = max(0, r-1)
		}
		out = append(out, protocol.SprintScore{
			RiderID: id, Name: rider.Name, Watts: 0,
			Wkg:    float64(len(standing) - place), // placing score
			Rounds: rounds,
		})
	}
	return out
}

func reverse(in []string) []string {
	out := make([]string, len(in))
	for i, v := range in {
		out[len(in)-1-i] = v
	}
	return out
}

func (b *backyard) state(now time.Time) protocol.GameState {
	mode := "backyard-ramp"
	if b.collective {
		mode = "collective-ramp"
	}
	phase := "running"
	if b.finished {
		phase = "done"
	}
	riders := make(map[string]protocol.GameRider, len(b.joined))
	for id := range b.joined {
		gr := protocol.GameRider{Eliminated: b.out[id], TargetPct: b.linePct()}
		if b.out[id] {
			gr.TargetPct = eliminatedPct
		}
		riders[id] = gr
	}
	return protocol.GameState{
		Mode: mode, Phase: phase, Round: b.round, LinePct: b.linePct(),
		RoundEndsAtMs: b.roundEnds.UnixMilli(), Riders: riders, Podium: b.podium,
	}
}

func (b *backyard) done() bool { return b.finished }
