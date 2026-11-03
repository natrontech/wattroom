package hub

import (
	"sync"
	"time"
)

// sessionRiders is who rides which crew session (docs/SESSIONS.md), as the
// sessions' own ticks say it, for the voice channels those riders stand in to
// show: a badge and the riding mark, never a number. One small lock, always
// taken after a room's and never before one, so a channel's tick and a
// session's never wait on each other.
type sessionRiders struct {
	mu sync.Mutex
	at map[string]sessionRide
}

type sessionRide struct {
	id        string
	pedalling bool
	seen      time.Time
}

// sessionRideTTL is how long a published ride stands without a tick to
// renew it: a few 1 Hz ticks, so a session that ended or a rider who left it
// drops off the channel's roster at once.
const sessionRideTTL = 3 * time.Second

func newSessionRiders() *sessionRiders {
	return &sessionRiders{at: make(map[string]sessionRide)}
}

// publish is one session's riders this tick, each with whether they pedal.
// Entries past their time go with it, so the map holds riders on a session
// now. ponytail: one map for the hub, a walk per publish; per-crew maps if a
// crew session count ever makes the walk show.
func (s *sessionRiders) publish(session string, riders map[string]bool, now time.Time) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, ride := range s.at {
		if now.Sub(ride.seen) > sessionRideTTL {
			delete(s.at, id)
		}
	}
	for id, pedalling := range riders {
		s.at[id] = sessionRide{id: session, pedalling: pedalling, seen: now}
	}
}

// of is the crew session a rider is on, if a session said so lately.
func (s *sessionRiders) of(rider string, now time.Time) (sessionRide, bool) {
	if s == nil {
		return sessionRide{}, false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	ride, ok := s.at[rider]
	if !ok || now.Sub(ride.seen) > sessionRideTTL {
		return sessionRide{}, false
	}
	return ride, true
}
