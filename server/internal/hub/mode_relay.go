package hub

import (
	"math/rand"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// Team Relay (docs/SPEC.md): one rider on front at 110 % FTP, the rest at
// 55 %; rotation on a 60–90 s timer; the room's score is the collective
// distance, Σ front-seconds × front-watts. Cooperative: no podium, one number.
// On a road (#3030) the front rider sets the bunch's pace and the road's end
// is the finish.
// ponytail: timer rotation only — the call-out rotation lands with voice UX.
const (
	relayFrontPct = 1.10
	relayRestPct  = 0.55
)

type relay struct {
	rng      *rand.Rand
	order    []string
	front    int
	rotateAt time.Time
	distance float64 // Σ front-seconds × front-watts
	joined   map[string]bool
	finished bool
}

func newRelay(now time.Time, rng *rand.Rand) *relay {
	return &relay{
		rng:      rng,
		rotateAt: now.Add(relayTurn(rng)),
		joined:   make(map[string]bool),
	}
}

func relayTurn(rng *rand.Rand) time.Duration {
	return time.Duration(60+rng.Intn(31)) * time.Second
}

// withdraw takes a departed rider out of the paceline (#1577): the front
// used to rotate onto a closed tab and the room's one number stopped for a
// whole turn.
func (r *relay) withdraw(riderID string) {
	at := -1
	for i, id := range r.order {
		if id == riderID {
			at = i
			break
		}
	}
	if at < 0 {
		return
	}
	r.order = append(r.order[:at], r.order[at+1:]...)
	delete(r.joined, riderID)
	if at < r.front {
		r.front--
	}
	if r.front >= len(r.order) {
		r.front = 0
	}
}

func (r *relay) advance(now time.Time, samples map[string]int, roster map[string]protocol.Rider) {
	if r.finished {
		return
	}
	// The paceline forms from whoever shows up, in arrival order.
	for id := range samples {
		if !r.joined[id] {
			r.joined[id] = true
			r.order = append(r.order, id)
		}
	}
	if len(r.order) == 0 {
		return
	}
	if now.After(r.rotateAt) {
		r.front = (r.front + 1) % len(r.order)
		r.rotateAt = now.Add(relayTurn(r.rng))
	}
	if watts, ok := samples[r.order[r.front]]; ok {
		r.distance += float64(watts)
	}
	_ = roster
}

func (r *relay) state(now time.Time) protocol.GameState {
	riders := make(map[string]protocol.GameRider, len(r.joined))
	for i, id := range r.order {
		pct := relayRestPct
		onFront := i == r.front
		if onFront {
			pct = relayFrontPct
		}
		riders[id] = protocol.GameRider{OnFront: onFront, TargetPct: pct}
	}
	phase := "running"
	if r.finished {
		phase = "done"
	}
	return protocol.GameState{
		Mode: "team-relay", Phase: phase,
		RoundEndsAtMs: r.rotateAt.UnixMilli(),
		TeamDistance:  r.distance, Riders: riders,
	}
}

// done: off a road a relay has no natural end — the coach ends it. On one it
// ends where the road does (#3030).
func (r *relay) done() bool { return r.finished }

// relayOf is the running Team Relay, through its sampling wrapper, or nil.
func relayOf(g gameMode) *relay {
	if s, ok := g.(*sampledGame); ok {
		g = s.gameMode
	}
	r, _ := g.(*relay)
	return r
}

// leader is the rider on front, who sets the bunch's pace on a road; empty
// before anyone has shown up or once the relay is over.
func (r *relay) leader() string {
	if r.finished || len(r.order) == 0 {
		return ""
	}
	return r.order[r.front]
}
