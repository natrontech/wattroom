package hub

import (
	"math/rand"
	"sort"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// Floor is Lava (docs/SPEC.md): a called Coggan zone; leaving it for more
// than 5 s burns a life; 3 lives; the zone changes every 2 min. Free riding —
// the rider's legs hold the zone, not the trainer.
const (
	lavaLives      = 3
	lavaGraceSecs  = 5
	lavaZoneChange = 2 * time.Minute
)

// zoneBounds is the SPEC 7-zone table as FTP fractions [low, high).
var zoneBounds = [8][2]float64{
	{}, // zones are 1-indexed
	{0, 0.56}, {0.56, 0.76}, {0.76, 0.91}, {0.91, 1.06},
	{1.06, 1.21}, {1.21, 1.51}, {1.51, 99},
}

type lava struct {
	rng       *rand.Rand
	zone      int
	zoneUntil time.Time
	outOfZone map[string]int
	lives     map[string]int
	out       map[string]bool
	joined    map[string]bool
	order     []string
	grace     *graceTracker
	finished  bool
	podium    []protocol.SprintScore
}

func newLava(now time.Time, rng *rand.Rand) *lava {
	l := &lava{
		rng:       rng,
		outOfZone: make(map[string]int),
		lives:     make(map[string]int),
		out:       make(map[string]bool),
		joined:    make(map[string]bool),
		grace:     newGraceTracker(),
	}
	l.callZone(now)
	return l
}

// callZone picks the next floor — Z2..Z5, the zones a group can actually
// hold; Z6+ as "the floor" would be a 2-minute execution.
func (l *lava) callZone(now time.Time) {
	l.zone = 2 + l.rng.Intn(4)
	l.zoneUntil = now.Add(lavaZoneChange)
	// A fresh call resets everyone's out-of-zone clock: the jump is free.
	l.outOfZone = make(map[string]int)
}

func (l *lava) advance(now time.Time, samples map[string]int, roster map[string]protocol.Rider) {
	if l.finished {
		return
	}
	l.grace.observe(samples, now)
	if now.After(l.zoneUntil) {
		l.callZone(now)
	}
	low, high := zoneBounds[l.zone][0], zoneBounds[l.zone][1]

	for id, watts := range samples {
		l.joined[id] = true
		if l.out[id] {
			continue
		}
		if _, has := l.lives[id]; !has {
			l.lives[id] = lavaLives
		}
		rider, ok := roster[id]
		if !ok || rider.FtpWatts <= 0 {
			continue
		}
		pct := float64(watts) / float64(rider.FtpWatts)
		if pct < low || pct >= high {
			l.outOfZone[id]++
		} else {
			l.outOfZone[id] = 0
		}
		if l.outOfZone[id] > lavaGraceSecs {
			l.lives[id]--
			l.outOfZone[id] = 0
			if l.lives[id] <= 0 {
				l.out[id] = true
				l.order = append(l.order, id)
			}
		}
	}

	alive := 0
	for id := range l.joined {
		if !l.out[id] {
			alive++
		}
	}
	if len(l.out) > 0 && alive <= 1 {
		l.finished = true
		l.podium = l.buildPodium(roster)
	}
}

func (l *lava) buildPodium(roster map[string]protocol.Rider) []protocol.SprintScore {
	var survivors []string
	for id := range l.joined {
		if !l.out[id] {
			survivors = append(survivors, id)
		}
	}
	// Survivors ranked by remaining lives, then the eliminated in reverse.
	sort.Slice(survivors, func(i, j int) bool { return l.lives[survivors[i]] > l.lives[survivors[j]] })
	standing := append(survivors, reverse(l.order)...)
	out := make([]protocol.SprintScore, 0, len(standing))
	for place, id := range standing {
		out = append(out, protocol.SprintScore{
			RiderID: id, Name: roster[id].Name, Wkg: float64(len(standing) - place),
		})
	}
	return out
}

func (l *lava) state(now time.Time) protocol.GameState {
	phase := "running"
	if l.finished {
		phase = "done"
	}
	riders := make(map[string]protocol.GameRider, len(l.joined))
	for id := range l.joined {
		riders[id] = protocol.GameRider{Eliminated: l.out[id], Lives: l.lives[id]}
	}
	return protocol.GameState{
		Mode: "floor-is-lava", Phase: phase, CalledZone: l.zone,
		RoundEndsAtMs: l.zoneUntil.UnixMilli(), Riders: riders, Podium: l.podium,
	}
}

func (l *lava) done() bool { return l.finished }
