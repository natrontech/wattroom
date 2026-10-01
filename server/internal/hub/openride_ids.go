package hub

import (
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"
)

// openRideIDsKept is docs/SPEC.md "Open rides": the map from a ride's ids to
// its riders is kept until 24 h after the ride ends (ADR-0076), and no longer.
const openRideIDsKept = 24 * time.Hour

// openRideIDs is every open ride's id map (#3303): the per-ride id a stranger
// sees, and the rider behind it — what a report on the ride is resolved by
// (#3310). The hub's alone: never written to Postgres, never framed, and a
// restart drops it. It outlives the room, which is forgotten when empty.
type openRideIDs struct {
	mu    sync.Mutex
	rides map[string]*rideIDs
}

type rideIDs struct {
	byE    map[string]string // ride id → rider id
	endsAt time.Time
}

func newOpenRideIDs() *openRideIDs {
	return &openRideIDs{rides: make(map[string]*rideIDs)}
}

// idFor is the rider's id on this ride: the one they already hold, so a
// rider back from a dropped socket is the same marker, or a fresh one.
func (m *openRideIDs) idFor(ride, rider string, endsAt, now time.Time) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sweepLocked(now)
	ids := m.rides[ride]
	if ids == nil {
		ids = &rideIDs{byE: make(map[string]string), endsAt: endsAt}
		m.rides[ride] = ids
		// Dropped on time whether or not anyone asks again (ADR-0076):
		// the sweep below keeps an injected clock honest, this the real one.
		time.AfterFunc(endsAt.Add(openRideIDsKept).Sub(now), func() { m.drop(ride, ids) })
	}
	for e, who := range ids.byE {
		if who == rider {
			return e
		}
	}
	for {
		e := newRideID()
		if _, taken := ids.byE[e]; !taken {
			ids.byE[e] = rider
			return e
		}
	}
}

// riderOf resolves one of a ride's ids, until the map is dropped.
func (m *openRideIDs) riderOf(ride, e string, now time.Time) (string, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sweepLocked(now)
	ids := m.rides[ride]
	if ids == nil {
		return "", false
	}
	rider, ok := ids.byE[e]
	return rider, ok
}

// drop lets go of one ride's map, unless a later ride of the same id has
// replaced it.
func (m *openRideIDs) drop(ride string, ids *rideIDs) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.rides[ride] == ids {
		delete(m.rides, ride)
	}
}

// sweepLocked drops every ride's map past its 24 h, as the map is used.
func (m *openRideIDs) sweepLocked(now time.Time) {
	for ride, ids := range m.rides {
		if now.Sub(ids.endsAt) > openRideIDsKept {
			delete(m.rides, ride)
		}
	}
}

// newRideID is eight random hex characters: unguessable enough that one
// ride's ids say nothing about another's, and short on the wire.
func newRideID() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
