package hub

import (
	"math/rand"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// gameMode is the primitive all seven modes plug into (#31): the room feeds it
// one coalesced tick of samples, it owns every rule, and its state rides the
// broadcast. Implementations are pure against the injected clock and rng, so
// each mode is table-testable without a socket.
//
// Not goroutine-safe on their own — the owning room's mutex guards them.
type gameMode interface {
	// advance runs one tick of rules. samples is riderID -> watts for riders
	// who reported this second; roster carries FTP/weight for scoring.
	advance(now time.Time, samples map[string]int, roster map[string]protocol.Rider)
	state(now time.Time) protocol.GameState
	done() bool
}

// disconnectGrace is docs/SPEC.md's elimination-mode rule: a rider who drops
// mid-round has 30 s to come back (the IndexedDB buffer proves continued
// pedalling on reconnect) before the rules see their silence.
const disconnectGrace = 30 * time.Second

// graceTracker is shared elimination-mode plumbing: it answers "has this
// rider genuinely stopped, or are they mid-blip?" A rider inside the grace
// window is invisible to elimination rules rather than eliminated by wifi.
type graceTracker struct {
	lastSeen map[string]time.Time
}

func newGraceTracker() *graceTracker {
	return &graceTracker{lastSeen: make(map[string]time.Time)}
}

// observe marks riders who reported this tick; judge returns true when the
// rider is present or blipping, false once the grace has truly lapsed.
func (g *graceTracker) observe(samples map[string]int, now time.Time) {
	for id := range samples {
		g.lastSeen[id] = now
	}
}

func (g *graceTracker) inGrace(riderID string, now time.Time) bool {
	seen, ok := g.lastSeen[riderID]
	if !ok {
		return true // never reported: not yet playing, not eliminated
	}
	return now.Sub(seen) <= disconnectGrace
}

// newGameMode is the registry (#31/#32). Unknown mode: nil, refused upstream.
func newGameMode(mode string, now time.Time) gameMode {
	rng := rand.New(rand.NewSource(now.UnixNano())) //nolint:gosec // game variety, not security
	switch mode {
	case "backyard-ramp":
		return newBackyard(now, false)
	case "collective-ramp":
		return newBackyard(now, true)
	case "floor-is-lava":
		return newLava(now, rng)
	case "watt-golf":
		return newGolf(now, rng)
	case "sprint-roulette":
		return newRoulette(now, rng)
	case "points-race":
		return newPointsRace(now, rng)
	case "team-relay":
		return newRelay(now, rng)
	default:
		return nil
	}
}
