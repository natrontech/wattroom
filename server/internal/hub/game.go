package hub

import (
	"math/rand"
	"sort"
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

// vouch is the reconnect backfill speaking for a rider (#1576): the buffer
// holds `seconds` of pedalling up to now. True — and the rider counts as
// seen now — when that covers the silence; a buffer shorter than the gap
// proves nothing and changes nothing.
func (g *graceTracker) vouch(riderID string, seconds int, now time.Time) bool {
	if seen, ok := g.lastSeen[riderID]; ok && now.Sub(seen) > time.Duration(seconds)*time.Second {
		return false
	}
	g.lastSeen[riderID] = now
	return true
}

// pedalled is a mode the backfill can vouch to (#1576): docs/SPEC.md's "the
// IndexedDB buffer proves continued pedalling on reconnect" had a grace
// tracker fed from live ticks only, so a rider back at t=35 with a full
// buffer was already five seconds into the below-band clock.
type pedalled interface {
	keptPedalling(riderID string, seconds int, now time.Time)
}

// withdrawing is a mode a departed rider leaves (#1577): the room's leave()
// tells the game when the rider's last socket goes, so a paceline does not
// hand the front to an empty seat and a podium is not topped from outside
// the room.
type withdrawing interface {
	withdraw(riderID string)
}

func (g *graceTracker) inGrace(riderID string, now time.Time) bool {
	seen, ok := g.lastSeen[riderID]
	if !ok {
		return true // never reported: not yet playing, not eliminated
	}
	return now.Sub(seen) <= disconnectGrace
}

// rankIDs orders riders by `better`, with rider id breaking ties (#1574):
// the sprint podium learned this in #824, and four modes were still ranking
// equal riders by map order — a winner chosen by Go's map seed. Earlier
// joiner (docs/SPEC.md) is the upgrade once the modes know the join order.
func rankIDs(ids []string, better func(a, b string) bool) {
	sort.Strings(ids)
	sort.SliceStable(ids, func(i, j int) bool { return better(ids[i], ids[j]) })
}

// The refusals startGame can answer with — two different things a coach
// can do about them (#1582).
const (
	refuseNoSuchMode  = "That game mode does not exist."
	refuseGameRunning = "A game is already running — end it first."
)

// newGameMode is the registry (#31/#32). Unknown mode: nil, refused upstream.
// Every mode is sampled at one second (#1580): a coach can arm a sprint
// mid-game, and the 4 Hz burst used to advance the unwrapped modes four
// times a second — Team Relay's front-seconds × watts quadrupled.
func newGameMode(mode string, now time.Time) gameMode {
	rng := rand.New(rand.NewSource(now.UnixNano())) //nolint:gosec // game variety, not security
	var inner gameMode
	switch mode {
	case "backyard-ramp":
		inner = newBackyard(now, false)
	case "collective-ramp":
		inner = newBackyard(now, true)
	case "floor-is-lava":
		inner = newLava(now, rng)
	case "watt-golf":
		inner = newGolf(now, rng)
	case "sprint-roulette":
		inner = newRoulette(now, rng)
	case "points-race":
		inner = newPointsRace(now, rng)
	case "team-relay":
		inner = newRelay(now, rng)
	default:
		return nil
	}
	return newSampledGame(inner, now)
}
