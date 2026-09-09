// One live room's state and the mutations clients make to it. Everything here
// runs on the room's own goroutine (see tick.go) or under its lock — the
// `Locked` suffix marks the ones that assume the caller already holds it.
package hub

import (
	"sort"
	"sync"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

type room struct {
	// The room's clock. time.Now in production; the tests move it so a
	// sample's timeline second is theirs to choose (#791).
	now  func() time.Time
	slug string
	// Closed when the room is deleted (#618) — the tick goroutine is the
	// only reader, and it returns rather than ticking for a room nobody
	// can reach any more.
	stop chan struct{}
	// The hub's count of hand-offs in flight — the ride saver mid-retry, the
	// recap keeper — so a shutdown waits for them (audit 2026-09-09). Nil in
	// a room built without a hub (tests); nothing then waits.
	pending *sync.WaitGroup
	mu      sync.Mutex
	clients map[*client]struct{}
	metrics map[string]protocol.RiderMetrics // keyed by rider id, drained each tick
	cheers  []protocol.Cheer                 // this second's reactions, drained each tick
	board   []protocol.Board                 // this second's soundboard fires, drained the same way
	chat    []protocol.ChatLine              // this second's lines, drained each tick (#146)
	reacts  []protocol.ChatReactionCount     // this second's changed reaction totals (#201)
	edits   []protocol.ChatEdit              // this second's rewritten lines (#865)
	chatIDs []protocol.ChatID                // ids the async save assigned (#219)
	events  eventLog                         // what the room did, drained each tick (#321)
	session *session
	record  *accumulator
	music   *jukebox
	// riders ever seen this session, so someone who left before the end still
	// gets their ride; saved guards against persisting one session twice.
	sprint   *sprint
	game     gameMode
	lastGame *protocol.GameState
	// The running game's roster, merged from seen on every tick (#1581).
	gameRoster map[string]protocol.Rider
	seen       map[string]protocol.Rider
	// First-seen order this session — the SPEC medal tie-break.
	seenOrder []string
	saved     bool
	// kind+rider → last accepted time: limits are per RIDER, not per socket —
	// a second tab must not double every allowance (audit #219).
	lastInput map[string]time.Time
	// rider id → last live sample, 0 W included: a trainer that is CONNECTED
	// and talking (#251). Its one reader is the wattroom_room_riding gauge,
	// which the deploy guard on laub-wattroom-001 refuses to restart under —
	// and a rider resting between intervals must still hold that guard, so
	// this deliberately stays the looser signal. Entries go stale harmlessly;
	// the map is bounded by riders ever seen.
	lastMetric map[string]time.Time
	// rider id → last sample with watts on it. Riding is a thing a rider does,
	// not a thing their trainer does (#1016): a paired trainer publishes 0 W
	// at 1 Hz forever, so stamping every sample marked anyone with a tab open
	// as riding on their friends' screens.
	lastWatts map[string]time.Time
	// The phase the timeline last spoke a line about (#359) — a transition
	// says it once, not every tick it stays there.
	phaseSaid string
	// Pings the lobby (#251) when the tick sees phase or the riding set change.
	changed func()
	// Asks autoplay to refill the deck after a command ran it dry (#676).
	// Called outside the room lock; nil for a room nobody wired.
	deckIdled func()
	// Records a pool track the deck just played through or skipped (#269),
	// the substrate smart shuffle weights by. Called outside the room lock
	// and BEFORE deckIdled, so the track that just ended is already in the
	// history the refill weights against; nil for a room nobody wired.
	deckPlayed func(trackEvent)
	// Voice (#467): who is in the channel now, folded to rider ids by the
	// hub from LiveKit's state, and how long each of them was in it while
	// the timeline ran — the session voice bonus's input. Bounded by the
	// channel's participants; reset on start.
	voiceNow map[string]struct{}
	voiceMs  map[string]int64
	// Sensor claims (#610): rider id → kind → the screen holding it. Bounded
	// by riders present times the four kinds; see pairing.go for why the hub
	// arbitrates something the browser owns.
	claims map[string]map[string]holder
	// Claim answers waiting for the tick goroutine to write them — the only
	// writer per socket.
	pendingPairing map[*client]protocol.SensorPairing
	// Pokes waiting for the same writer. A slice preserves simultaneous pokes
	// from different riders instead of letting the last one erase the first.
	pendingPokes map[*client][]protocol.Poke
	// Who has stepped out (#706). Keyed by rider, not by socket: the same
	// person on a desktop and a phone is one presence, and a rider is away
	// because they said so on one of their screens, not because one of them
	// happened to be the socket that asked. Emptied as the rider's last
	// socket goes, so away never outlives being in the room.
	away map[string]struct{}
	// Riders whose last socket has gone, and when. The room is not told until
	// the grace window is out (#984): a phone in a garage flaps, and a leave
	// line per flap is a strobe rather than a timeline. Coming back inside the
	// window says nothing at all — no leave, and no second arrival either.
	departed map[string]time.Time
	// What to call them once the window is out: the socket that knew their
	// name has gone by then.
	departedNames map[string]string
	// Who was in the room while the session ran, and when (ADR-0034): one
	// span per rider, sampled by the tick, reset on start. Bounded by riders
	// ever present in one session.
	present map[string]*span
	// When the recap's clock starts: the first tick that saw anyone this
	// session. Zero between sessions.
	presentSince time.Time
	// The stored recap, waiting for the next tick to carry it to the room.
	// Nil the rest of the time — unlike everything else the tick drains,
	// this one is already durable.
	recap *protocol.SessionRecap
	// Who pressed start — the coach of record for Crew Chief.
	startedBy string
	xp        XpKeeper
	recaps    RecapKeeper
}

// ridingWindow is how recent a sample must be to count as "riding now".
const ridingWindow = 10 * time.Second

// A poke is deliberately harder to repeat than chat or a cheer: it asks one
// person's machine for attention and must not become a harassment button.
const pokeCooldown = 10 * time.Second

// ridingLocked names riders who have PEDALLED inside ridingWindow, and
// returns their account ids in the same order — names render, ids identify
// (#649). The caller holds rm.mu.
//
// The window is the hold, and that is the point of it: testing watts on the
// current sample would flicker a rider between riding and online several
// times a minute, because coasting into a corner, freewheeling between
// intervals and reaching for a bottle are all 0 W. Ten seconds of no watts
// is sitting down; two is riding a bike.
func (rm *room) ridingLocked(now time.Time) (names, ids []string) {
	riders := make([]protocol.Rider, 0, len(rm.lastWatts))
	for id, at := range rm.lastWatts {
		if now.Sub(at) <= ridingWindow {
			if rider, ok := rm.seen[id]; ok {
				riders = append(riders, rider)
			}
		}
	}
	sort.Slice(riders, func(i, j int) bool { return riders[i].Name < riders[j].Name })
	for _, rider := range riders {
		names = append(names, rider.Name)
		ids = append(ids, rider.ID)
	}
	return names, ids
}

// liveTrainersLocked counts riders whose trainer has spoken inside
// ridingWindow, watts or no watts — what the deploy guard asks about. Kept
// apart from ridingLocked on purpose (#1016): the rider-facing word got
// stricter, and a restart during somebody's rest interval is exactly what
// the guard exists to prevent. The caller holds rm.mu.
func (rm *room) liveTrainersLocked(now time.Time) int {
	live := 0
	for _, at := range rm.lastMetric {
		if now.Sub(at) <= ridingWindow {
			live++
		}
	}
	return live
}

func (rm *room) allow(kind, riderID string, now time.Time, min time.Duration) bool {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if rm.lastInput == nil {
		rm.lastInput = make(map[string]time.Time)
	}
	key := kind + ":" + riderID
	if now.Sub(rm.lastInput[key]) < min {
		return false
	}
	rm.lastInput[key] = now
	return true
}

func newRoom(slug string) *room {
	return &room{
		now:           time.Now,
		slug:          slug,
		stop:          make(chan struct{}),
		clients:       make(map[*client]struct{}),
		metrics:       make(map[string]protocol.RiderMetrics),
		session:       newSession(),
		record:        newAccumulator(),
		music:         newJukebox(),
		seen:          make(map[string]protocol.Rider),
		lastMetric:    make(map[string]time.Time),
		lastWatts:     make(map[string]time.Time),
		voiceNow:      make(map[string]struct{}),
		voiceMs:       make(map[string]int64),
		present:       make(map[string]*span),
		away:          make(map[string]struct{}),
		departed:      make(map[string]time.Time),
		departedNames: make(map[string]string),
	}
}

// roleOf reads a client's current role under the room lock — SetRole can
// change it while that client's read loop is blocked on the next message.
func (rm *room) roleOf(c *client) string {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	return c.rider.Role
}

func (rm *room) join(c *client) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	// Whether this is the rider arriving or only another of their screens
	// (#219: a person on a desktop and a phone is one presence).
	first := !rm.presentLocked(c.rider.ID)
	rm.clients[c] = struct{}{}
	metricRiders.Inc()
	if !first {
		return
	}
	// A socket that flapped is not an arrival. It was never announced as a
	// leave either, so the room hears nothing about the round trip.
	if _, flapped := rm.departed[c.rider.ID]; flapped {
		delete(rm.departed, c.rider.ID)
		delete(rm.departedNames, c.rider.ID)
		return
	}
	now := rm.now()
	rm.events.add(presenceLine("joined", c.rider.Name, now), now)
}

