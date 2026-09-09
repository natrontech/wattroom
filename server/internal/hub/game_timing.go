package hub

import (
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// sampledGame preserves the elimination rules' one-second sample cadence
// while the room broadcasts sprint ticks at 4 Hz. The room mutex owns this
// buffer, just as it owns the wrapped mode.
type sampledGame struct {
	gameMode
	next    time.Time
	pending map[string]int
}

func newSampledGame(mode gameMode, now time.Time) *sampledGame {
	return &sampledGame{gameMode: mode, next: now.Add(time.Second), pending: make(map[string]int)}
}

func (g *sampledGame) keptPedalling(riderID string, seconds int, now time.Time) {
	if p, ok := g.gameMode.(pedalled); ok {
		p.keptPedalling(riderID, seconds, now)
	}
}

func (g *sampledGame) withdraw(riderID string) {
	delete(g.pending, riderID)
	if w, ok := g.gameMode.(withdrawing); ok {
		w.withdraw(riderID)
	}
}

// windowed is a mode with a sprint window of its own (#1578); the tick
// bursts for it the way it does for the room's sprint.
type windowed interface {
	sprintWindow() (start, end time.Time, ok bool)
}

func (g *sampledGame) sprintWindow() (start, end time.Time, ok bool) {
	if w, has := g.gameMode.(windowed); has {
		return w.sprintWindow()
	}
	return time.Time{}, time.Time{}, false
}

func (g *sampledGame) advance(now time.Time, samples map[string]int, roster map[string]protocol.Rider) {
	if g.done() {
		return
	}
	for id, watts := range samples {
		g.pending[id] = watts
	}
	if now.Before(g.next) {
		return
	}
	g.gameMode.advance(now, g.pending, roster)
	clear(g.pending)
	// Do not replay a delayed tick: that would invent samples and penalties.
	g.next = now.Add(time.Second)
}