// presentLocked is whether any socket in this room belongs to that rider.
func (rm *room) presentLocked(riderID string) bool {
	for c := range rm.clients {
		if c.rider.ID == riderID {
			return true
		}
	}
	return false
}

// sayDepartedLocked announces everyone whose grace window has run out. Called
// from the tick, which is the only clock the room has.
func (rm *room) sayDepartedLocked(now time.Time) {
	for riderID, at := range rm.departed {
		if now.Sub(at) < presenceGrace {
			continue
		}
		delete(rm.departed, riderID)
		if name := rm.departedNames[riderID]; name != "" {
			rm.events.add(presenceLine("left", name, now), now)
			delete(rm.departedNames, riderID)
		}
	}
}

func (rm *room) leave(c *client) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	delete(rm.clients, c)
	delete(rm.pendingPairing, c)
	delete(rm.pendingPokes, c)
	// Closing a tab frees its sensors, so the rider's other screens can pair
	// (#610). Queued after the delete above, so the leaver is not told.
	if rm.releaseSensorsLocked(c) {
		rm.queuePairingLocked(c.rider.ID)
	}
	// A phone spectator closing must not blank the desktop's tile: metrics
	// go only when the rider's LAST socket does (#219).
	last := true
	for other := range rm.clients {
		if other.rider.ID == c.rider.ID {
			last = false
			break
		}
	}
	if last {
		delete(rm.metrics, c.rider.ID)
		// Away is presence, and the rider is no longer present (#706).
		// Left behind, it would greet them as away on the next join.
		delete(rm.away, c.rider.ID)
		// Not announced yet: the tick says so once the grace window is out.
		rm.departed[c.rider.ID] = rm.now()
		rm.departedNames[c.rider.ID] = c.rider.Name
		// Out of the game too (#1577): a paceline must not hand the front
		// to a closed tab, and a podium is not topped from outside the room.
		if w, ok := rm.game.(withdrawing); ok {
			w.withdraw(c.rider.ID)
		}
	}
	metricRiders.Dec()
}

// autoplayActor is the AddedBy/riderID this feature's own additions carry —
// nobody queued them, the room did, so they earn no DJ credit (#467) and the
// deck's "queued by" line says what actually happened.
const autoplayActor = "Autoplay"

// setAway records a rider stepping out or coming back (#706). Per rider: it
// reaches every screen they hold, which is what makes pressing the button on
// the desktop clear the mark the phone is also drawing.
func (rm *room) setAway(riderID string, away bool) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	_, was := rm.away[riderID]
	if away {
		rm.away[riderID] = struct{}{}
	} else {
		delete(rm.away, riderID)
	}
	// Only the change is worth a line: a tab restating what it already said
	// on every reconnect would print one every time (#984).
	if was == away {
		return
	}
	name := rm.nameOfLocked(riderID)
	if name == "" {
		return
	}
	verb := "back"
	if away {
		verb = "away"
	}
	now := rm.now()
	rm.events.add(presenceLine(verb, name, now), now)
}

// nameOfLocked is what to call a rider who is in the room right now.
func (rm *room) nameOfLocked(riderID string) string {
	for c := range rm.clients {
		if c.rider.ID == riderID {
			return c.rider.Name
		}
	}
	return ""
}
